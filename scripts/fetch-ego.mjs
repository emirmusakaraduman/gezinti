// Ankara otobüs hatlarının hareket saatlerini ve durak listelerini EGO'nun
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
// Çıktı: data/gtfs/raw/ankara-ego/*.txt (git dışında);
// ardından: node scripts/build-gtfs.mjs ankara
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildEgoGtfs, parseLinePage, parseLineOptions } from "./lib/ego.mjs";

const USER_AGENT = "gezinti/0.1 (kisisel proje; https://github.com/emirmusakaraduman/gezinti)";
const BASE = "https://www.ego.gov.tr";
const CACHE = ".cache/ego";
const OUT = "data/gtfs/raw/ankara-ego";
const DELAY_MS = 1200;
const OFFLINE = process.argv.includes("--offline");
const BBOX = [39.6, 32.3, 40.2, 33.2];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(CACHE, { recursive: true });

async function post(code) {
  const res = await fetch(`${BASE}/HareketSaatleri`, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: `hat_no1=${encodeURIComponent(code)}`,
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

// Hat sayfaları
const lines = [];
let fetched = 0;
for (const [i, code] of codes.entries()) {
  const file = `${CACHE}/${code.replace(/[^\w-]/g, "_")}.html`;
  let html;
  if (existsSync(file)) html = readFileSync(file, "utf8");
  else if (OFFLINE) continue;
  else {
    for (let tries = 1; ; tries++) {
      try {
        html = await post(code);
        break;
      } catch (e) {
        if (tries >= 4) throw e;
        await sleep(5000 * tries);
      }
    }
    writeFileSync(file, html);
    fetched++;
    await sleep(DELAY_MS);
    if (fetched % 25 === 0) console.log(`  ${i + 1}/${codes.length}`);
  }
  const line = parseLinePage(html, code);
  if (line) lines.push(line);
}
console.log(`${lines.length} hat ayrıştırıldı (${fetched} yeni istek)`);

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

const { files, report } = buildEgoGtfs(lines, osmStops);
mkdirSync(OUT, { recursive: true });
for (const [name, content] of Object.entries(files)) writeFileSync(`${OUT}/${name}`, content);
console.log(report);
