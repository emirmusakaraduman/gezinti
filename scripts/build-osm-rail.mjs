// Resmi GTFS'i olmayan şehirler için OpenStreetMap'teki raylı sistem
// hatlarından (PTv2 route ilişkileri) GTFS biçiminde sentetik tarife üretir.
//
//   node scripts/build-osm-rail.mjs ankara        # raylı sistem
//   node scripts/build-osm-rail.mjs ankara bus    # otobüs hatları (EGO)
//
// İstasyon sırası ve konumları OSM'den gelir. Sefer saatleri gerçek tarife
// DEĞİLDİR: istasyonlar arası süre mesafeden (ortalama hız + durak bekleme),
// sefer sıklığı hat başına tahmini bir değerden türetilir. Derleme bu veriyi
// "sentetik" işaretler; planlar bu ayakları tahmini gösterir.
//
// Çıktı: data/gtfs/raw/<şehir>-osm-rail|osm-bus/*.txt (git dışında);
// ardından: node scripts/build-gtfs.mjs <şehir>
import { mkdirSync, writeFileSync } from "node:fs";

const USER_AGENT = "gezinti/0.1 (kisisel proje; https://github.com/emirmusakaraduman/gezinti)";

/**
 * Hatlar: OSM route ilişkisinin ref'i → görünen ad, GTFS route_type,
 * tahmini sefer aralığı (dk) ve ortalama hız (km/s)
 */
const CITIES = {
  ankara: {
    bbox: [39.75, 32.4, 40.15, 33.1],
    lines: {
      M1: { name: "M1", type: 1, headwayMin: 5, kmh: 35 },
      M2: { name: "M2", type: 1, headwayMin: 7, kmh: 35 },
      M3: { name: "M3", type: 1, headwayMin: 10, kmh: 40 },
      M4: { name: "M4", type: 1, headwayMin: 7, kmh: 35 },
      A: { name: "Ankaray", type: 1, headwayMin: 5, kmh: 30 },
      B1: { name: "Başkentray", type: 2, headwayMin: 15, kmh: 40 },
    },
    service: { start: "06:00:00", end: "24:00:00" },
    // Her otobüs hattı için tek, tahmini değer (gerçek sıklık bilinmiyor)
    bus: { headwayMin: 20, kmh: 20, dwellS: 20, service: { start: "06:00:00", end: "23:00:00" } },
  },
};

const DWELL_S = 30;

/**
 * İlişkinin raylı yol parçalarını (sıralı way üyeleri) tek çizgide birleştirir.
 * Parça uçları eşleşmiyorsa (boşluk) düz çizgiyle bağlanır. Peron/durak
 * yolları (rolü boş olmayanlar) dahil edilmez. Dönen: [{lat, lon}]
 */
function chainWays(relation) {
  const ways = (relation?.members ?? []).filter(
    (m) => m.type === "way" && m.geometry?.length >= 2 && !/platform|stop/.test(m.role),
  );
  const line = [];
  for (const way of ways) {
    let pts = way.geometry;
    if (line.length) {
      const end = line.at(-1);
      // Yön: sondaki noktaya yakın uç öne gelsin
      if (haversineM(end, pts[0]) > haversineM(end, pts.at(-1))) pts = [...pts].reverse();
    }
    line.push(...pts);
  }
  // Art arda aynı noktaları ve geri dönüşlü tekrarları ayıkla
  return line.filter((p, i) => i === 0 || p.lat !== line[i - 1].lat || p.lon !== line[i - 1].lon);
}

/** Çizgi durak sırasının tersine akıyorsa çevirir */
function orientTo(line, seq) {
  if (line.length < 2) return line;
  const nearest = (pt) => line.reduce((best, p, i) => (haversineM(p, pt) < haversineM(line[best], pt) ? i : best), 0);
  return nearest(seq[0]) > nearest(seq.at(-1)) ? [...line].reverse() : line;
}

function haversineM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const hms = (sec) =>
  [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60].map((n) => String(n).padStart(2, "0")).join(":");

const csv = (rows) =>
  rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n") + "\n";

const cityId = process.argv[2];
const cfg = CITIES[cityId];
if (!cfg) {
  console.error(`Kullanım: node scripts/build-osm-rail.mjs <${Object.keys(CITIES).join("|")}>`);
  process.exit(1);
}

const BUS = process.argv[3] === "bus";
if (BUS && !cfg.bus) {
  console.error(`${cityId} için otobüs yapılandırması yok`);
  process.exit(1);
}

const [s, w, n, e] = cfg.bbox;
const refs = Object.keys(cfg.lines).join("|");
// Raylı: yalnızca tanımlı hatlar. Otobüs: ref'i olan tüm otobüs ilişkileri.
const relFilter = BUS
  ? `relation["route"="bus"]["ref"](${s},${w},${n},${e})`
  : `relation["route"~"^(subway|light_rail|train)$"]["ref"~"^(${refs})$"](${s},${w},${n},${e})`;
const query = `[out:json][timeout:180];
${relFilter};
out body;
node(r);
out body;`;
const service = BUS ? cfg.bus.service : cfg.service;

// Overpass zaman zaman 429/502/504 döner; artan beklemeyle yeniden dene
async function overpass(q, tries = 5) {
  for (let i = 1; ; i++) {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(q)}`,
    });
    if (res.ok) return res.json();
    if (i >= tries || ![429, 502, 503, 504].includes(res.status)) throw new Error(`Overpass ${res.status}`);
    console.warn(`  Overpass ${res.status}, ${5 * i} sn sonra yeniden deneniyor`);
    await new Promise((r) => setTimeout(r, 5000 * i));
  }
}
const data = await overpass(query);

// Raylı hat geometrisi: ilişkilerin yol (way) üyeleri, koordinatlarıyla.
// Otobüs çizgisini rota ajanı yol ağına oturtarak çizer; şekil gerekmez.
const geomByRelation = BUS
  ? new Map()
  : new Map(
      (await overpass(`[out:json][timeout:120];
${relFilter};
out geom;`)).elements
        .filter((x) => x.type === "relation")
        .map((r) => [r.id, r]),
    );

const nodes = new Map(data.elements.filter((x) => x.type === "node").map((x) => [x.id, x]));
const relations = data.elements.filter((x) => x.type === "relation" && (BUS || cfg.lines[x.tags.ref]));

/** İlişkinin hattı: rayda yapılandırmadan, otobüste ilişkinin kendisinden */
const lines = new Map(); // route_id → { name, longName, type, headwayMin, kmh, dwellS }
function lineOf(rel) {
  if (!BUS) {
    const l = cfg.lines[rel.tags.ref];
    lines.set(rel.tags.ref, { ...l, longName: l.name, dwellS: DWELL_S });
    return rel.tags.ref;
  }
  const id = `bus${rel.id}`;
  const from = rel.tags.from ?? "?";
  const to = rel.tags.to ?? "?";
  lines.set(id, { name: rel.tags.ref, longName: `${rel.tags.ref}: ${from} - ${to}`, type: 3, ...cfg.bus });
  return id;
}

const stops = new Map(); // node id → { name, lat, lon }
const trips = [];
for (const rel of relations) {
  const routeId = lineOf(rel);
  const line = lines.get(routeId);
  // PTv2: durak konumları "stop" rolünde; yoksa peron düğümleri
  const pick = (re) => rel.members.filter((m) => m.type === "node" && re.test(m.role) && nodes.has(m.ref)).map((m) => nodes.get(m.ref));
  let seq = pick(/^stop/);
  if (seq.length < 2) seq = pick(/^platform/);
  if (seq.length < 2) {
    console.warn(`  ! ${rel.tags.name}: durak bulunamadı, atlandı`);
    continue;
  }
  // Aynı istasyonun art arda iki kez geçtiği bozuk kayıtları ayıkla
  seq = seq.filter((nd, i) => i === 0 || nd.id !== seq[i - 1].id);

  let t = 0;
  const times = seq.map((nd, i) => {
    if (i > 0) {
      const m = haversineM(seq[i - 1], nd);
      t += Math.max(60, Math.round(m / ((line.kmh * 1000) / 3600)) + line.dwellS);
    }
    const name = nd.tags?.name ?? `${line.name} durağı`;
    stops.set(nd.id, { name, lat: nd.lat, lon: nd.lon });
    return { stop: nd.id, offset: t };
  });
  const shape = orientTo(chainWays(geomByRelation.get(rel.id)), seq);
  trips.push({ id: `osm${rel.id}`, route: routeId, headsign: rel.tags.to ?? "", times, shape });
  if (!BUS) console.log(`  ${line.name}: ${rel.tags.from ?? "?"} → ${rel.tags.to ?? "?"}, ${seq.length} durak, ${Math.round(t / 60)} dk`);
}

const startSec = (() => {
  const [h, m, sec] = service.start.split(":").map(Number);
  return h * 3600 + m * 60 + sec;
})();

const dir = `data/gtfs/raw/${cityId}-osm-${BUS ? "bus" : "rail"}`;
if (BUS) console.log(`  ${relations.length} otobüs ilişkisi, ${trips.length} sefer şablonu`);
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/agency.txt`, csv([["agency_id", "agency_name", "agency_url", "agency_timezone"], ["1", `${BUS ? "Otobüs" : "Raylı sistem"} (OSM, sentetik tarife)`, "https://www.openstreetmap.org", "Europe/Istanbul"]]));
writeFileSync(`${dir}/calendar.txt`, csv([["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"], ["ALL", 1, 1, 1, 1, 1, 1, 1, "20260101", "20301231"]]));
writeFileSync(
  `${dir}/routes.txt`,
  csv([["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"], ...[...lines].filter(([id]) => trips.some((t) => t.route === id)).map(([id, l]) => [id, "1", l.name, l.longName, l.type])]),
);
writeFileSync(`${dir}/stops.txt`, csv([["stop_id", "stop_name", "stop_lat", "stop_lon"], ...[...stops].map(([id, st]) => [id, st.name, st.lat, st.lon])]));
writeFileSync(`${dir}/trips.txt`, csv([["route_id", "service_id", "trip_id", "trip_headsign", "shape_id"], ...trips.map((t) => [t.route, "ALL", t.id, t.headsign, t.shape.length >= 2 ? t.id : ""])]));
writeFileSync(
  `${dir}/shapes.txt`,
  csv([
    ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"],
    ...trips.filter((t) => t.shape.length >= 2).flatMap((t) => t.shape.map((p, i) => [t.id, p.lat, p.lon, i + 1])),
  ]),
);
writeFileSync(
  `${dir}/stop_times.txt`,
  csv([
    ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
    ...trips.flatMap((t) => t.times.map((x, i) => [t.id, hms(startSec + x.offset), hms(startSec + x.offset), x.stop, i + 1])),
  ]),
);
writeFileSync(
  `${dir}/frequencies.txt`,
  csv([
    ["trip_id", "start_time", "end_time", "headway_secs"],
    ...trips.map((t) => [t.id, service.start, service.end, lines.get(t.route).headwayMin * 60]),
  ]),
);
console.log(`Yazıldı: ${dir} (${trips.length} sefer şablonu, ${stops.size} durak)`);
