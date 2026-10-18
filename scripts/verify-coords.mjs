// Elle girilmiş (source: "kurator") mekanların koordinatlarını OpenStreetMap
// ile karşılaştırır. Üretilmiş listedeki (places.json) yerler zaten OSM'den
// geldiği için kontrol edilmez.
//
//   node scripts/verify-coords.mjs            # rapor
//
// Her mekan için 1 km içinde adı eşleşen OSM nesnesi aranır; sapma
// THRESHOLD_M'yi aşarsa ya da bulunamazsa raporlanır. Dosyaları değiştirmez.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USER_AGENT = "gezinti/0.1 (kisisel proje; https://github.com/emirmusakaraduman/gezinti)";
const THRESHOLD_M = 150;
const CITIES = ["istanbul", "izmir", "ankara"];

const fold = (s) =>
  s
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function haversineM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** city.ts içindeki kurator kayıtları: { id, name, lat, lng } */
export function parseCurated(source) {
  const out = [];
  for (const block of source.split(/\n  \{\n/).slice(1)) {
    if (!/source: "kurator"/.test(block)) continue;
    const get = (re) => block.match(re)?.[1];
    const id = get(/id: "([^"]+)"/);
    const name = get(/name: "([^"]+)"/);
    const lat = Number(get(/lat: ([\d.]+)/));
    const lng = Number(get(/lng: ([\d.]+)/));
    if (id && name && lat && lng) out.push({ id, name, lat, lng });
  }
  return out;
}

/** Tek başına yer belirtmeyen sözcükler; eşleşmede sayılmaz */
const GENERIC = new Set(
  "cadde caddesi sokak sokagi bulvar bulvari meydan meydani muze muzesi cami camii carsi carsisi sahil sahili park parki tur turu ve ile ilkokulu lisesi okulu merkezi".split(" "),
);

/**
 * Adların ayırt edici sözcükleri (genel sözcükler çıkarılmış) kesişiyorsa
 * eşleşir; ayırt edici sözcük kalmazsa tam ad eşitliği/içermesi aranır.
 */
export function nameMatches(a, b) {
  const x = fold(a);
  const y = fold(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const key = (t) => t.split(" ").filter((w) => w.length > 2 && !GENERIC.has(w));
  const wa = key(x);
  const wb = new Set(key(y));
  if (!wa.length || !wb.size) return x.includes(y) || y.includes(x);
  const common = wa.filter((w) => wb.has(w)).length;
  return common >= Math.ceil(Math.min(wa.length, wb.size) / 2) && common > 0;
}

async function overpass(q, tries = 5) {
  for (let i = 1; ; i++) {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(q)}`,
    });
    if (res.ok) return res.json();
    if (i >= tries || ![429, 502, 503, 504].includes(res.status)) throw new Error(`Overpass ${res.status}`);
    await new Promise((r) => setTimeout(r, 5000 * i));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let flagged = 0;
  for (const city of CITIES) {
    const places = parseCurated(readFileSync(`data/cities/${city}.ts`, "utf8"));
    console.log(`\n${city} (${places.length} elle girilmiş mekan)`);
    for (const p of places) {
      const data = await overpass(`[out:json][timeout:60];
nwr["name"](around:1000,${p.lat},${p.lng});
out center tags;`);
      const hits = data.elements
        .map((e) => ({
          name: e.tags.name,
          lat: e.lat ?? e.center?.lat,
          lng: e.lon ?? e.center?.lon,
          kind: e.tags.tourism ?? e.tags.historic ?? e.tags.amenity ?? e.tags.shop ?? e.tags.leisure ?? e.tags.building ?? "",
        }))
        .filter((h) => h.lat && nameMatches(p.name, h.name))
        .map((h) => ({ ...h, d: Math.round(haversineM(p, h)) }))
        .sort((a, b) => a.d - b.d);
      const best = hits[0];
      const ok = best && best.d <= THRESHOLD_M;
      if (!ok) flagged++;
      console.log(
        `${ok ? "ok  " : "!!  "} ${p.name.padEnd(34)} ` +
          (best ? `${best.d} m  → OSM "${best.name}" (${best.lat.toFixed(5)}, ${best.lng.toFixed(5)}) ${best.kind}` : "OSM'de eşleşme yok"),
      );
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.log(`\n${flagged} mekan kontrol gerektiriyor`);
}
