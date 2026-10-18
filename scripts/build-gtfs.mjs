// Şehirlerin GTFS verisini toplu taşıma yönlendiricisinin okuyacağı kompakt
// biçime dönüştürür.
//
//   node scripts/build-gtfs.mjs            # verisi olan tüm şehirler
//   node scripts/build-gtfs.mjs izmir      # tek şehir
//
//   Girdi:  data/gtfs/raw/... (her şehrin beslemeleri aşağıda, CITIES)
//   Çıktı:  data/gtfs/build/<şehir>.meta.json  (duraklar, hatlar, kalıplar)
//           data/gtfs/build/<şehir>.bin        (bağlantılar + yürüme aktarmaları)
//
// İstanbul verisi standart dışı: İETT dosyaları ';' ile ayrılmış, hat adları
// çift UTF-8 kodlanmış, koordinatlar binlik ayracıyla bozulmuş; toplu ulaşım
// dosyaları Windows-1254 kodlu ve bazı seferler frequencies.csv ile tanımlı.
// Okuyucu bunları otomatik algılar; standart veriyi (İzmir) olduğu gibi okur.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decode, fixMojibake, parseCoord, parseTime } from "./lib/text.mjs";

const RAW = "data/gtfs/raw";
const OUT = "data/gtfs/build";
// 2: hat şekilleri (patStopShapePt, shapeLat, shapeLng) eklendi
export const FORMAT_VERSION = 2;

/**
 * Şehir yapılandırması. bbox dışındaki (bozuk) koordinatlar atılır.
 * Bir beslemenin stopTimes alanı, varsayılan stop_times dosyası yerine
 * kullanılacak dosyayı verir (yoksa varsayılana düşülür).
 */
const CITIES = {
  istanbul: {
    bbox: { minLat: 40.7, maxLat: 41.7, minLng: 27.9, maxLng: 29.95 },
    source: "İBB Açık Veri Portalı (data.ibb.gov.tr): İETT GTFS, Toplu Ulaşım GTFS",
    feeds: [
      { name: "transit", dir: `${RAW}/transit` },
      // İETT'nin portaldaki stop_times.csv'si kesik (seferlerin ~%14'ü);
      // tam veri ayrı zip içinde
      { name: "iett", dir: `${RAW}/iett`, stopTimes: `${RAW}/iett-zip/stop_times.txt` },
    ],
  },
  izmir: {
    // İl geneli: Selçuk–Bergama, Çeşme–Kiraz
    bbox: { minLat: 37.7, maxLat: 39.5, minLng: 26.1, maxLng: 28.6 },
    source: "İzmir BB Açık Veri Portalı (acikveri.bizizmir.com): ESHOT, Metro, Tramvay, İZBAN GTFS",
    feeds: ["eshot", "metro", "tram", "izban"].map((name) => ({ name, dir: `${RAW}/izmir/${name}` })),
  },
};

// Şehir verilmezse verisi olan her şehri ayrı süreçte derle (durum karışmasın)
const CITY = process.argv[2];
if (!CITY) {
  const ready = Object.entries(CITIES).filter(([, c]) => c.feeds.some((f) => existsSync(f.dir)));
  if (!ready.length) console.warn("Hiçbir şehrin ham GTFS verisi yok (data/gtfs/raw)");
  let failed = false;
  for (const [id] of ready) {
    console.log(`\n========== ${id} ==========`);
    const r = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), id], {
      stdio: "inherit",
    });
    failed ||= r.status !== 0;
  }
  process.exit(failed ? 1 : 0);
}
const CONFIG = CITIES[CITY];
if (!CONFIG) {
  console.error(`Bilinmeyen şehir: ${CITY} (bilinenler: ${Object.keys(CITIES).join(", ")})`);
  process.exit(1);
}
const BBOX = CONFIG.bbox;
const TRANSFER_RADIUS_M = 500;
const WALK_M_PER_S = 4.5 / 3.6;
const ROAD_FACTOR = 1.3;
const TRANSFER_PENALTY_S = 60;
// 9: minibüs, 10: taksi-dolmuş (İBB'ye özgü tipler). Gezgin rotası için
// gereksiz, verisi de güvenilmez; bağlantı sayısını 20 kat şişiriyordu.
const EXCLUDED_ROUTE_TYPES = new Set([9, 10]);

// ---------- Okuma ve kod çözme ----------


function detectDelimiter(text) {
  const firstLine = text.slice(0, text.indexOf("\n"));
  return firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
}

/**
 * Büyük, tırnaksız dosyalar için hızlı satır geçişi: her satır için nesne
 * üretmez, alan dizisini ve başlık indekslerini verir.
 */
function eachRow(path, cb) {
  const text = decode(readFileSync(path)).replace(/^﻿/, "");
  const delim = detectDelimiter(text);
  let pos = text.indexOf("\n") + 1;
  const header = text.slice(0, pos).trim().split(delim).map((h) => h.trim());
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  while (pos < text.length) {
    let end = text.indexOf("\n", pos);
    if (end === -1) end = text.length;
    const line = text.slice(pos, end).replace(/\r$/, "");
    pos = end + 1;
    if (line) cb(line.split(delim), col);
  }
}

/** GTFS dosyasının yolu: standart .txt, yoksa İBB'nin kullandığı .csv */
function gtfsPath(dir, base) {
  const txt = `${dir}/${base}.txt`;
  return existsSync(txt) ? txt : `${dir}/${base}.csv`;
}

/** Tırnaklı alanları destekleyen basit CSV ayrıştırıcı; ayracı başlıktan bulur */
function readCsv(path, { required = true } = {}) {
  if (!existsSync(path)) {
    if (required) throw new Error(`Eksik dosya: ${path}`);
    return [];
  }
  const text = decode(readFileSync(path)).replace(/^﻿/, "");
  const delim = detectDelimiter(text);

  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// ---------- Ayrıştırma yardımcıları ----------

const DAY_FIELDS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function haversineM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- Ortak tablolar ----------

const stops = []; // { name, lat, lng }
const stopIndex = new Map(); // "feed:stop_id" → index
const routes = []; // { name, longName, type, agency }
const patterns = []; // durak index dizileri
const patternIndex = new Map(); // "route|s1,s2,..." → index
const patternShape = []; // kalıp → şekil index'i (-1: şekil yok)
const shapes = []; // şekil → [[lat, lng], ...]
const shapeIndex = new Map(); // "feed:shape_id" → index
const trips = []; // { route, pattern }
// Bağlantılar düz dizilerde: [depStop, arrStop, depTime, arrTime, trip, dayMask]
const conns = [];

function addFeed({ name: feed, dir, stopTimes }) {
  console.log(`\n[${feed}] okunuyor…`);

  // Duraklar
  let dropped = 0;
  const stopsBefore = stops.length;
  for (const s of readCsv(gtfsPath(dir, "stops"))) {
    const lat = parseCoord(s.stop_lat);
    const lng = parseCoord(s.stop_lon);
    if (!(lat >= BBOX.minLat && lat <= BBOX.maxLat && lng >= BBOX.minLng && lng <= BBOX.maxLng)) {
      dropped++;
      continue;
    }
    stopIndex.set(`${feed}:${s.stop_id}`, stops.length);
    stops.push({ name: fixMojibake(s.stop_name), lat, lng });
  }
  console.log(`  duraklar: ${stops.length - stopsBefore} (bozuk koordinatlı ${dropped} atıldı)`);

  // Takvim → haftanın günü maskesi (bit 0 = Pazar, JS getDay ile aynı)
  const serviceMask = new Map();
  for (const c of readCsv(gtfsPath(dir, "calendar"), { required: false })) {
    let mask = 0;
    DAY_FIELDS.forEach((d, i) => {
      if (c[d] === "1") mask |= 1 << i;
    });
    serviceMask.set(c.service_id, mask);
  }
  // Takvimde olmayıp yalnızca calendar_dates ile tanımlı servisler: eklenen
  // tarihlerin haftanın günlerini birleştir
  for (const d of readCsv(gtfsPath(dir, "calendar_dates"), { required: false })) {
    if (d.exception_type !== "1" || serviceMask.get(d.service_id)) continue;
    const dow = new Date(`${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}T12:00:00Z`).getUTCDay();
    serviceMask.set(d.service_id, (serviceMask.get(d.service_id) ?? 0) | (1 << dow));
  }

  // Hatlar
  const agencies = new Map(
    readCsv(gtfsPath(dir, "agency")).map((a) => [a.agency_id, fixMojibake(a.agency_name)]),
  );
  // agency_id isteğe bağlı; tek işletmeli beslemelerde boş olabilir
  const defaultAgency = agencies.size === 1 ? [...agencies.values()][0] : "";
  const routeIdx = new Map();
  for (const r of readCsv(gtfsPath(dir, "routes"))) {
    if (EXCLUDED_ROUTE_TYPES.has(Number(r.route_type))) continue;
    routeIdx.set(r.route_id, routes.length);
    routes.push({
      name: fixMojibake(r.route_short_name || r.route_long_name),
      longName: fixMojibake(r.route_long_name),
      type: Number(r.route_type),
      agency: agencies.get(r.agency_id) ?? defaultAgency,
    });
  }

  // Seferler
  const tripInfo = new Map();
  for (const t of readCsv(gtfsPath(dir, "trips"))) {
    const route = routeIdx.get(t.route_id);
    const mask = serviceMask.get(t.service_id) ?? 0;
    if (route === undefined || mask === 0) continue;
    tripInfo.set(t.trip_id, { route, mask, shape: t.shape_id || null });
  }

  // Hat şekilleri (her beslemede yok; ör. İETT'de yok)
  const feedShapes = new Map();
  for (const s of readCsv(gtfsPath(dir, "shapes"), { required: false })) {
    const list = feedShapes.get(s.shape_id) ?? feedShapes.set(s.shape_id, []).get(s.shape_id);
    list.push({ seq: Number(s.shape_pt_sequence), lat: Number(s.shape_pt_lat), lng: Number(s.shape_pt_lon) });
  }
  const shapeFor = (shapeId) => {
    const pts = shapeId && feedShapes.get(shapeId);
    if (!pts || pts.length < 2) return -1;
    const key = `${feed}:${shapeId}`;
    let idx = shapeIndex.get(key);
    if (idx === undefined) {
      idx = shapes.length;
      shapeIndex.set(key, idx);
      shapes.push(pts.sort((a, b) => a.seq - b.seq).map((p) => [p.lat, p.lng]));
    }
    return idx;
  };
  if (feedShapes.size) console.log(`  hat şekilleri: ${feedShapes.size}`);

  // Sefer frekansları (toplu ulaşım setinde)
  const freqs = new Map();
  for (const f of readCsv(gtfsPath(dir, "frequencies"), { required: false })) {
    const list = freqs.get(f.trip_id) ?? [];
    const start = parseTime(f.start_time);
    let end = parseTime(f.end_time);
    // "00:00:00" bitiş = gece yarısı; aksi halde pencere boş kalıyordu
    if (end <= start) end += 24 * 3600;
    list.push({ start, end, headway: Number(f.headway_secs) });
    freqs.set(f.trip_id, list);
  }

  // Durak saatleri: sefer bazında grupla (yapılandırmadaki dosya varsa o)
  const stopTimesPath = stopTimes && existsSync(stopTimes) ? stopTimes : gtfsPath(dir, "stop_times");
  console.log(`  durak saatleri: ${stopTimesPath}`);
  const byTrip = new Map();
  eachRow(stopTimesPath, (f, c) => {
    const tripId = f[c.trip_id];
    if (!tripInfo.has(tripId)) return;
    const stop = stopIndex.get(`${feed}:${f[c.stop_id]}`);
    if (stop === undefined) return;
    let list = byTrip.get(tripId);
    if (!list) byTrip.set(tripId, (list = []));
    list.push({
      stop,
      seq: Number(f[c.stop_sequence]),
      arr: parseTime(f[c.arrival_time]),
      dep: parseTime(f[c.departure_time]),
    });
  });

  let tripCount = 0;
  let skipped = 0;
  const before = conns.length;
  for (const [tripId, list] of byTrip) {
    list.sort((a, b) => a.seq - b.seq);
    if (!interpolate(list)) {
      skipped++;
      continue;
    }
    const { route, mask, shape } = tripInfo.get(tripId);
    const stopSeq = list.map((s) => s.stop);
    const patKey = `${route}|${stopSeq.join(",")}`;
    let pattern = patternIndex.get(patKey);
    if (pattern === undefined) {
      pattern = patterns.length;
      patternIndex.set(patKey, pattern);
      patterns.push(stopSeq);
      patternShape.push(shapeFor(shape));
    } else if (patternShape[pattern] === -1) {
      patternShape[pattern] = shapeFor(shape);
    }

    // Frekanslı seferde durak saatleri bir şablondur; her kalkış için çoğalt
    const windows = freqs.get(tripId);
    const offsets = [];
    if (windows) {
      const base = list[0].dep;
      for (const w of windows) {
        for (let t = w.start; t < w.end; t += w.headway) offsets.push(t - base);
      }
    } else offsets.push(0);

    for (const off of offsets) {
      const trip = trips.length;
      trips.push({ route, pattern });
      tripCount++;
      for (let i = 0; i + 1 < list.length; i++) {
        const a = list[i];
        const b = list[i + 1];
        const dep = a.dep + off;
        const arr = Math.max(b.arr + off, dep);
        conns.push(a.stop, b.stop, dep, arr, trip, mask);
      }
    }
  }
  console.log(
    `  hatlar: ${routeIdx.size}, seferler: ${tripCount} (saatsiz ${skipped} atıldı), bağlantılar: ${(conns.length - before) / 6}`,
  );
}

/**
 * Boş ara durak saatlerini, saatli duraklar arasında mesafeye göre doğrusal
 * enterpolasyonla doldurur. En az iki saatli durak yoksa false döner.
 */
function interpolate(list) {
  for (const s of list) {
    if (s.dep === null) s.dep = s.arr;
    if (s.arr === null) s.arr = s.dep;
  }
  const timed = list.map((s, i) => (s.dep !== null ? i : -1)).filter((i) => i >= 0);
  if (timed.length < 2 || timed[0] !== 0) return false;

  // Son saatli duraktan sonrası güvenilmez; kes
  list.length = timed.at(-1) + 1;

  for (let k = 0; k + 1 < timed.length; k++) {
    const i = timed[k];
    const j = timed[k + 1];
    if (j === i + 1) continue;
    const cum = [0];
    for (let x = i + 1; x <= j; x++) {
      cum.push(cum.at(-1) + haversineM(stops[list[x - 1].stop], stops[list[x].stop]));
    }
    const total = cum.at(-1) || 1;
    for (let x = i + 1; x < j; x++) {
      const t = Math.round(list[i].dep + ((list[j].arr - list[i].dep) * cum[x - i]) / total);
      list[x].arr = t;
      list[x].dep = t;
    }
  }
  return true;
}

/** Yakın duraklar arası yürüme aktarmaları (ızgara ile) */
function buildFootpaths() {
  // Hücre, komşu hücrelerle birlikte yarıçapı tam kapsamalı
  // (41° enleminde 0.007° boylam ≈ 590 m)
  const cell = 0.007;
  const grid = new Map();
  const key = (lat, lng) => `${Math.floor(lat / cell)}:${Math.floor(lng / cell)}`;
  stops.forEach((s, i) => {
    const k = key(s.lat, s.lng);
    (grid.get(k) ?? grid.set(k, []).get(k)).push(i);
  });

  const start = new Int32Array(stops.length + 1);
  const to = [];
  const dur = [];
  stops.forEach((s, i) => {
    start[i] = to.length;
    const cy = Math.floor(s.lat / cell);
    const cx = Math.floor(s.lng / cell);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
          if (j === i) continue;
          const d = haversineM(s, stops[j]);
          if (d <= TRANSFER_RADIUS_M) {
            to.push(j);
            dur.push(Math.round((d * ROAD_FACTOR) / WALK_M_PER_S) + TRANSFER_PENALTY_S);
          }
        }
      }
    }
  });
  start[stops.length] = to.length;
  return { start, to: Int32Array.from(to), dur: Int32Array.from(dur) };
}

// ---------- Çalıştır ----------

for (const feed of CONFIG.feeds) {
  if (existsSync(feed.dir)) addFeed(feed);
  else console.warn(`[${feed.name}] klasörü yok (${feed.dir}), atlanıyor`);
}

if (stops.length > 0xffff) throw new Error("Durak sayısı Uint16 sınırını aşıyor");

// Bağlantıları kalkış saatine göre sırala; sütunları sıkı tiplerle yaz
const n = conns.length / 6;
const order = new Int32Array(n).map((_, i) => i);
order.sort((a, b) => conns[a * 6 + 2] - conns[b * 6 + 2]);
const cols = [Uint16Array, Uint16Array, Int32Array, Int32Array, Int32Array, Uint8Array].map(
  (T) => new T(n),
);
order.forEach((src, dst) => {
  for (let c = 0; c < 6; c++) cols[c][dst] = conns[src * 6 + c];
});
conns.length = 0;

const foot = buildFootpaths();
console.log(`\nToplam: ${stops.length} durak, ${routes.length} hat, ${trips.length} sefer, ${n} bağlantı, ${foot.to.length} aktarma`);

// Kalıp CSR
const patStart = new Int32Array(patterns.length + 1);
const patStops = new Int32Array(patterns.reduce((s, p) => s + p.length, 0));
let off = 0;
patterns.forEach((p, i) => {
  patStart[i] = off;
  patStops.set(p, off);
  off += p.length;
});
patStart[patterns.length] = off;

// Şekil noktaları (CSR, mikroderece) ve her kalıp durağının şekil üzerindeki
// noktası. Biniş-iniş arasındaki gerçek hat çizgisi buradan kesilir.
const shapeStart = new Int32Array(shapes.length + 1);
const shapeLat = new Int32Array(shapes.reduce((s, p) => s + p.length, 0));
const shapeLng = new Int32Array(shapeLat.length);
let soff = 0;
shapes.forEach((pts, i) => {
  shapeStart[i] = soff;
  for (const [lat, lng] of pts) {
    shapeLat[soff] = Math.round(lat * 1e6);
    shapeLng[soff] = Math.round(lng * 1e6);
    soff++;
  }
});
shapeStart[shapes.length] = soff;

const patStopShapePt = new Int32Array(patStops.length).fill(-1);
let shapedPatterns = 0;
patterns.forEach((stopSeq, p) => {
  const sh = patternShape[p];
  if (sh < 0) return;
  const pts = shapes[sh];
  const idx = projectStops(stopSeq, pts);
  if (!idx) return;
  idx.forEach((v, k) => (patStopShapePt[patStart[p] + k] = shapeStart[sh] + v));
  shapedPatterns++;
});
console.log(
  `Şekilli kalıp: ${shapedPatterns} (şekli olan ${patternShape.filter((s) => s >= 0).length}, toplam ${patterns.length}), şekil noktası: ${soff}`,
);

/**
 * Durakları sırayı koruyarak şekil üzerindeki en yakın noktaya eşler.
 * Bir durak şekle 150 m'den uzaksa şekil bu kalıba uymuyor sayılır.
 */
function projectStops(stopSeq, pts) {
  const out = [];
  let from = 0;
  for (let k = 0; k < stopSeq.length; k++) {
    const s = stops[stopSeq[k]];
    // Kalan durakların sığabilmesi için aramayı sınırla
    let best = -1;
    let bestD = Infinity;
    for (let i = from; i < pts.length; i++) {
      const d = haversineM(s, { lat: pts[i][0], lng: pts[i][1] });
      if (d < bestD) {
        bestD = d;
        best = i;
      }
      // Yakın bir nokta bulduysak ve uzaklaşıyorsak dur (dönüşlü hatlar)
      if (bestD < 60 && d > bestD + 400) break;
    }
    if (best < 0 || bestD > 150) return null;
    out.push(best);
    from = best;
  }
  return out;
}

// İkili dosya: art arda tipli diziler; her biri 4 bayta hizalı.
// Tip, uzunluk ve konum meta dosyasında (layout).
const arrays = {
  connDepTime: cols[2],
  connArrTime: cols[3],
  connTrip: cols[4],
  tripRoute: Int32Array.from(trips, (t) => t.route),
  tripPattern: Int32Array.from(trips, (t) => t.pattern),
  patStart,
  patStops,
  patStopShapePt,
  shapeLat,
  shapeLng,
  footStart: foot.start,
  footTo: foot.to,
  footDur: foot.dur,
  connDepStop: cols[0],
  connArrStop: cols[1],
  connDayMask: cols[5],
};
const layout = {};
let byteOffset = 0;
for (const [name, arr] of Object.entries(arrays)) {
  layout[name] = { type: arr.constructor.name, offset: byteOffset, length: arr.length };
  byteOffset += Math.ceil(arr.byteLength / 4) * 4;
}
const bin = Buffer.alloc(byteOffset);
for (const [name, arr] of Object.entries(arrays)) {
  Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(bin, layout[name].offset);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/${CITY}.bin`, bin);
writeFileSync(
  `${OUT}/${CITY}.meta.json`,
  JSON.stringify({
    version: FORMAT_VERSION,
    builtAt: new Date().toISOString(),
    source: CONFIG.source,
    layout,
    stops: {
      name: stops.map((s) => s.name),
      lat: stops.map((s) => Math.round(s.lat * 1e6) / 1e6),
      lng: stops.map((s) => Math.round(s.lng * 1e6) / 1e6),
    },
    routes,
  }),
);
console.log(`Yazıldı: ${OUT}/${CITY}.bin (${(bin.length / 1e6).toFixed(1)} MB), ${CITY}.meta.json`);
