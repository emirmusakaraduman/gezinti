// OSM ray yollarından yönsüz bir ağ kurar ve duraklar arası en kısa ray
// yolunu bulur (A*). build-gtfs.mjs, şekli olmayan raylı kalıplara gerçek hat
// çizgisi vermek için kullanır.
import { haversineM } from "./common.mjs";

const CELL = 0.005;
const cellKey = (lat, lng) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;

/** @param ways her biri düz [lat, lng, lat, lng, …] dizisi */
export function createRailGraph(ways) {
  const nodes = []; // { lat, lng }
  const adj = []; // düğüm → [[komşu, metre], …]
  const index = new Map();
  const grid = new Map();

  const node = (lat, lng) => {
    const key = `${lat},${lng}`;
    let i = index.get(key);
    if (i === undefined) {
      i = nodes.length;
      index.set(key, i);
      nodes.push({ lat, lng });
      adj.push([]);
      const ck = cellKey(lat, lng);
      (grid.get(ck) ?? grid.set(ck, []).get(ck)).push(i);
    }
    return i;
  };

  for (const w of ways) {
    let prev = -1;
    for (let k = 0; k + 1 < w.length; k += 2) {
      const cur = node(w[k], w[k + 1]);
      if (prev >= 0 && prev !== cur) {
        const d = haversineM(nodes[prev], nodes[cur]);
        adj[prev].push([cur, d]);
        adj[cur].push([prev, d]);
      }
      prev = cur;
    }
  }
  // Bağlı bileşenler: bağlantısız ray çiftleri arasında yol aramak boşuna
  const comp = new Int32Array(nodes.length).fill(-1);
  let nComp = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i] >= 0) continue;
    const stack = [i];
    comp[i] = nComp;
    while (stack.length) {
      for (const [v] of adj[stack.pop()]) {
        if (comp[v] < 0) {
          comp[v] = nComp;
          stack.push(v);
        }
      }
    }
    nComp++;
  }
  return { nodes, adj, grid, comp };
}

/**
 * Noktaya maxM içindeki en yakın ağ düğümleri (yakından uzağa, en fazla limit).
 * Her bağlı bileşenden en fazla perComp düğüm alınır; yoksa yoğun bir hattın
 * (ör. çift hatlı tramvay) düğümleri yandaki banliyö hattını bastırır.
 */
export function snapCandidates(g, p, maxM, limit = 12, perComp = 2) {
  const cy = Math.floor(p.lat / CELL);
  const cx = Math.floor(p.lng / CELL);
  const found = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const i of g.grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
        const d = haversineM(p, g.nodes[i]);
        if (d <= maxM) found.push([d, i]);
      }
    }
  }
  const taken = new Map();
  const out = [];
  for (const [, i] of found.sort((a, b) => a[0] - b[0])) {
    const n = taken.get(g.comp[i]) ?? 0;
    if (n >= perComp) continue;
    taken.set(g.comp[i], n + 1);
    out.push(i);
    if (out.length >= limit) break;
  }
  return out;
}

/** Noktaya en yakın ağ düğümü; maxM içinde yoksa -1 */
export function snap(g, p, maxM) {
  return snapCandidates(g, p, maxM, 1)[0] ?? -1;
}

/** A*; maliyet maxM'yi aşarsa vazgeçer. Dönen: düğüm indeksleri veya null */
export function shortestPath(g, from, to, maxM) {
  if (from === to) return [from];
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  // Basit ikili yığın: [öncelik, düğüm]
  const heap = [[haversineM(g.nodes[from], g.nodes[to]), from]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  const done = new Set();
  while (heap.length) {
    const [, u] = pop();
    if (u === to) {
      const out = [u];
      for (let c = u; prev.has(c); ) out.push((c = prev.get(c)));
      return out.reverse();
    }
    if (done.has(u)) continue;
    done.add(u);
    const du = dist.get(u);
    for (const [v, w] of g.adj[u]) {
      const dv = du + w;
      if (dv > maxM || dv >= (dist.get(v) ?? Infinity)) continue;
      dist.set(v, dv);
      prev.set(v, u);
      push([dv + haversineM(g.nodes[v], g.nodes[to]), v]);
    }
  }
  return null;
}

/**
 * Durak dizisi için ray ağı üzerinde [lat, lng] çizgisi. Çift hatlı kesimlerde
 * durağa en yakın düğüm karşı yöndeki ray olabilir (ikisi birbirine bağlı
 * değildir); bu yüzden birkaç yakın düğüm denenir. Herhangi bir durak ağa
 * oturmuyorsa veya iki durak arası bağlanmıyorsa null (kısmi çizgi yok).
 */
export function railLine(g, stopPoints, { snapM = 300, detour = 2.5, slackM = 1000 } = {}) {
  const cands = stopPoints.map((p) => snapCandidates(g, p, snapM));
  if (cands.some((c) => !c.length)) return null;
  const line = [];
  for (let k = 0; k + 1 < cands.length; k++) {
    const straight = haversineM(stopPoints[k], stopPoints[k + 1]);
    const cap = straight * detour + slackM;
    let path = null;
    for (const a of cands[k]) {
      for (const b of cands[k + 1]) {
        if (g.comp[a] !== g.comp[b]) continue;
        path = shortestPath(g, a, b, cap);
        if (path) break;
      }
      if (path) break;
    }
    if (!path) return null;
    for (const i of line.length ? path.slice(1) : path) line.push([g.nodes[i].lat, g.nodes[i].lng]);
  }
  return line.length >= 2 ? line : null;
}
