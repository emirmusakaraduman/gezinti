// EGO "Hareket Saatleri" sayfasını ayrıştırır ve GTFS dosyalarına çevirir.
// Ağ erişimi yok; scripts/fetch-ego.mjs kullanır, testlenebilir.

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

/** Ana sayfadaki otobüs hat seçeneklerinin kodları (ör. "105-1") */
export function parseLineOptions(html) {
  const select = html.match(/<select[^>]*id="hat_liste_otobus"[^>]*>([\s\S]*?)<\/select>/);
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

  const cells = [...html.matchAll(/<td class="hs-times">([\s\S]*?)<\/td>/g)].map((m) =>
    [...m[1].matchAll(/\b(\d{1,2}):(\d{2})\b/g)]
      .map((t) => Number(t[1]) * 3600 + Number(t[2]) * 60)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => a - b),
  );
  const [wd = [], sat = [], sun = []] = cells;

  const table = html.match(/<table[^>]*route-table[^>]*>([\s\S]*?)<\/table>/)?.[1] ?? "";
  const stops = [];
  for (const row of table.matchAll(/<tr>\s*<td>[\s\S]*?<\/td>\s*<td>(\d+)<\/td>\s*<td>([\s\S]*?)<\/td>/g)) {
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
    times: { wd, sat, sun },
    stops,
  };
}

function haversineM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const hms = (sec) =>
  [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60].map((n) => String(n).padStart(2, "0")).join(":");

const csvRow = (r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",");
const csv = (rows) => rows.map(csvRow).join("\n") + "\n";

/** Hat yoksa/bilinmiyorsa kullanılan ortalama otobüs hızı (km/s) */
const FALLBACK_KMH = 20;

const SERVICES = [
  ["wd", "WD", [1, 1, 1, 1, 1, 0, 0]],
  ["sat", "SAT", [0, 0, 0, 0, 0, 1, 0]],
  ["sun", "SUN", [0, 0, 0, 0, 0, 0, 1]],
];

/**
 * @param lines parseLinePage çıktıları
 * @param osmStops Map<EGO durak no, {lat, lng}>
 * @returns {{ files: Record<string, string>, report: string }}
 */
export function buildEgoGtfs(lines, osmStops) {
  const stops = new Map(); // no → { name, lat, lng }
  const routes = [];
  const trips = [];
  const stopTimes = ["trip_id,arrival_time,departure_time,stop_id,stop_sequence"];
  let skipped = 0;
  let stopsTotal = 0;
  let stopsMatched = 0;

  for (const line of lines) {
    const seq = [];
    for (const s of line.stops) {
      stopsTotal++;
      const pos = osmStops.get(s.no);
      if (!pos) continue;
      stopsMatched++;
      if (seq.at(-1)?.no === s.no) continue;
      seq.push({ no: s.no, name: s.name, ...pos });
    }
    const hasTimes = SERVICES.some(([key]) => line.times[key].length);
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
    routes.push([line.code, "1", line.code, `${line.code}: ${line.name}`, 3]);

    for (const [key, sid] of SERVICES) {
      for (const dep of line.times[key]) {
        const id = `${line.code}-${sid}-${dep}`;
        trips.push([line.code, sid, id, line.to]);
        seq.forEach((s, i) => {
          const t = hms(dep + offsets[i]);
          stopTimes.push(csvRow([id, t, t, s.no, i + 1]));
        });
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
    `Durak eşleşmesi: ${stopsMatched}/${stopsTotal} (%${Math.round((100 * stopsMatched) / Math.max(1, stopsTotal))}) OSM'de bulundu.`;
  return { files, report };
}
