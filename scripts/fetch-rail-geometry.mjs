// Raylı sistem hatlarının gerçek geometrisi için OpenStreetMap'teki ray
// yollarını (way) indirir. build-gtfs.mjs, şekli olmayan (veya yalnızca durak
// noktalarından oluşan) raylı kalıpların çizgisini bu ağ üzerinde en kısa yolla
// kurar.
//
//   node scripts/fetch-rail-geometry.mjs istanbul izmir
//
// Çıktı: data/gtfs/raw/<şehir>-osm-railways.json  ([[lat, lng, lat, lng, …], …])
import { mkdirSync, writeFileSync } from "node:fs";

const USER_AGENT = "gezinti/0.1 (kisisel proje; https://github.com/emirmusakaraduman/gezinti)";

// build-gtfs.mjs'teki bbox'larla aynı
const BBOX = {
  istanbul: [40.7, 27.9, 41.7, 29.95],
  izmir: [37.7, 26.1, 39.5, 28.6],
};

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

const cities = process.argv.slice(2);
if (!cities.length || cities.some((c) => !BBOX[c])) {
  console.error(`Kullanım: node scripts/fetch-rail-geometry.mjs <${Object.keys(BBOX).join("|")}>…`);
  process.exit(1);
}

for (const city of cities) {
  const [s, w, n, e] = BBOX[city];
  // Servis/depo yolları ve terk edilmiş hatlar hariç
  const data = await overpass(`[out:json][timeout:240];
way["railway"~"^(subway|light_rail|tram|rail|funicular)$"]["service"!~"."]["usage"!="industrial"](${s},${w},${n},${e});
out geom qt;`);
  const ways = data.elements
    .filter((x) => x.type === "way" && x.geometry?.length >= 2)
    .map((x) => x.geometry.flatMap((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6]));
  mkdirSync("data/gtfs/raw", { recursive: true });
  writeFileSync(`data/gtfs/raw/${city}-osm-railways.json`, JSON.stringify(ways));
  console.log(`${city}: ${ways.length} ray yolu`);
}
