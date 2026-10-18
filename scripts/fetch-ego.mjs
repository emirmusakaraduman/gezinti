// Ankara otobüs, metro ve Ankaray hatlarının hareket saatlerini ve durak listelerini EGO'nun
// herkese açık "Hareket Saatleri" sayfasından alır ve GTFS'e çevirir.
//
//   node scripts/fetch-ego.mjs            # çek (önbellekte olanı atla) + GTFS yaz
//   node scripts/fetch-ego.mjs --offline  # yalnızca önbellekten GTFS yaz
//
// Kaynak: https://www.ego.gov.tr/hareketsaatleri (robots.txt HTML sayfalarına
// izin veriyor). İstekler art arda değil, aralıklı atılır; yanıtlar
// .cache/ego altında saklanır, yeniden çalıştırmada tekrar istenmez.
//
// Sayfa hat başına kalkış saatlerini (hafta içi / cumartesi / pazar) ve geçilen
// durakların sırasını ve numarasını verir; durak KOORDİNATI vermez. Koordinatlar
// OSM'deki EGO duraklarından (ref = EGO durak no) alınır; OSM'de olmayan durak
// hattan çıkarılır. Duraklar arası süre gerçek değildir: sayfadaki toplam süre
// ("Süresi") mesafeyle orantılı dağıtılır. Kalkış saatleri gerçektir.
//
// Metro ve Ankaray için durak koordinatı OSM istasyonlarından gelir (ref = EGO
// kodu, yoksa ada göre); hattın ortasındaki bir istasyondan başlayan seferler
// ("… İSTASYONUNDAN BAŞLAYACAK") o istasyondan başlatılır.
//
// Çıktı: data/gtfs/raw/ankara-ego/*.txt (otobüs), ankara-ego-rail/*.txt (git dışında);
// ardından: node scripts/build-gtfs.mjs ankara
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildEgoGtfs, parseLinePage, parseLineOptions, stationKey } from "./lib/ego.mjs";

const USER_AGENT = "gezinti/0.1 (kisisel proje; https://github.com/emirmusakaraduman/gezinti)";
const BASE = "https://www.ego.gov.tr";
const CACHE = ".cache/ego";
const OUT = "data/gtfs/raw/ankara-ego";
const OUT_RAIL = "data/gtfs/raw/ankara-ego-rail";
const DELAY_MS = 1200;
const OFFLINE = process.argv.includes("--offline");
const BBOX = [39.6, 32.3, 40.2, 33.2];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(CACHE, { recursive: true });

/** field: hat_no1 (otobüs), hat_no2 (metro), hat_no3 (Ankaray) */
async function post(code, field = "hat_no1") {
  const res = await fetch(`${BASE}/HareketSaatleri`, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: `${field}=${encodeURIComponent(code)}`,
  });
  if (!res.ok) throw new Error(`EGO ${res.status}`);
  return res.text();
}

// Hat listesi
const listPath = `${CACHE}/_list.html`;
if (!existsSync(listPath)) {
  if (OFFLINE) throw new Error("Önbellekte hat listesi yok");
  const res = await fetch(`${BASE}/hareketsaatleri`, { headers: { "User-Agent": USER_AGENT } });
  writeFileSync(listPath, await res.text());
}
const codes = parseLineOptions(readFileSync(listPath, "utf8"));
console.log(`${codes.length} hat`);

// Hat sayfaları (önbellekten ya da aralıklı istekle)
const lines = [];
const railLines = [];
let fetched = 0;
let done = 0;
const list = readFileSync(listPath, "utf8");
const jobs = [
  ...codes.map((code) => ({ code, field: "hat_no1", prefix: "", out: lines, type: 3 })),
  ...[
    ["hat_liste_metro", "hat_no2"],
    ["hat_liste_ankaray", "hat_no3"],
  ].flatMap(([id, field]) =>
    parseLineOptions(list, id).map((code) => ({ code, field, prefix: "rail-", out: railLines, type: 1 })),
  ),
];
for (const job of jobs) {
  const file = `${CACHE}/${job.prefix}${job.code.replace(/[^\w-]/g, "_")}.html`;
  let html;
  if (existsSync(file)) html = readFileSync(file, "utf8");
  else if (OFFLINE) continue;
  else {
    for (let tries = 1; ; tries++) {
      try {
        html = await post(job.code, job.field);
        break;
      } catch (e) {
        if (tries >= 4) throw e;
        await sleep(5000 * tries);
      }
    }
    writeFileSync(file, html);
    fetched++;
    await sleep(DELAY_MS);
    if (fetched % 25 === 0) console.log(`  ${++done * 25} istek`);
  }
  const line = parseLinePage(html, job.code);
  if (line) job.out.push({ ...line, type: job.type });
}
console.log(`${lines.length} otobüs + ${railLines.length} raylı hat ayrıştırıldı (${fetched} yeni istek)`);
// OSM'deki EGO durakları: ref → konum
const osmPath = `${CACHE}/_osm-stops.json`;
if (!existsSync(osmPath)) {
  const [s, w, n, e] = BBOX;
  const q = `[out:json][timeout:180];node["highway"="bus_stop"]["ref"](${s},${w},${n},${e});out;`;
  let data;
  for (let tries = 1; ; tries++) {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(q)}`,
    });
    if (res.ok) {
      data = await res.json();
      break;
    }
    if (tries >= 5) throw new Error(`Overpass ${res.status}`);
    await sleep(5000 * tries);
  }
  writeFileSync(osmPath, JSON.stringify(data.elements.map((x) => [x.tags.ref, x.lat, x.lon, x.tags.name ?? ""])));
}
const osmStops = new Map();
for (const [ref, lat, lon] of JSON.parse(readFileSync(osmPath, "utf8"))) osmStops.set(String(ref).trim(), { lat, lng: lon });
console.log(`OSM'de ${osmStops.size} numaralı durak`);

function write(dir, built) {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(built.files)) writeFileSync(`${dir}/${name}`, content);
  console.log(built.report);
}
write(OUT, buildEgoGtfs(lines, osmStops));

// Raylı istasyonlar: OSM'de çoğunun ref'i EGO kodu (M32, A14…); yoksa ada göre
const stationPath = `${CACHE}/_osm-stations.json`;
if (!existsSync(stationPath)) {
  const [s, w, n, e] = BBOX;
  const q = `[out:json][timeout:120];node["railway"~"^(station|halt|stop)$"]["name"](${s},${w},${n},${e});out;`;
  let data;
  for (let tries = 1; ; tries++) {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(q)}`,
    });
    if (res.ok) {
      data = await res.json();
      break;
    }
    if (tries >= 5) throw new Error(`Overpass ${res.status}`);
    await sleep(5000 * tries);
  }
  writeFileSync(stationPath, JSON.stringify(data.elements.map((x) => [x.tags.ref ?? "", x.lat, x.lon, x.tags.name])));
}
const stations = JSON.parse(readFileSync(stationPath, "utf8")).map(([ref, lat, lng, name]) => ({
  ref: String(ref).trim(),
  key: stationKey(name),
  lat,
  lng,
}));
const byRef = new Map(stations.filter((x) => x.ref).map((x) => [x.ref, x]));
const unmatched = new Set();
function locateStation(stop) {
  const hit =
    byRef.get(stop.no) ??
    stations.find((x) => x.key === stationKey(stop.name)) ??
    stations.find((x) => {
      const k = stationKey(stop.name);
      return k.length >= 4 && x.key.length >= 4 && (x.key.startsWith(k) || k.startsWith(x.key));
    });
  if (!hit) unmatched.add(stop.name);
  return hit;
}
write(OUT_RAIL, buildEgoGtfs(railLines, locateStation));
if (unmatched.size) console.log(`Eşleşmeyen raylı duraklar: ${[...unmatched].join("; ")}`);
