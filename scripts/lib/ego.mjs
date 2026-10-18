// EGO "Hareket Saatleri" sayfasını ayrıştırır ve GTFS dosyalarına çevirir.
// Ağ erişimi yok; scripts/fetch-ego.mjs kullanır, testlenebilir.

import { haversineM } from "./common.mjs";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Ana sayfadaki hat seçeneklerinin kodları (ör. "105-1"); id: hat_liste_otobus | _metro | _ankaray */
export function parseLineOptions(html, id = "hat_liste_otobus") {
  const select = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
  if (!select) return [];
  return [...select[1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]).filter((v) => v !== "0");
}

/** Hat sayfası → { code, name, from, to, km, durationMin, times: {wd, sat, sun}, stops } */
export function parseLinePage(html, code) {
  const kv = {};
  for (const m of html.matchAll(/<td class="key">([^<]*)<\/td>\s*<td class="sep">:<\/td>\s*<td>([\s\S]*?)<\/td>/g)) {
    kv[clean(m[1])] = clean(m[2]);
  }
  const num = (s) => Number(String(s ?? "").match(/[\d.,]+/)?.[0].replace(",", "."));

  // Hücre: "06:10 - 06:20 - 06:00 ULUS METRO İSTASYONUNDAN BAŞLAYACAK 06:30 - …".
  // Notlu saatler hattın ortasındaki bir istasyondan başlayan seferlerdir.
  const cells = [...html.matchAll(/<td class="hs-times">([\s\S]*?)<\/td>/g)].map((m) => {
    const plain = [];
    const partial = [];
    const text = clean(m[1].replace(/<br\s*\/?>/gi, " "));
    for (const t of text.matchAll(/(\d{1,2}):(\d{2})([^\d]*)/g)) {
      const sec = Number(t[1]) * 3600 + Number(t[2]) * 60;
      const note = t[3].match(/^\s*-?\s*(.*?)N?D[AE]N\s+BA[ŞS]LAYACAK/i);
      if (/BA[ŞS]LAYACAK/i.test(t[3]) && note?.[1]) partial.push({ sec, from: note[1] });
      else plain.push(sec);
    }
    const uniq = (a) => a.filter((v, i) => a.indexOf(v) === i).sort((x, y) => x - y);
    return { plain: uniq(plain), partial };
  });
  const [wd = { plain: [], partial: [] }, sat = { plain: [], partial: [] }, sun = { plain: [], partial: [] }] = cells;
  const table = html.match(/<table[^>]*route-table[^>]*>([\s\S]*?)<\/table>/)?.[1] ?? "";
  const stops = [];
  for (const row of table.matchAll(/<tr>\s*<td>[\s\S]*?<\/td>\s*<td>([A-Za-z]*\d+)<\/td>\s*<td>([\s\S]*?)<\/td>/g)) {
    stops.push({ no: row[1], name: clean(row[2]) });
  }
  if (stops.length < 2) return null;

  return {
    code,
    name: kv["Hat Adı"] ?? code,
    from: kv["Kalkış Yeri"] ?? "",
    to: kv["Varış Yeri"] ?? "",
    km: num(kv["Mesafesi"]) || null,
    durationMin: num(kv["Süresi"]) || null,
    times: { wd: wd.plain, sat: sat.plain, sun: sun.plain },
    partial: { wd: wd.partial, sat: sat.partial, sun: sun.partial },
    stops,
  };
}

const hms = (sec) =>
  [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60].map((n) => String(n).padStart(2, "0")).join(":");

const csvRow = (r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",");
const csv = (rows) => rows.map(csvRow).join("\n") + "\n";

/** Ad karşılaştırması için: küçük harf, aksansız, "istasyonu/metro" gibi sözcükler atılmış */
export function stationKey(name) {
  return name
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !["istasyonu", "istasyon", "metro", "ist", "durak", "gar"].includes(w) && !/^\d$/.test(w))
    .join(" ");
}

/**
 * Adla durak bulucu: ref'siz OSM duraklarını, adı eşleşen aday arasından hattın bir
 * önceki durağına en yakın olanı seçerek bulur (ardışık duraklar yakındır).
 * @param named [{ name, lat, lng }]
 * @returns (durak, önceki) => {lat, lng} | undefined
 */
export function nameLocator(named, { maxStepM = 2500 } = {}) {
  const byKey = new Map();
  for (const n of named) {
    const key = stationKey(n.name);
    if (key.length < 3) continue;
    (byKey.get(key) ?? byKey.set(key, []).get(key)).push(n);
  }
  return (stop, prev) => {
    const cands = byKey.get(stationKey(stop.name));
    if (!cands) return undefined;
    if (!prev) return cands.length === 1 ? cands[0] : undefined;
    let best;
    let bestD = maxStepM;
    for (const c of cands) {
      const d = haversineM(prev, c);
      if (d <= bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };
}

/** Hat yoksa/bilinmiyorsa kullanılan ortalama otobüs hızı (km/s) */
const FALLBACK_KMH = 20;

const SERVICES = [
  ["wd", "WD", [1, 1, 1, 1, 1, 0, 0]],
  ["sat", "SAT", [0, 0, 0, 0, 0, 1, 0]],
  ["sun", "SUN", [0, 0, 0, 0, 0, 0, 1]],
];

/**
 * @param lines parseLinePage çıktıları
 * @param locate Map<EGO durak no, {lat, lng}> ya da (durak, önceki konum) => {lat, lng} | undefined
 * @returns {{ files: Record<string, string>, report: string }}
 */
export function buildEgoGtfs(lines, locate) {
  const find = locate instanceof Map ? (s) => locate.get(s.no) : locate;
  const stops = new Map(); // no → { name, lat, lng }
  const routes = [];
  const trips = [];
  const stopTimes = ["trip_id,arrival_time,departure_time,stop_id,stop_sequence"];
  let skipped = 0;
  let partialSkipped = 0;
  let stopsTotal = 0;
  let stopsMatched = 0;

  for (const line of lines) {
    const seq = [];
    for (const s of line.stops) {
      stopsTotal++;
      const pos = find(s, seq.at(-1));
      if (!pos) continue;
      stopsMatched++;
      if (seq.at(-1)?.no === s.no) continue;
      seq.push({ no: s.no, name: s.name, ...pos });
    }
    const partial = line.partial ?? { wd: [], sat: [], sun: [] };
    const hasTimes = SERVICES.some(([key]) => line.times[key].length || partial[key].length);
    if (seq.length < 2 || !hasTimes) {
      skipped++;
      continue;
    }

    const cum = [0];
    for (let i = 1; i < seq.length; i++) cum.push(cum[i - 1] + haversineM(seq[i - 1], seq[i]));
    const totalM = cum.at(-1) || 1;
    const totalSec = Math.round(
      (line.durationMin ? line.durationMin * 60 : (totalM / 1000 / FALLBACK_KMH) * 3600),
    );
    // Aynı iki durak arası en az 20 sn; toplamı koru
    const offsets = cum.map((c) => Math.round((totalSec * c) / totalM));
    for (let i = 1; i < offsets.length; i++) offsets[i] = Math.max(offsets[i], offsets[i - 1] + 20);

    for (const s of seq) stops.set(s.no, { name: s.name, lat: s.lat, lng: s.lng });
    // Raylıda -D/-G yön ekidir; gösterilen hat adı "M1" olsun
    const short = line.type === 1 ? line.code.replace(/-[DG]$/, "") : line.code;
    routes.push([line.code, "1", short, `${short}: ${line.name}`, line.type ?? 3]);

    // Hattın ortasındaki bir istasyondan başlayan seferler için başlangıç indeksi
    const startIndex = (from) => {
      const key = stationKey(from);
      return seq.findIndex((x) => {
        const k = stationKey(x.name);
        return k === key || (key.length >= 4 && (k.startsWith(key) || key.startsWith(k)));
      });
    };
    const emit = (sid, dep, first) => {
      const id = `${line.code}-${sid}-${dep}${first ? `-${first}` : ""}`;
      trips.push([line.code, sid, id, line.to]);
      for (let i = first; i < seq.length; i++) {
        const t = hms(dep + offsets[i] - offsets[first]);
        stopTimes.push(csvRow([id, t, t, seq[i].no, i - first + 1]));
      }
    };

    for (const [key, sid] of SERVICES) {
      for (const dep of line.times[key]) emit(sid, dep, 0);
      for (const p of partial[key]) {
        const first = startIndex(p.from);
        if (first < 0 || first >= seq.length - 1) partialSkipped++;
        else emit(sid, p.sec, first);
      }
    }
  }

  const files = {
    "agency.txt": csv([
      ["agency_id", "agency_name", "agency_url", "agency_timezone"],
      ["1", "EGO Genel Müdürlüğü (kalkış saatleri EGO'dan, ara durak saatleri tahmini)", "https://www.ego.gov.tr", "Europe/Istanbul"],
    ]),
    "calendar.txt": csv([
      ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
      ...SERVICES.map(([, sid, days]) => [sid, ...days, "20260101", "20301231"]),
    ]),
    "routes.txt": csv([["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"], ...routes]),
    "stops.txt": csv([
      ["stop_id", "stop_name", "stop_lat", "stop_lon"],
      ...[...stops].map(([no, s]) => [no, s.name, s.lat, s.lng]),
    ]),
    "trips.txt": csv([["route_id", "service_id", "trip_id", "trip_headsign"], ...trips]),
    "stop_times.txt": stopTimes.join("\n") + "\n",
  };
  const report =
    `Yazıldı: ${routes.length} hat (${skipped} atlandı: durak/saat eksik), ${trips.length} sefer, ${stops.size} durak.\n` +
    `${partialSkipped ? `Ara istasyondan başlayan ${partialSkipped} sefer eşleşmediği için atlandı.
` : ""}Durak eşleşmesi: ${stopsMatched}/${stopsTotal} (%${Math.round((100 * stopsMatched) / Math.max(1, stopsTotal))}) OSM'de bulundu.`;
  return { files, report };
}
