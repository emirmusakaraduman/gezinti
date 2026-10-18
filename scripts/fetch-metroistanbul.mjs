// Metro İstanbul hatlarının (M1A-M9, F1, F4, T1-T5, TF1-TF2) güncel sefer saatlerini
// İBB Açık Veri'deki "Metro İstanbul Sefer Tarifeleri Listesi" web servisinden alır
// ve GTFS'e çevirir. build-gtfs.mjs, İBB'nin süresi dolmuş (2024) GTFS'indeki aynı
// adlı Metro İstanbul hatlarını bu veriyle değiştirir.
//
//   node scripts/fetch-metroistanbul.mjs            # çek (önbellekte olanı atla) + GTFS yaz
//   node scripts/fetch-metroistanbul.mjs --offline  # yalnızca önbellekten GTFS yaz
//
// Servis: https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2 (GetLines,
// GetStations, GetDirections, GetTimeTable). GetTimeTable bir istasyon + yön + an için
// o andan sonraki ~1 saatlik kalkışları verir; her yönün başlangıç istasyonu için
// gün boyunca saat saat zincirleme çağrılır (hafta içi / cumartesi / pazar için ayrı
// bir örnek tarih). İstasyon koordinatları servisten gelir. Ara istasyon saatleri
// gerçek değildir: terminalden son istasyona süre, ilk seferin iki istasyondaki
// saatinden ölçülür ve mesafeyle orantılı dağıtılır; kalkış saatleri gerçektir.
//
// Not: GetDirections zaman zaman 500 döner; bu durumda yön kimlikleri, ilk istasyona
// GetTimeTable ile aralıklı sorularak bulunur.
//
// Çıktı: data/gtfs/raw/istanbul-metro-ibb/*.txt (git dışında)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { haversineM, overpass, sleep, USER_AGENT } from "./lib/common.mjs";
import { buildMetroGtfs, orderForDirection, timesToSeconds } from "./lib/metroistanbul.mjs";

const BASE = "https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2";
const CACHE = ".cache/metroistanbul";
const OUT = "data/gtfs/raw/istanbul-metro-ibb";
const DELAY_MS = 350;
const OFFLINE = process.argv.includes("--offline");
const PROBE_MAX_ID = 110;

mkdirSync(CACHE, { recursive: true });

const readJson = (f, fallback) => (existsSync(`${CACHE}/${f}`) ? JSON.parse(readFileSync(`${CACHE}/${f}`, "utf8")) : fallback);
const writeJson = (f, v) => writeFileSync(`${CACHE}/${f}`, JSON.stringify(v));

async function call(path, body) {
  for (let tries = 1; ; tries++) {
    try {
      const res = await fetch(`${BASE}/${path}`, {
        method: body ? "POST" : "GET",
        headers: { "User-Agent": USER_AGENT, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) return await res.json();
      if (res.status < 500 && res.status !== 429) return null;
      if (tries >= 3) return null;
    } catch {
      if (tries >= 3) return null;
    }
    await sleep(3000 * tries);
  }
}

const typeOf = (name) => (/^TF/.test(name) ? 6 : /^F/.test(name) ? 7 : /^T/.test(name) ? 0 : 1);

// 1. Hatlar ve istasyonlar
let lines = readJson("lines.json", null);
let stations = readJson("stations.json", null);
if (!lines || !stations) {
  if (OFFLINE) throw new Error("Önbellekte hat/istasyon yok");
  lines = (await call("GetLines"))?.Data?.map((l) => ({ id: l.Id, name: l.Name, type: typeOf(l.Name) }));
  stations = (await call("GetStations"))?.Data;
  if (!lines || !stations) throw new Error("GetLines/GetStations alınamadı");
  writeJson("lines.json", lines);
  writeJson("stations.json", stations);
}
const stationsByLine = {};
for (const s of stations) (stationsByLine[s.LineName] ??= []).push(s);
for (const v of Object.values(stationsByLine)) v.sort((a, b) => a.Order - b.Order);
const stationsByLine0 = (name) => stationsByLine[name] ?? [];

// Servis bazı istasyonlar için koordinat vermiyor (ör. M5 Sultanbeyli kolu): OSM'deki
// aynı adlı raylı istasyonlardan, hattaki komşu istasyona en yakın olanı alınır.
const hasCoord = (s) => Number(s.DetailInfo?.Latitude) && Number(s.DetailInfo?.Longitude);
const missing = stations.filter((s) => !hasCoord(s));
if (missing.length) {
  const filled = readJson("missing-coords.json", {});
  for (const s of missing) {
    if (!(s.Id in filled) && !OFFLINE) {
      const name = String(s.Description || s.Name).replace(/"/g, "");
      const data = await overpass(`[out:json][timeout:60];
node["railway"~"^(station|halt|stop)$"]["name"="${name}"](40.7,28.5,41.5,30.1);
out;`);
      const line = stationsByLine0(s.LineName);
      const idx = line.findIndex((x) => x.Id === s.Id);
      const neighbor = [line[idx - 1], line[idx + 1]].find((x) => x && hasCoord(x));
      const ref = neighbor ? { lat: Number(neighbor.DetailInfo.Latitude), lng: Number(neighbor.DetailInfo.Longitude) } : null;
      const best = data.elements
        .map((e) => ({ lat: e.lat, lng: e.lon, d: ref ? haversineM(ref, { lat: e.lat, lng: e.lon }) : 0 }))
        .sort((a, b) => a.d - b.d)[0];
      filled[s.Id] = best && (!ref || best.d < 6000) ? [best.lat, best.lng] : null;
      writeJson("missing-coords.json", filled);
      await sleep(1000);
    }
    const c = filled[s.Id];
    if (c) s.DetailInfo = { ...s.DetailInfo, Latitude: String(c[0]), Longitude: String(c[1]) };
  }
  console.log(`Koordinatsız ${missing.length} istasyon: ${missing.filter(hasCoord).length} tanesi OSM'den tamamlandı`);
}
console.log(`${lines.length} hat, ${stations.length} istasyon`);

// Yönler: { line, id, name }
async function probeLine(line, stationId, from, to) {
  const found = [];
  for (let id = from; id <= to; id++) {
    const r = await call("GetTimeTable", { BoardingStationId: stationId, DirectionId: id, DateTime: "2026-10-20T10:00:00" });
    const d = r?.Success ? r.Data?.[0] : null;
    if (d) found.push({ line: line.name, id, name: `${d.FirstStation}->${d.LastStation}` });
    await sleep(200);
  }
  return found;
}

let directions = readJson("directions.json", null);
if (!directions) {
  if (OFFLINE) throw new Error("Önbellekte yön listesi yok");
  const res = await call("GetDirections");
  if (res?.Data?.length) {
    directions = res.Data.map((d) => ({ line: d.LineName, id: d.DirectionId, name: d.DirectionName }));
  } else {
    console.log("GetDirections başarısız; yön kimlikleri GetTimeTable ile aranıyor…");
    directions = [];
    for (const line of lines) {
      const sts = stationsByLine[line.name];
      if (!sts?.length) continue;
      directions.push(...(await probeLine(line, sts[0].Id, 1, PROBE_MAX_ID)));
      console.log(`  ${line.name}: ${directions.filter((d) => d.line === line.name).length} yön`);
    }
  }
  writeJson("directions.json", directions);
}

// Servis hatları kesimlere bölebilir (ör. M7) ya da yönleri yüksek kimliklerle tutabilir
// (ör. M5). Hattın tamamını kapsayan yön yoksa, orta ve son istasyonlarda da aranır.
const coversWhole = (line) =>
  directions.some(
    (d) => d.line === line.name && orderForDirection(stationsByLine[line.name] ?? [], d.name)?.length === stationsByLine[line.name]?.length,
  );
if (!OFFLINE) {
  let extended = false;
  for (const line of lines) {
    const sts = stationsByLine[line.name];
    if (!sts?.length || coversWhole(line)) continue;
    const known = new Set(directions.filter((d) => d.line === line.name).map((d) => d.id));
    const have = directions.some((d) => d.line === line.name);
    const spots = [sts.at(-1), sts[Math.floor(sts.length / 2)]];
    for (const st of spots) {
      for (const d of await probeLine(line, st.Id, 1, have ? PROBE_MAX_ID : 300)) {
        if (!known.has(d.id)) {
          known.add(d.id);
          directions.push(d);
          extended = true;
        }
      }
    }
    console.log(`  ${line.name}: genişletilmiş arama, ${directions.filter((d) => d.line === line.name).length} yön`);
  }
  if (extended) writeJson("directions.json", directions);
}
console.log(`${directions.length} yön`);

// 2. Örnek tarihler: gelecekteki ilk Salı / Cumartesi / Pazar
function nextDate(dow) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const DATES = { wd: nextDate(2), sat: nextDate(6), sun: nextDate(0) };

// 3. Zaman çizelgeleri (önbellekli; kesintide kaldığı yerden devam eder)
const ttCache = readJson("timetables.json", {});
let calls = 0;
async function window(stationId, directionId, date, hhmm) {
  const key = `${stationId}|${directionId}|${date}|${hhmm}`;
  if (key in ttCache) return ttCache[key];
  if (OFFLINE) return [];
  const r = await call("GetTimeTable", { BoardingStationId: stationId, DirectionId: directionId, DateTime: `${date}T${hhmm}:00` });
  ttCache[key] = r?.Success ? (r.Data?.[0]?.TimeInfos?.Times ?? []) : [];
  if (++calls % 40 === 0) {
    writeJson("timetables.json", ttCache);
    console.log(`  ${calls} çağrı`);
  }
  await sleep(DELAY_MS);
  return ttCache[key];
}

/** Gün boyu kalkışlar: 04:00'dan başlayıp son kalkıştan 1 dk sonrasını sorarak ilerler */
async function dayDepartures(stationId, directionId, date) {
  const all = [];
  let cursor = 4 * 60;
  let started = false;
  for (let i = 0; i < 40 && cursor < 24 * 60; i++) {
    const hh = String(Math.floor(cursor / 60)).padStart(2, "0");
    const mm = String(cursor % 60).padStart(2, "0");
    const times = await window(stationId, directionId, date, `${hh}:${mm}`);
    const secs = timesToSeconds(times).filter((s) => !all.includes(s));
    if (!secs.length) {
      if (started) break;
      cursor += 60; // henüz sefer başlamadı
      continue;
    }
    started = true;
    all.push(...secs);
    const last = Math.max(...secs);
    // Gece yarısından sonrasına taşan saatler (>= 24 sa) bu güne sayılır, zincir biter
    if (last >= 24 * 3600) break;
    cursor = Math.floor(last / 60) + 1;
  }
  return all.sort((a, b) => a - b);
}

const depCache = new Map(); // `${dirId}|${day}` → saniyeler
const travelCache = new Map();
const plan = [];
for (const dir of directions) {
  const ordered = orderForDirection(stationsByLine[dir.line] ?? [], dir.name);
  if (ordered && ordered.length >= 2) plan.push({ dir, ordered });
}
console.log(`${plan.length}/${directions.length} yön istasyon sırasıyla eşleşti`);

for (const { dir, ordered } of plan) {
  const first = ordered[0];
  for (const [day, date] of Object.entries(DATES)) {
    depCache.set(`${dir.id}|${day}`, await dayDepartures(first.Id, dir.id, date));
  }
  // Toplam süre: ilk sefer son istasyondan bir öncekine kaç dakikada varıyor
  const penult = ordered.at(-2);
  const t0 = depCache.get(`${dir.id}|wd`)?.[0];
  const times = await window(penult.Id, dir.id, DATES.wd, "04:00");
  const tp = timesToSeconds(times).find((s) => t0 !== undefined && s > t0);
  const pts = ordered.map((s) => ({ lat: Number(s.DetailInfo?.Latitude), lng: Number(s.DetailInfo?.Longitude) }));
  if (tp !== undefined && pts.every((p) => p.lat && p.lng)) {
    let cumP = 0;
    let cumAll = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = haversineM(pts[i - 1], pts[i]);
      cumAll += d;
      if (i <= pts.length - 2) cumP += d;
    }
    const sec = Math.round(((tp - t0) * cumAll) / (cumP || 1));
    if (sec > 60 && sec < 4 * 3600) travelCache.set(dir.id, sec);
  }
  writeJson("timetables.json", ttCache);
  console.log(`  ${dir.line} ${dir.name}: ${["wd", "sat", "sun"].map((d) => depCache.get(`${dir.id}|${d}`).length).join("/")} sefer`);
}
writeJson("timetables.json", ttCache);

const { files, report } = buildMetroGtfs({
  lines,
  directions: plan.map((p) => p.dir),
  stationsByLine,
  departures: (id, day) => depCache.get(`${id}|${day}`) ?? [],
  travelSec: (id) => travelCache.get(id) ?? null,
});
mkdirSync(OUT, { recursive: true });
for (const [name, content] of Object.entries(files)) writeFileSync(`${OUT}/${name}`, content);
console.log(report);
console.log(`Örnek tarihler: ${Object.entries(DATES).map(([k, v]) => `${k}=${v}`).join(", ")}`);
