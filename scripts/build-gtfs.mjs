// İstanbul GTFS verisini toplu taşıma yönlendiricisinin okuyacağı kompakt
// biçime dönüştürür.
//
//   Girdi:  data/gtfs/raw/{iett,transit}/*.csv  (İBB Açık Veri Portalı)
//   Çıktı:  data/gtfs/build/istanbul.meta.json  (duraklar, hatlar, kalıplar)
//           data/gtfs/build/istanbul.bin        (bağlantılar + yürüme aktarmaları)
//
// Ham veri standart dışı: İETT dosyaları ';' ile ayrılmış, hat adları çift
// UTF-8 kodlanmış, koordinatlar binlik ayracıyla bozulmuş; toplu ulaşım
// dosyaları Windows-1254 kodlu ve bazı seferler frequencies.csv ile tanımlı.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const RAW = "data/gtfs/raw";
const OUT = "data/gtfs/build";
export const FORMAT_VERSION = 1;

// İstanbul sınırları; bunun dışındaki (bozuk) koordinatlar atılır
const BBOX = { minLat: 40.7, maxLat: 41.7, minLng: 27.9, maxLng: 29.95 };
const TRANSFER_RADIUS_M = 500;
const WALK_M_PER_S = 4.5 / 3.6;
const ROAD_FACTOR = 1.3;
const TRANSFER_PENALTY_S = 60;
// 9: minibüs, 10: taksi-dolmuş (İBB'ye özgü tipler). Gezgin rotası için
// gereksiz, verisi de güvenilmez; bağlantı sayısını 20 kat şişiriyordu.
const EXCLUDED_ROUTE_TYPES = new Set([9, 10]);

// ---------- Okuma ve kod çözme ----------

// Windows-1252'de 0x80-0x9F aralığı Latin-1'den farklıdır
const CP1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";

/** "KADIKÃ–Y" gibi çift kodlanmış metni düzeltir */
function fixMojibake(s) {
  if (!/[ÃÄÅ][\u0080-ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/.test(s)) return s;
  const bytes = [];
  for (const ch of s) {
    const code = ch.codePointAt(0);
    const hi = CP1252_HIGH.indexOf(ch);
    if (hi >= 0) bytes.push(0x80 + hi);
    else if (code <= 0xff) bytes.push(code);
    else return s; // 1252'ye geri çevrilemiyor, olduğu gibi bırak
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return s;
  }
}

function decode(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1254").decode(buf);
  }
}

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

/** "41.0191" veya bozuk "410.191.700.005.564" → 41.0191700005564 */
function parseCoord(raw) {
  if (!raw) return NaN;
  const s = raw.replace(",", ".");
  if ((s.match(/\./g) ?? []).length <= 1) return Number(s);
  // İstanbul'da hem enlem hem boylam iki basamaklı tam kısım taşır
  const digits = s.replace(/\./g, "");
  return Number(`${digits.slice(0, 2)}.${digits.slice(2)}`);
}

function parseTime(raw) {
  if (!raw) return null;
  const [h, m, s = "0"] = raw.split(":");
  const t = Number(h) * 3600 + Number(m) * 60 + Number(s);
  return Number.isFinite(t) ? t : null;
}

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
const trips = []; // { route, pattern }
// Bağlantılar düz dizilerde: [depStop, arrStop, depTime, arrTime, trip, dayMask]
const conns = [];

function addFeed(feed) {
  const dir = `${RAW}/${feed}`;
  console.log(`\n[${feed}] okunuyor…`);

  // Duraklar
  let dropped = 0;
  const stopsBefore = stops.length;
  for (const s of readCsv(`${dir}/stops.csv`)) {
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
  for (const c of readCsv(`${dir}/calendar.csv`)) {
    let mask = 0;
    DAY_FIELDS.forEach((d, i) => {
      if (c[d] === "1") mask |= 1 << i;
    });
    serviceMask.set(c.service_id, mask);
  }

  // Hatlar
  const agencies = new Map(
    readCsv(`${dir}/agency.csv`).map((a) => [a.agency_id, fixMojibake(a.agency_name)]),
  );
  const routeIdx = new Map();
  for (const r of readCsv(`${dir}/routes.csv`)) {
    if (EXCLUDED_ROUTE_TYPES.has(Number(r.route_type))) continue;
    routeIdx.set(r.route_id, routes.length);
    routes.push({
      name: fixMojibake(r.route_short_name || r.route_long_name),
      longName: fixMojibake(r.route_long_name),
      type: Number(r.route_type),
      agency: agencies.get(r.agency_id) ?? "",
    });
  }

  // Seferler
  const tripInfo = new Map();
  for (const t of readCsv(`${dir}/trips.csv`)) {
    const route = routeIdx.get(t.route_id);
    const mask = serviceMask.get(t.service_id) ?? 0;
    if (route === undefined || mask === 0) continue;
    tripInfo.set(t.trip_id, { route, mask });
  }

  // Sefer frekansları (toplu ulaşım setinde)
  const freqs = new Map();
  for (const f of readCsv(`${dir}/frequencies.csv`, { required: false })) {
    const list = freqs.get(f.trip_id) ?? [];
    const start = parseTime(f.start_time);
    let end = parseTime(f.end_time);
    // "00:00:00" bitiş = gece yarısı; aksi halde pencere boş kalıyordu
    if (end <= start) end += 24 * 3600;
    list.push({ start, end, headway: Number(f.headway_secs) });
    freqs.set(f.trip_id, list);
  }

  // Durak saatleri: sefer bazında grupla. İETT'nin portaldaki CSV'si kesik
  // (seferlerin ~%14'ü); tam veri ayrı zip içinde, varsa onu kullan.
  const fullStopTimes = `${RAW}/${feed}-zip/stop_times.txt`;
  const stopTimesPath = existsSync(fullStopTimes) ? fullStopTimes : `${dir}/stop_times.csv`;
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
    const { route, mask } = tripInfo.get(tripId);
    const stopSeq = list.map((s) => s.stop);
    const patKey = `${route}|${stopSeq.join(",")}`;
    let pattern = patternIndex.get(patKey);
    if (pattern === undefined) {
      pattern = patterns.length;
      patternIndex.set(patKey, pattern);
      patterns.push(stopSeq);
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

for (const feed of ["transit", "iett"]) {
  if (existsSync(`${RAW}/${feed}`)) addFeed(feed);
  else console.warn(`[${feed}] klasörü yok, atlanıyor`);
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
writeFileSync(`${OUT}/istanbul.bin`, bin);
writeFileSync(
  `${OUT}/istanbul.meta.json`,
  JSON.stringify({
    version: FORMAT_VERSION,
    builtAt: new Date().toISOString(),
    source: "İBB Açık Veri Portalı (data.ibb.gov.tr): İETT GTFS, Toplu Ulaşım GTFS",
    layout,
    stops: {
      name: stops.map((s) => s.name),
      lat: stops.map((s) => Math.round(s.lat * 1e6) / 1e6),
      lng: stops.map((s) => Math.round(s.lng * 1e6) / 1e6),
    },
    routes,
  }),
);
console.log(`Yazıldı: ${OUT}/istanbul.bin (${(bin.length / 1e6).toFixed(1)} MB), istanbul.meta.json`);
