// Raylı sistem hatlarının gerçek geometrisi için OpenStreetMap'teki ray
// yollarını (way) indirir. build-gtfs.mjs, şekli olmayan (veya yalnızca durak
// noktalarından oluşan) raylı kalıpların çizgisini bu ağ üzerinde en kısa yolla
// kurar.
//
//   node scripts/fetch-rail-geometry.mjs istanbul izmir ankara
//
// Çıktı: data/gtfs/raw/<şehir>-osm-railways.json  ([[lat, lng, lat, lng, …], …])
import { mkdirSync, writeFileSync } from "node:fs";
import { overpass } from "./lib/common.mjs";

// build-gtfs.mjs'teki bbox'larla aynı
const BBOX = {
  istanbul: [40.7, 27.9, 41.7, 29.95],
  izmir: [37.7, 26.1, 39.5, 28.6],
  ankara: [39.6, 32.3, 40.2, 33.2],
};

const cities = process.argv.slice(2);
if (!cities.length || cities.some((c) => !BBOX[c])) {
  console.error(`Kullanım: node scripts/fetch-rail-geometry.mjs <${Object.keys(BBOX).join("|")}>…`);
  process.exit(1);
}

for (const city of cities) {
  const [s, w, n, e] = BBOX[city];
  // Depo/yan hatlar hariç; crossover (çift hattı birbirine bağlayan geçişler)
  // kalmalı, yoksa iki yöndeki ray ağı birbirinden kopuk çıkar
  const data = await overpass(`[out:json][timeout:240];
way["railway"~"^(subway|light_rail|tram|rail|funicular)$"]["service"!~"^(yard|siding|spur|driveway)$"]["usage"!="industrial"](${s},${w},${n},${e});
out geom qt;`);
  const ways = data.elements
    .filter((x) => x.type === "way" && x.geometry?.length >= 2)
    .map((x) => x.geometry.flatMap((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6]));
  mkdirSync("data/gtfs/raw", { recursive: true });
  writeFileSync(`data/gtfs/raw/${city}-osm-railways.json`, JSON.stringify(ways));
  console.log(`${city}: ${ways.length} ray yolu`);
}
