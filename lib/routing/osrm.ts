/**
 * OSRM istemcisi.
 *
 * Varsayılan olarak FOSSGIS'in açık sunucularını kullanır (routing.openstreetmap.de).
 * Bunlar demo amaçlıdır ve hız sınırı uygular; yoğun kullanımda kendi OSRM
 * sunucunu kurup OSRM_CAR_URL / OSRM_FOOT_URL ile adresini ver.
 *
 * Sonuçlar bellekte ve diskte (.cache/osrm) önbelleklenir. Sunucu 429/503
 * dönerse bir süre istek atılmaz. Hata, zaman aşımı veya rota bulunamazsa
 * null döner; çağıran tahmine veya düz çizgiye düşer.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type OsrmProfile = "car" | "foot";

export interface OsrmRoute {
  distanceKm: number;
  durationMin: number;
  /** [lng, lat] noktaları */
  geometry: [number, number][];
}

type Point = { lat: number; lng: number };

const TIMEOUT_MS = 6000;
const USER_AGENT = "gezinti/0.1 (kisisel proje)";
/** 429/503 sonrası bu süre boyunca o sunucuya istek atılmaz */
const COOLDOWN_MS = 2 * 60 * 1000;
/** Eşleştirmeye gönderilecek en fazla nokta (sunucu sınırının altında) */
const MAX_MATCH_POINTS = 80;
const MAX_MEMORY_CACHE = 5000;
const DISK_CACHE_DIR = path.join(process.cwd(), ".cache", "osrm");

/**
 * Profil başına sunucu ve durumu. Kendi sunucumuz (docker-compose.osrm.yml)
 * sınırsız kullanılır; FOSSGIS'in açık sunucusu hız sınırı uyguladığı için
 * istekler aralıklı ve az sayıda gönderilir. Profiller ayrı ayarlanabilir
 * (ör. araba yerelde, yürüme açık sunucuda).
 */
interface Server {
  baseUrl: string;
  selfHosted: boolean;
  maxInFlight: number;
  /** Ardışık istekler arası en az süre */
  minIntervalMs: number;
  /**
   * Durakların yola en fazla uzaklığı. FOSSGIS sunucusu 50 m'yi "TooBig" diye
   * reddediyor (40 m kabul); kendi sunucumuzda sınır yok.
   */
  matchRadiusM: number;
  inFlight: number;
  waiting: (() => void)[];
  coolUntil: number;
  nextSlot: number;
}

function server(envUrl: string | undefined, publicUrl: string): Server {
  const selfHosted = !!envUrl;
  return {
    baseUrl: envUrl ?? publicUrl,
    selfHosted,
    maxInFlight: selfHosted ? 8 : 2,
    minIntervalMs: selfHosted ? 0 : 700,
    matchRadiusM: selfHosted ? 50 : 35,
    inFlight: 0,
    waiting: [],
    coolUntil: 0,
    nextSlot: 0,
  };
}

const SERVERS: Record<OsrmProfile, Server> = {
  car: server(process.env.OSRM_CAR_URL, "https://routing.openstreetmap.de/routed-car"),
  foot: server(process.env.OSRM_FOOT_URL, "https://routing.openstreetmap.de/routed-foot"),
};

const fmt = ([lng, lat]: [number, number]) => `${lng.toFixed(5)},${lat.toFixed(5)}`;
const toPair = (p: Point): [number, number] => [p.lng, p.lat];

// ---------- Eşzamanlılık sınırı ve soğuma ----------

async function limited<T>(s: Server, fn: () => Promise<T>): Promise<T> {
  if (s.inFlight >= s.maxInFlight) await new Promise<void>((r) => s.waiting.push(r));
  s.inFlight++;
  try {
    // İstekleri zamana yay: her istek bir sonraki boş zaman dilimini alır
    const now = Date.now();
    const slot = Math.max(now, s.nextSlot);
    s.nextSlot = slot + s.minIntervalMs;
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
    return await fn();
  } finally {
    s.inFlight--;
    s.waiting.shift()?.();
  }
}

/** Sunucunun "bu noktalar için rota/eşleşme yok" dediği kalıcı yanıtlar */
const PERMANENT_CODES = new Set(["NoRoute", "NoMatch", "NoSegment"]);

/**
 * Sonuç türleri: "ok" ve "none" (sunucu rota/eşleşme bulamadı) kalıcıdır ve
 * önbelleğe yazılır; "fail" (ağ hatası, hız sınırı) geçicidir, yazılmaz.
 */
type Outcome<T> = { kind: "ok"; value: T } | { kind: "none" } | { kind: "fail" };

async function fetchOsrm<T>(s: Server, url: string, parse: (data: unknown) => T | null): Promise<Outcome<T>> {
  if (Date.now() < s.coolUntil) return { kind: "fail" };
  return limited(s, async () => {
    if (Date.now() < s.coolUntil) return { kind: "fail" };
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 429 || res.status === 503) {
        s.coolUntil = Date.now() + COOLDOWN_MS;
        console.warn(`[osrm] ${s.baseUrl} sınırladı (${res.status}); ${COOLDOWN_MS / 1000} sn istek atılmayacak`);
        return { kind: "fail" };
      }
      // 400 hem kalıcı yanıtlar (NoRoute, NoMatch) hem de istek hataları
      // (TooBig, InvalidQuery) için dönüyor; yalnızca kalıcı olanlar önbelleğe girer
      if (!res.ok && res.status !== 400) return { kind: "fail" };
      const data = (await res.json()) as { code?: string; message?: string };
      if (data.code !== "Ok") {
        if (PERMANENT_CODES.has(data.code ?? "")) return { kind: "none" };
        console.warn(`[osrm] ${data.code}: ${data.message}`);
        return { kind: "fail" };
      }
      const value = parse(data);
      return value === null ? { kind: "none" } : { kind: "ok", value };
    } catch {
      return { kind: "fail" };
    }
  });
}

// ---------- Bellek + disk önbelleği ----------

const memory = new Map<string, Promise<unknown>>();

function diskPath(key: string) {
  return path.join(DISK_CACHE_DIR, `${createHash("sha1").update(key).digest("hex")}.json`);
}

function readDisk<T>(key: string): { hit: true; value: T | null } | { hit: false } {
  try {
    return { hit: true, value: JSON.parse(readFileSync(diskPath(key), "utf8")) as T | null };
  } catch {
    return { hit: false };
  }
}

function writeDisk(key: string, value: unknown) {
  try {
    mkdirSync(DISK_CACHE_DIR, { recursive: true });
    writeFileSync(diskPath(key), JSON.stringify(value));
  } catch {
    // Önbellek yazılamazsa sorun değil
  }
}

function cached<T>(key: string, load: () => Promise<Outcome<T>>): Promise<T | null> {
  const hit = memory.get(key) as Promise<T | null> | undefined;
  if (hit) return hit;

  const disk = readDisk<T>(key);
  const promise: Promise<T | null> = disk.hit
    ? Promise.resolve(disk.value)
    : load().then((outcome) => {
        if (outcome.kind === "fail") {
          memory.delete(key); // geçici hata; sonra tekrar denenebilir
          return null;
        }
        const value = outcome.kind === "ok" ? outcome.value : null;
        writeDisk(key, value);
        return value;
      });

  if (memory.size >= MAX_MEMORY_CACHE) memory.delete(memory.keys().next().value!);
  memory.set(key, promise);
  return promise;
}

// ---------- Genel API ----------

export function osrmRoute(profile: OsrmProfile, from: Point, to: Point): Promise<OsrmRoute | null> {
  const s = SERVERS[profile];
  const coords = `${fmt(toPair(from))};${fmt(toPair(to))}`;
  // Profil sunucu adresinden seçilir; URL'deki "driving" her sunucuda sabittir
  const url = `${s.baseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  return cached(`route|${profile}|${coords}`, () =>
    fetchOsrm(s, url, (data) => {
      const d = data as {
        code: string;
        routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
      };
      const route = d.code === "Ok" ? d.routes?.[0] : undefined;
      return route
        ? { distanceKm: route.distance / 1000, durationMin: route.duration / 60, geometry: route.geometry.coordinates }
        : null;
    }),
  );
}

/**
 * Durak dizisi gibi seyrek noktaları yola oturtur (map matching).
 * Otobüs hatlarının gerçek güzergahını çıkarmak için kullanılır.
 */
export function osrmMatch(profile: OsrmProfile, line: [number, number][]): Promise<[number, number][] | null> {
  if (line.length < 2) return Promise.resolve(null);
  const s = SERVERS[profile];
  let points = line;
  if (points.length > MAX_MATCH_POINTS) {
    // Uçları koruyarak eşit aralıkla seyrelt
    const step = (points.length - 1) / (MAX_MATCH_POINTS - 1);
    points = Array.from({ length: MAX_MATCH_POINTS }, (_, i) => line[Math.round(i * step)]);
  }
  const coords = points.map(fmt).join(";");
  const radiuses = points.map(() => s.matchRadiusM).join(";");
  const url =
    `${s.baseUrl}/match/v1/driving/${coords}` +
    `?overview=full&geometries=geojson&tidy=true&radiuses=${radiuses}`;
  return cached(`match|${profile}|${coords}`, () =>
    fetchOsrm(s, url, (data) => {
      const d = data as { code: string; matchings?: { geometry: { coordinates: [number, number][] } }[] };
      // Eşleşme kopuk parçalara bölünebilir; sırayla birleştir
      return d.code === "Ok" && d.matchings?.length ? d.matchings.flatMap((m) => m.geometry.coordinates) : null;
    }),
  );
}
