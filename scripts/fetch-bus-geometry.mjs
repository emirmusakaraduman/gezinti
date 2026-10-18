// Otobüs hatlarının gerçek güzergah çizgisi için OpenStreetMap'teki otobüs hat
// ilişkilerini (route=bus) indirir. Şekli olmayan GTFS kalıpları (İETT, EGO) için
// build-gtfs.mjs, aynı hat numaralı ilişkilerden durak dizisine en iyi oturanı seçer.
//
//   node scripts/build-gtfs.mjs istanbul        # önce: hat numaraları meta'dan okunur
//   node scripts/fetch-bus-geometry.mjs istanbul
//   node scripts/build-gtfs.mjs istanbul        # çizgiler eklenir
//
// Çıktı: data/gtfs/raw/<şehir>-osm-buslines.json
//   [{ ref, name, line: [lat, lng, lat, lng, …] }]  (1e-5 derece ≈ 1 m)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { overpass, sleep } from "./lib/common.mjs";
import { chainWays } from "./lib/osm-lines.mjs";

// build-gtfs.mjs'teki bbox'larla aynı
const BBOX = {
  istanbul: [40.7, 27.9, 41.7, 29.95],
  ankara: [39.6, 32.3, 40.2, 33.2],
};
const CHUNK = 30;
/** Yol parçaları arasındaki bu kadar sıçramalı (kopuk) ilişkiler atılır */
const MAX_JUMP_M = 250;
const DELAY_MS = 2000;
const CACHE = ".cache/buslines";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const city = process.argv[2];
if (!BBOX[city]) {
  console.error(`Kullanım: node scripts/fetch-bus-geometry.mjs <${Object.keys(BBOX).join("|")}>`);
  process.exit(1);
}
const metaPath = `data/gtfs/build/${city}.meta.json`;
if (!existsSync(metaPath)) {
  console.error(`Önce: node scripts/build-gtfs.mjs ${city}`);
  process.exit(1);
}

const meta = JSON.parse(readFileSync(metaPath, "utf8"));
const refs = [...new Set(meta.routes.filter((r) => r.type === 3).map((r) => r.name))].filter(Boolean);
console.log(`${refs.length} otobüs hat numarası`);

const [s, w, n, e] = BBOX[city];
mkdirSync(CACHE, { recursive: true });
const out = [];
let dropped = 0;
for (let i = 0; i < refs.length; i += CHUNK) {
  const chunk = refs.slice(i, i + CHUNK);
  const file = `${CACHE}/${city}-${i}.json`;
  let data;
  if (existsSync(file)) data = JSON.parse(readFileSync(file, "utf8"));
  else {
    data = await overpass(`[out:json][timeout:240];
relation["route"="bus"]["ref"~"^(${chunk.map(esc).join("|")})$"](${s},${w},${n},${e});
out geom qt;`);
    // Yalnızca yol üyeleri gerekir; önbellek küçük kalsın
    for (const el of data.elements) el.members = el.members?.filter((m) => m.type === "way");
    writeFileSync(file, JSON.stringify(data));
    await sleep(DELAY_MS);
  }
  for (const rel of data.elements.filter((x) => x.type === "relation")) {
    const { line, maxJumpM } = chainWays(rel);
    if (line.length < 2 || maxJumpM > MAX_JUMP_M) {
      dropped++;
      continue;
    }
    out.push({
      ref: rel.tags.ref,
      name: rel.tags.name ?? "",
      line: line.flatMap((p) => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5]),
    });
  }
  console.log(`  ${Math.min(i + CHUNK, refs.length)}/${refs.length}: ${out.length} ilişki`);
}
writeFileSync(`data/gtfs/raw/${city}-osm-buslines.json`, JSON.stringify(out));
console.log(`${out.length} otobüs güzergahı yazıldı (${dropped} kopuk ilişki atıldı)`);
