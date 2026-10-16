/**
 * OSRM istemcisi.
 *
 * Varsayılan olarak FOSSGIS'in açık sunucularını kullanır (routing.openstreetmap.de).
 * Bunlar demo amaçlıdır; yoğun kullanımda kendi OSRM sunucunu kurup
 * OSRM_CAR_URL / OSRM_FOOT_URL ile adresini ver.
 *
 * Hata, zaman aşımı veya rota bulunamazsa null döner; çağıran tahmine düşer.
 */

export type OsrmProfile = "car" | "foot";

export interface OsrmRoute {
  distanceKm: number;
  durationMin: number;
  /** [lng, lat] noktaları */
  geometry: [number, number][];
}

const BASE_URLS: Record<OsrmProfile, string> = {
  car: process.env.OSRM_CAR_URL ?? "https://routing.openstreetmap.de/routed-car",
  foot: process.env.OSRM_FOOT_URL ?? "https://routing.openstreetmap.de/routed-foot",
};

const TIMEOUT_MS = 6000;
const USER_AGENT = "gezinti/0.1 (kisisel proje)";

// Aynı ayak tekrar tekrar sorulmasın (revizyon turları, aynı plan)
const cache = new Map<string, Promise<OsrmRoute | null>>();
const MAX_CACHE = 2000;

type Point = { lat: number; lng: number };

const coord = (p: Point) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;

// Açık sunucuya aynı anda en fazla bu kadar istek
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

async function request(profile: OsrmProfile, from: Point, to: Point): Promise<OsrmRoute | null> {
  // FOSSGIS sunucularında profil yoldan seçilir; URL'deki "driving" sabittir
  const url =
    `${BASE_URLS[profile]}/route/v1/driving/${coord(from)};${coord(to)}` +
    `?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code: string;
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
    };
    const route = data.code === "Ok" ? data.routes?.[0] : undefined;
    if (!route) return null;
    return {
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
      geometry: route.geometry.coordinates,
    };
  } catch {
    return null;
  }
}

export function osrmRoute(profile: OsrmProfile, from: Point, to: Point): Promise<OsrmRoute | null> {
  const key = `${profile}|${coord(from)}|${coord(to)}`;
  let hit = cache.get(key);
  if (!hit) {
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
    hit = limited(() => request(profile, from, to));
    // Başarısız sonucu önbellekte tutma; sunucu sonra düzelebilir
    hit.then((r) => r === null && cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}
