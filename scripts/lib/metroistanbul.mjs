// Metro İstanbul'un açık web servisi (İBB Açık Veri: "Metro İstanbul Sefer
// Tarifeleri Listesi Web Servisi") verisini GTFS dosyalarına çevirir.
// Ağ erişimi yok; scripts/fetch-metroistanbul.mjs kullanır, testlenebilir.

import { haversineM } from "./common.mjs";

/** Karşılaştırma için: küçük harf, aksansız, yalnızca harf/rakam */
export function fold(s) {
  return String(s)
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const hms = (sec) =>
  [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60].map((n) => String(n).padStart(2, "0")).join(":");
const csvRow = (r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",");
const csv = (rows) => rows.map(csvRow).join("\n") + "\n";

/** "HH:MM" listesi → gün başından saniye; gece yarısını geçince (saat geriye düşünce) +24 sa */
export function timesToSeconds(times) {
  const out = [];
  let offset = 0;
  let prev = -1;
  for (const t of times) {
    const m = String(t).match(/^(\d{1,2}):(\d{2})/);
    if (!m) continue;
    let sec = Number(m[1]) * 3600 + Number(m[2]) * 60;
    if (prev >= 0 && sec + offset < prev) offset += 24 * 3600;
    sec += offset;
    out.push(sec);
    prev = sec;
  }
  return out;
}

/**
 * Bir yönün istasyonlarını bulur. Yön adı "A->B"; istasyon adları ASCII büyük
 * harfle ("YENIKAPI") geldiği için katlanmış adlarla karşılaştırılır. A ve B hattın
 * uçları olmak zorunda değil: servis bazı hatları kesimlere böler (ör. M7 Yıldız-
 * Mecidiyeköy); bu durumda yalnızca o kesim döner.
 * @param stations hatta ait istasyonlar (Order'a göre sıralı)
 * @returns A'dan B'ye sıralı istasyonlar ya da null
 */
export function orderForDirection(stations, directionName) {
  const [a, b] = String(directionName).split(/->|→/).map((x) => fold(x));
  if (!a || !b || stations.length < 2) return null;
  const match = (s, key) => {
    const names = [fold(s.Name), fold(s.Description ?? "")];
    return names.some((n) => n && (n === key || n.startsWith(key) || key.startsWith(n)));
  };
  const ia = stations.findIndex((s) => match(s, a));
  const ib = stations.findIndex((s) => match(s, b));
  if (ia < 0 || ib < 0 || ia === ib) return null;
  const slice = stations.slice(Math.min(ia, ib), Math.max(ia, ib) + 1);
  return ia < ib ? slice : [...slice].reverse();
}

/**
 * @param model {
 *   lines: { name: string, type: number }[],
 *   directions: { line: string, id: number, name: string }[],
 *   stationsByLine: Record<string, object[]>  // Order'a göre sıralı, DetailInfo.Latitude/Longitude
 *   departures: (directionId: number, day: "wd"|"sat"|"sun") => number[]  // terminalden kalkış (sn)
 *   travelSec: (directionId: number) => number | null  // terminalden son istasyona toplam süre
 * }
 */
export function buildMetroGtfs({ lines, directions, stationsByLine, departures, travelSec }, { fallbackKmh = 35 } = {}) {
  const stops = new Map();
  const routes = [];
  const trips = [];
  const stopTimes = ["trip_id,arrival_time,departure_time,stop_id,stop_sequence"];
  const skipped = [];
  const used = new Set();

  const DAYS = [
    ["wd", "WD"],
    ["sat", "SAT"],
    ["sun", "SUN"],
  ];

  for (const line of lines) {
    const all = stationsByLine[line.name] ?? [];
    const lineRoutes = [];
    const lineTrips = [];
    const lineStopTimes = [];
    const lineStops = new Map();
    const covered = new Set(); // "a>b" biçiminde komşu istasyon çiftleri (yönsüz)
    for (const dir of directions.filter((d) => d.line === line.name)) {
      const found = orderForDirection(all, dir.name);
      // Koordinatı olmayan istasyon hatta konumlanamaz; geri kalanlarla devam edilir
      const ordered = found?.filter((s) => Number(s.DetailInfo?.Latitude) && Number(s.DetailInfo?.Longitude));
      if (!ordered || ordered.length < 2) {
        skipped.push(`${line.name} ${dir.name}`);
        continue;
      }
      const pts = ordered.map((s) => ({ lat: Number(s.DetailInfo.Latitude), lng: Number(s.DetailInfo.Longitude) }));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineM(pts[i - 1], pts[i]));
      const totalM = cum.at(-1) || 1;
      const totalSec = travelSec(dir.id) ?? Math.round((totalM / 1000 / fallbackKmh) * 3600);
      const offsets = cum.map((c) => Math.round((totalSec * c) / totalM));
      for (let i = 1; i < offsets.length; i++) offsets[i] = Math.max(offsets[i], offsets[i - 1] + 20);

      const routeId = `${line.name}-${dir.id}`;
      let any = false;
      for (const [key, sid] of DAYS) {
        for (const dep of departures(dir.id, key)) {
          const id = `${routeId}-${sid}-${dep}`;
          lineTrips.push([routeId, sid, id, ordered.at(-1).Description ?? ordered.at(-1).Name]);
          ordered.forEach((s, i) => {
            const t = hms(dep + offsets[i]);
            lineStopTimes.push(csvRow([id, t, t, s.Id, i + 1]));
          });
          any = true;
        }
      }
      if (!any) {
        skipped.push(`${line.name} ${dir.name} (sefer yok)`);
        continue;
      }
      ordered.forEach((s, i) => lineStops.set(s.Id, { name: s.Description || s.Name, ...pts[i] }));
      for (let i = 0; i + 1 < ordered.length; i++) {
        covered.add([ordered[i].Id, ordered[i + 1].Id].sort().join(">"));
      }
      lineRoutes.push([routeId, "1", line.name, `${line.name}: ${dir.name}`, line.type]);
    }
    if (!lineRoutes.length) continue;

    // Servis bazı hatlarda kesimler arasını boş bırakıyor (ör. M7 Mecidiyeköy-Çağlayan);
    // hattın her komşu istasyon çifti bir yönce kapsanmıyorsa hat eksik olur: eski
    // GTFS'teki (süresi dolmuş ama bütün) hatla devam edilir, bu hat değiştirilmez.
    const stationsAll = all.filter((s) => Number(s.DetailInfo?.Latitude) && Number(s.DetailInfo?.Longitude));
    const gaps = [];
    for (let i = 0; i + 1 < stationsAll.length; i++) {
      if (!covered.has([stationsAll[i].Id, stationsAll[i + 1].Id].sort().join(">"))) {
        gaps.push(`${stationsAll[i].Description || stationsAll[i].Name}-${stationsAll[i + 1].Description || stationsAll[i + 1].Name}`);
      }
    }
    if (gaps.length) {
      skipped.push(`${line.name} eksik kesim (${gaps.join(", ")}), eski veri korunur`);
      continue;
    }
    routes.push(...lineRoutes);
    trips.push(...lineTrips);
    stopTimes.push(...lineStopTimes);
    for (const [id, st] of lineStops) stops.set(id, st);
    used.add(line.name);
  }

  const files = {
    "agency.txt": csv([
      ["agency_id", "agency_name", "agency_url", "agency_timezone"],
      ["1", "Metro İstanbul", "https://www.metro.istanbul", "Europe/Istanbul"],
    ]),
    "calendar.txt": csv([
      ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
      ["WD", 1, 1, 1, 1, 1, 0, 0, "20260101", "20301231"],
      ["SAT", 0, 0, 0, 0, 0, 1, 0, "20260101", "20301231"],
      ["SUN", 0, 0, 0, 0, 0, 0, 1, "20260101", "20301231"],
    ]),
    "routes.txt": csv([["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"], ...routes]),
    "stops.txt": csv([
      ["stop_id", "stop_name", "stop_lat", "stop_lon"],
      ...[...stops].map(([id, s]) => [id, s.name, s.lat, s.lng]),
    ]),
    "trips.txt": csv([["route_id", "service_id", "trip_id", "trip_headsign"], ...trips]),
    "stop_times.txt": stopTimes.join("\n") + "\n",
    // build-gtfs: eski GTFS'te bu adlı Metro İstanbul hatları bu veriyle değiştirilir
    "replaces.json": JSON.stringify([...used]),
  };
  const report =
    `Yazıldı: ${routes.length} hat yönü (${[...used].join(", ")}), ${trips.length} sefer, ${stops.size} istasyon.` +
    (skipped.length ? `\nAtlanan: ${skipped.join("; ")}` : "");
  return { files, report };
}
