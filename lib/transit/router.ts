/**
 * GTFS tabanlı toplu taşıma yönlendiricisi (Connection Scan Algorithm).
 *
 * scripts/build-gtfs.mjs'in ürettiği data/gtfs/build/<şehir>.{bin,meta.json}
 * dosyalarını bir kez belleğe alır. Sorgu: belirli bir saatte A'dan çıkan
 * yolcunun B'ye en erken varışı; yürüme + biniş + aktarma adımlarıyla.
 *
 * Sınırlamalar: günler arası (gece yarısını aşan) yolculuk yok; aktarma
 * süresi sabit; İstanbulkart aktarma indirimi hesaba katılmıyor.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { haversineKm, toHHMM } from "@/lib/geo";
import type { TransitStep, Vehicle } from "@/lib/types";

const FORMAT_VERSION = 2;
const WALK_M_PER_MIN = (4.5 * 1000) / 60;
const ROAD_FACTOR = 1.3;
/** Başlangıç/bitişte durağa en fazla bu kadar yürünür */
const ACCESS_RADIUS_M = 800;
/**
 * İlk biniş dışındaki her binişe eklenen pay (araç bekleme, peron bulma).
 * Yalnızca en erken varışa bakan CSA aksi halde 1 dakikalık anlamsız
 * otobüs hoplamalarını yürümeye tercih ediyor.
 */
const TRANSFER_SLACK_S = 120;
/**
 * Her biniş, rota karşılaştırmasında bu kadar "pahalı" sayılır. Böylece
 * 5 dakikadan az kazandıran biniş/aktarmalar elenir. Gösterilen saatleri
 * etkilemez.
 */
const BOARDING_PENALTY_S = 300;
/** Şekil noktası / durak oranı bunun üstündeyse şekil gerçek hat sayılır */
const DENSE_SHAPE_RATIO = 2;
/** Binilen duraktan bundan kısa binişler kaydedilmez; o mesafe yürünür */
const MIN_RIDE_M = 500;
const INF = 0x7fffffff;

type Point = { lat: number; lng: number };

export interface TransitJourney {
  departSec: number;
  arriveSec: number;
  steps: TransitStep[];
  geometry: [number, number][];
  distanceKm: number;
  /** Araca biniş sayısı (ücret için) */
  rides: number;
  /** Yolculukta gerçek tarife olmayan (tahmini sıklıktan türetilmiş) bir hat var */
  synthetic: boolean;
}

interface Meta {
  version: number;
  builtAt: string;
  source: string;
  /** Gerçek tarife değil, sefer sıklığından türetilmiş (ör. Ankara, OSM) */
  synthetic?: boolean;
  layout:Record<string, { type: string; offset: number; length: number }>;
  stops: { name: string[]; lat: number[]; lng: number[] };
  routes: { name: string; longName: string; type: number; agency: string; synthetic?: boolean }[];
}

const ROUTE_TYPE: Record<number, Vehicle> = {
  0: "tramvay",
  1: "metro",
  2: "tren",
  3: "otobus",
  4: "vapur",
  5: "tramvay",
  6: "teleferik",
  7: "funikuler",
};

const TYPED = { Int32Array, Uint16Array, Uint8Array } as const;
type Typed = Int32Array | Uint16Array | Uint8Array;

export class TransitRouter {
  private readonly meta: Meta;
  private readonly a: Record<string, Typed>;
  private readonly nStops: number;
  private readonly nTrips: number;
  private readonly nConns: number;
  /** Durak ızgarası: başlangıç/bitiş durağı aramak için */
  private readonly grid = new Map<string, number[]>();
  private static readonly CELL = 0.01;

  constructor(binPath: string, metaPath: string) {
    this.meta = JSON.parse(readFileSync(metaPath, "utf8")) as Meta;
    if (this.meta.version !== FORMAT_VERSION) {
      throw new Error(`GTFS biçim sürümü uyumsuz: ${this.meta.version}`);
    }
    const file = readFileSync(binPath);
    // Tipli görünümler için hizalı, kendine ait bir ArrayBuffer gerekir
    const buf =
      file.byteOffset % 4 === 0
        ? file.buffer
        : file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const base = file.byteOffset % 4 === 0 ? file.byteOffset : 0;

    this.a = {};
    for (const [name, { type, offset, length }] of Object.entries(this.meta.layout)) {
      const T = TYPED[type as keyof typeof TYPED];
      if (!T) throw new Error(`Bilinmeyen dizi tipi: ${type}`);
      this.a[name] = new T(buf, base + offset, length);
    }
    this.nStops = this.meta.stops.name.length;
    this.nTrips = this.a.tripRoute.length;
    this.nConns = this.a.connDepTime.length;

    for (let i = 0; i < this.nStops; i++) {
      const key = this.cellKey(this.meta.stops.lat[i], this.meta.stops.lng[i]);
      const list = this.grid.get(key);
      if (list) list.push(i);
      else this.grid.set(key, [i]);
    }
  }

  get info() {
    return {
      builtAt: this.meta.builtAt,
      source: this.meta.source,
      synthetic: this.synthetic,
      stops: this.nStops,
      connections: this.nConns,
    };
  }

  /** Tüm beslemenin saatleri gerçek tarife değil (hat bazında değil, tüm şehir) */
  get synthetic(): boolean {
    return this.meta.synthetic ?? false;
  }

  private cellKey(lat: number, lng: number) {
    return `${Math.floor(lat / TransitRouter.CELL)}:${Math.floor(lng / TransitRouter.CELL)}`;
  }

  private stopPoint(i: number): Point {
    return { lat: this.meta.stops.lat[i], lng: this.meta.stops.lng[i] };
  }

  /** Noktaya yürüme mesafesindeki duraklar ve yürüme süreleri (sn) */
  private nearbyStops(p: Point): Map<number, number> {
    const out = new Map<number, number>();
    const cy = Math.floor(p.lat / TransitRouter.CELL);
    const cx = Math.floor(p.lng / TransitRouter.CELL);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const s of this.grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
          const m = haversineKm(p, this.stopPoint(s)) * 1000 * ROAD_FACTOR;
          if (m <= ACCESS_RADIUS_M * ROAD_FACTOR) out.set(s, Math.round((m / WALK_M_PER_MIN) * 60));
        }
      }
    }
    return out;
  }

  /** Biniş ve iniş durağı yürünecek kadar yakın mı (anlamsız kısa biniş) */
  private isHop(boardStop: number, alightStop: number): boolean {
    return haversineKm(this.stopPoint(boardStop), this.stopPoint(alightStop)) * 1000 < MIN_RIDE_M;
  }

  /** Kalkış saatinden sonraki ilk bağlantı (ikili arama) */
  private firstConnAfter(t: number): number {
    const dep = this.a.connDepTime;
    let lo = 0;
    let hi = this.nConns;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (dep[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * @param departSec gün başından saniye
   * @param weekday 0 = Pazar … 6 = Cumartesi
   */
  plan(from: Point, to: Point, departSec: number, weekday: number): TransitJourney | null {
    const { connDepStop, connArrStop, connDepTime, connArrTime, connTrip, connDayMask, footStart, footTo, footDur } =
      this.a;
    const dayBit = 1 << weekday;

    const access = this.nearbyStops(from);
    const egress = this.nearbyStops(to);
    if (access.size === 0 || egress.size === 0) return null;

    // Her durak için gerçek varış saati (arr) ve biriken biniş cezası (pen).
    // Karşılaştırmalar "etiket" = arr + pen üzerinden yapılır; böylece az
    // binişli rotalar tercih edilir ama gösterilen saatler gerçek kalır.
    const arr = new Int32Array(this.nStops).fill(INF);
    const pen = new Int32Array(this.nStops);
    const inConn = new Int32Array(this.nStops).fill(-1);
    const inFoot = new Int32Array(this.nStops).fill(-1);
    const tripBoard = new Int32Array(this.nTrips).fill(-1);
    const tripPen = new Int32Array(this.nTrips);
    /** Durağa doğrudan başlangıçtan yürüyerek mi ulaşıldı (aktarma payı yok) */
    const fromAccess = new Uint8Array(this.nStops);
    /**
     * Biniş için kullanılmış durak. Varış saati sonradan geç bir değerle
     * güncellenirse geri izleme tutarsız saat üretir; bunu engeller.
     */
    const boardedAt = new Uint8Array(this.nStops);
    const label = (s: number) => arr[s] + pen[s];
    const improves = (s: number, t: number, p: number) =>
      t + p < label(s) && (t <= arr[s] || !boardedAt[s]);

    for (const [s, walk] of access) {
      arr[s] = departSec + walk;
      fromAccess[s] = 1;
    }

    // Doğrudan yürüme de bir seçenek; toplu taşıma bunu (cezasıyla) geçmeli
    const directWalk = Math.round(((haversineKm(from, to) * 1000 * ROAD_FACTOR) / WALK_M_PER_MIN) * 60);
    let bestLabel = departSec + directWalk;
    let bestArrive = bestLabel;
    let bestStop = -1;

    const reach = (s: number) => {
      const e = egress.get(s);
      if (e !== undefined && label(s) + e < bestLabel) {
        bestLabel = label(s) + e;
        bestArrive = arr[s] + e;
        bestStop = s;
      }
    };
    for (const [s] of access) reach(s);

    for (let c = this.firstConnAfter(departSec); c < this.nConns; c++) {
      const dep = connDepTime[c];
      // Etiket ≥ varış ≥ kalkış; bundan sonra iyileşme olamaz
      if (dep >= bestLabel) break;
      if ((connDayMask[c] & dayBit) === 0) continue;

      const trip = connTrip[c];
      if (tripBoard[trip] === -1) {
        const s = connDepStop[c];
        const ready = arr[s] + (fromAccess[s] ? 0 : TRANSFER_SLACK_S);
        if (ready > dep) continue;
        tripBoard[trip] = c;
        tripPen[trip] = pen[s] + BOARDING_PENALTY_S;
        boardedAt[s] = 1;
      }

      const s2 = connArrStop[c];
      const t2 = connArrTime[c];
      const p2 = tripPen[trip];
      if (improves(s2, t2, p2) && !this.isHop(connDepStop[tripBoard[trip]], s2)) {
        arr[s2] = t2;
        pen[s2] = p2;
        inConn[s2] = c;
        inFoot[s2] = -1;
        fromAccess[s2] = 0;
        reach(s2);
        for (let f = footStart[s2]; f < footStart[s2 + 1]; f++) {
          const s3 = footTo[f];
          const t3 = t2 + footDur[f];
          if (improves(s3, t3, p2)) {
            arr[s3] = t3;
            pen[s3] = p2;
            inConn[s3] = -1;
            inFoot[s3] = s2;
            fromAccess[s3] = 0;
            reach(s3);
          }
        }
      }
    }

    if (bestStop === -1) return null; // yürümek daha iyi

    return this.extract(from, to, departSec, bestArrive, bestStop, access, arr, inConn, inFoot, tripBoard);
  }

  private extract(
    from: Point,
    to: Point,
    departSec: number,
    arriveSec: number,
    lastStop: number,
    access: Map<number, number>,
    arr: Int32Array,
    inConn: Int32Array,
    inFoot: Int32Array,
    tripBoard: Int32Array,
  ): TransitJourney {
    const { connDepStop, connDepTime, connArrTime, connTrip, tripRoute, tripPattern } = this.a;
    const name = (s: number) => this.meta.stops.name[s];
    const reversed: TransitStep[] = [];

    // Son duraktan hedefe yürüme
    reversed.push(this.walkStep(name(lastStop), "Varış noktası", this.stopPoint(lastStop), to, arr[lastStop], arriveSec));

    let s = lastStop;
    let rides = 0;
    let synthetic = this.synthetic;
    for (let guard = 0; guard < 50; guard++) {
      if (inConn[s] >= 0) {
        const exit = inConn[s];
        const trip = connTrip[exit];
        const enter = tripBoard[trip];
        const boardStop = connDepStop[enter];
        const route = this.meta.routes[tripRoute[trip]];
        const slice = this.patternSlice(tripPattern[trip], boardStop, s);
        reversed.push({
          kind: "binis",
          from: name(boardStop),
          to: name(s),
          depart: toHHMM(connDepTime[enter] / 60),
          arrive: toHHMM(connArrTime[exit] / 60),
          durationMin: Math.round((connArrTime[exit] - connDepTime[enter]) / 60),
          line: route.name,
          lineName: route.longName,
          // Marmaray veride metro (1) türünde ama banliyö treni
          vehicle: /TCDD/i.test(route.agency) ? "tren" : (ROUTE_TYPE[route.type] ?? "otobus"),
          geometry: slice.line,
          geometryExact: slice.exact,
        });
        rides++;
        synthetic ||= route.synthetic ?? false;
        s = boardStop;
      } else if (inFoot[s] >= 0) {
        const prev = inFoot[s];
        reversed.push(this.walkStep(name(prev), name(s), this.stopPoint(prev), this.stopPoint(s), arr[prev], arr[s]));
        s = prev;
      } else {
        // Başlangıç noktasından ilk durağa yürüme
        const walk = access.get(s) ?? 0;
        reversed.push(this.walkStep("Başlangıç noktası", name(s), from, this.stopPoint(s), departSec, departSec + walk));
        break;
      }
    }

    // Ardışık yürüme adımlarını birleştir (çizgileriyle), süresiz yürümeleri at
    const steps: TransitStep[] = [];
    for (const step of reversed.reverse()) {
      const last = steps.at(-1);
      if (step.kind === "yurume" && last?.kind === "yurume") {
        last.to = step.to;
        last.arrive = step.arrive;
        last.durationMin += step.durationMin;
        last.geometry = [...last.geometry, ...step.geometry.slice(1)];
      } else steps.push({ ...step });
    }

    return {
      departSec,
      arriveSec,
      steps: steps.filter((st) => st.kind === "binis" || st.durationMin > 0),
      geometry: steps.flatMap((st) => st.geometry),
      distanceKm: steps.reduce((sum, st) => sum + lineLengthKm(st.geometry), 0),
      rides,
      synthetic,
    };
  }

  private walkStep(fromName: string, toName: string, a: Point, b: Point, t0: number, t1: number): TransitStep {
    return {
      kind: "yurume",
      from: fromName,
      to: toName,
      depart: toHHMM(t0 / 60),
      arrive: toHHMM(t1 / 60),
      durationMin: Math.round((t1 - t0) / 60),
      geometry: [
        [a.lng, a.lat],
        [b.lng, b.lat],
      ],
      geometryExact: false,
    };
  }

  /**
   * Biniş ile iniş arasındaki çizgi. Kalıbın hat şekli varsa şekil
   * noktalarından, yoksa ara durakların koordinatlarından oluşur.
   *
   * exact: şekil duraklardan belirgin şekilde fazla nokta içeriyorsa gerçek
   * hat geometrisi sayılır (ör. ESHOT). İBB'nin şekilleri neredeyse yalnızca
   * durak koordinatlarından oluştuğu için (oran ~1,5) gerçek sayılmaz.
   */
  private patternSlice(
    pattern: number,
    fromStop: number,
    toStop: number,
  ): { line: [number, number][]; exact: boolean } {
    const { patStart, patStops, patStopShapePt, shapeLat, shapeLng } = this.a;
    const startIdx = patStart[pattern];
    const endIdx = patStart[pattern + 1];
    let i = startIdx;
    while (i < endIdx && patStops[i] !== fromStop) i++;
    let j = i;
    while (j < endIdx && patStops[j] !== toStop) j++;
    if (i >= endIdx || j >= endIdx) {
      const a = this.stopPoint(fromStop);
      const b = this.stopPoint(toStop);
      return {
        line: [
          [a.lng, a.lat],
          [b.lng, b.lat],
        ],
        exact: false,
      };
    }

    const p0 = patStopShapePt[i];
    const p1 = patStopShapePt[j];
    if (p0 >= 0 && p1 > p0) {
      const line: [number, number][] = [];
      for (let k = p0; k <= p1; k++) line.push([shapeLng[k] / 1e6, shapeLat[k] / 1e6]);
      return { line, exact: line.length >= DENSE_SHAPE_RATIO * (j - i + 1) };
    }

    const line: [number, number][] = [];
    for (let k = i; k <= j; k++) {
      const p = this.stopPoint(patStops[k]);
      line.push([p.lng, p.lat]);
    }
    return { line, exact: false };
  }
}

export function lineLengthKm(line: [number, number][]): number {
  let km = 0;
  for (let i = 1; i < line.length; i++) {
    km += haversineKm({ lng: line[i - 1][0], lat: line[i - 1][1] }, { lng: line[i][0], lat: line[i][1] });
  }
  return km;
}

// ---------- Şehir bazlı tekil yükleme ----------

const routers = new Map<string, TransitRouter | null>();

/** Şehrin GTFS yönlendiricisi; veri üretilmemişse null (tahmine düşülür) */
export function getTransitRouter(cityId: string): TransitRouter | null {
  if (routers.has(cityId)) return routers.get(cityId)!;
  const dir = path.join(process.cwd(), "data", "gtfs", "build");
  const bin = path.join(dir, `${cityId}.bin`);
  const meta = path.join(dir, `${cityId}.meta.json`);
  let router: TransitRouter | null = null;
  if (existsSync(bin) && existsSync(meta)) {
    try {
      const t0 = Date.now();
      router = new TransitRouter(bin, meta);
      console.log(`[gtfs] ${cityId} yüklendi (${Date.now() - t0} ms)`, router.info);
    } catch (error) {
      console.error(`[gtfs] ${cityId} yüklenemedi:`, error);
    }
  }
  routers.set(cityId, router);
  return router;
}
