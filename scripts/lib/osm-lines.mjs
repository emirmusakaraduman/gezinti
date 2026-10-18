// OSM hat ilişkilerinden çizgi kurma ve durak dizisini çizgiye oturtma.
// Ağ erişimi yok; fetch-bus-geometry.mjs, build-osm-rail.mjs ve build-gtfs.mjs kullanır.
import { haversineM } from "./common.mjs";

/**
 * İlişkinin yol parçalarını (sıralı way üyeleri, `out geom` çıktısı) tek çizgide
 * birleştirir. Peron/durak yolları dahil edilmez. Parça uçları eşleşmezse
 * düz çizgiyle bağlanır; en büyük bu sıçrama maxJumpM olarak döner.
 * @returns {{ line: {lat: number, lon: number}[], maxJumpM: number }}
 */
export function chainWays(relation) {
  const ways = (relation?.members ?? []).filter(
    (m) => m.type === "way" && m.geometry?.length >= 2 && !/platform|stop/.test(m.role),
  );
  const line = [];
  let maxJumpM = 0;
  for (const way of ways) {
    let pts = way.geometry;
    if (line.length) {
      const end = line.at(-1);
      // Yön: sondaki noktaya yakın uç öne gelsin
      if (haversineM(end, pts[0]) > haversineM(end, pts.at(-1))) pts = [...pts].reverse();
      maxJumpM = Math.max(maxJumpM, haversineM(end, pts[0]));
    }
    line.push(...pts);
  }
  // Art arda aynı noktaları ayıkla
  return {
    line: line.filter((p, i) => i === 0 || p.lat !== line[i - 1].lat || p.lon !== line[i - 1].lon),
    maxJumpM,
  };
}

/**
 * Durakları sırayı koruyarak çizgi üzerindeki en yakın noktaya eşler.
 * @param stops [{lat, lng}] sıralı
 * @param line [[lat, lng], …]
 * @returns {{ idx: number[], meanM: number } | null} bir durak maxM'den uzaksa null
 */
export function fitStopsToLine(stops, line, maxM = 120) {
  const idx = [];
  let from = 0;
  let sum = 0;
  for (const s of stops) {
    let best = -1;
    let bestD = Infinity;
    for (let i = from; i < line.length; i++) {
      const d = haversineM({ lat: s.lat, lon: s.lng }, { lat: line[i][0], lon: line[i][1] });
      if (d < bestD) {
        bestD = d;
        best = i;
      }
      // Yakın noktayı bulduktan sonra uzaklaşıyorsak dur (dönüşlü hatlar)
      if (bestD < 60 && d > bestD + 400) break;
    }
    if (best < 0 || bestD > maxM) return null;
    idx.push(best);
    sum += bestD;
    from = best;
  }
  return { idx, meanM: sum / stops.length };
}

/**
 * Aynı hat numaralı adaylardan durak dizisine en iyi oturanı seçer (iki yön de denenir).
 * @param candidates [[lat, lng], …] dizileri
 * @returns {{ line: [number, number][], meanM: number } | null}
 */
export function bestFittingLine(stops, candidates, maxM = 120) {
  let best = null;
  for (const cand of candidates) {
    for (const line of [cand, [...cand].reverse()]) {
      const fit = fitStopsToLine(stops, line, maxM);
      if (fit && (!best || fit.meanM < best.meanM)) best = { line, meanM: fit.meanM };
    }
  }
  return best;
}
