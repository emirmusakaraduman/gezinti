/**
 * Rota ajanı (deterministik).
 *
 * Seçilen mekanları gün içinde sıralar ve aralarındaki ulaşımı hesaplar.
 * Yürüme ve araba ayakları OSRM'den gerçek yol verisiyle gelir; OSRM'e
 * ulaşılamazsa kuş uçuşu mesafe + katsayı ile tahmin edilir.
 * TODO: toplu taşıma için GTFS + OpenTripPlanner bağlanacak.
 */
import {
  ZERO,
  addDays,
  haversineKm,
  roundRange,
  scaleRange,
  sumRanges,
  toHHMM,
  toMinutes,
} from "@/lib/geo";
import { osrmRoute } from "@/lib/routing/osrm";
import type {
  City,
  DayPlan,
  Leg,
  LegMode,
  Place,
  Stop,
  TransportMode,
} from "@/lib/types";

/** Kuş uçuşu mesafeyi yol mesafesine çeviren kaba katsayı */
const ROAD_FACTOR = 1.3;
/** Bu mesafenin altı her modda yürünür */
const WALK_THRESHOLD_KM = 1.2;
const WALK_KMH = 4.5;
const TRANSIT_KMH = 18;
const TRANSIT_WAIT_MIN = 10;
const CAR_KMH = 25;
const CAR_PARKING_MIN = 10;
/** Gerçek yürüme mesafesi bunun altındaysa yürünür */
const WALK_MAX_KM = 1.5;
/** OSRM trafiksiz süre verir; şehir içi trafik için çarpan */
const CAR_TRAFFIC_FACTOR = 1.5;
/** Bu kuş uçuşu mesafenin üstünde yürüme rotası hiç sorulmaz */
const WALK_PROBE_KM = 1.6;

export const DAY_START = "09:30";

export function estimateLeg(
  from: Place,
  to: Place,
  transport: TransportMode,
  city: City,
  travelers: number,
): Leg {
  const distanceKm = haversineKm(from, to) * ROAD_FACTOR;
  const base = { fromId: from.id, toId: to.id, distanceKm, estimated: true, geometry: null };

  if (distanceKm <= WALK_THRESHOLD_KM) {
    return {
      ...base,
      mode: "yurume",
      durationMin: Math.ceil((distanceKm / WALK_KMH) * 60),
      cost: ZERO,
    };
  }

  if (transport === "araba") {
    return {
      ...base,
      mode: "araba",
      durationMin: Math.ceil((distanceKm / CAR_KMH) * 60) + CAR_PARKING_MIN,
      // Araba maliyeti yolcu sayısından bağımsızdır
      cost: roundRange(scaleRange(city.carCostPerKm, distanceKm)),
    };
  }

  // Toplu taşıma. GTFS bağlanana kadar hız + bekleme ile tahmin.
  // GTFS olmayan şehirlerde de aynı tahmin kullanılır.
  return {
    ...base,
    mode: "toplu_tasima" satisfies LegMode,
    durationMin:
      Math.ceil((distanceKm / TRANSIT_KMH) * 60) + TRANSIT_WAIT_MIN,
    cost: scaleRange(city.transitFare, travelers),
  };
}

/**
 * Ayağı OSRM ile hesapla. Önce yürüme denenir; kısa değilse araba
 * (OSRM) veya toplu taşıma (tahmin) kullanılır. OSRM yanıt vermezse
 * estimateLeg'e düşer.
 */
export async function resolveLeg(
  from: Place,
  to: Place,
  transport: TransportMode,
  city: City,
  travelers: number,
): Promise<Leg> {
  const fallback = estimateLeg(from, to, transport, city, travelers);
  const ids = { fromId: from.id, toId: to.id };

  if (haversineKm(from, to) <= WALK_PROBE_KM) {
    const walk = await osrmRoute("foot", from, to);
    if (walk && walk.distanceKm <= WALK_MAX_KM) {
      return {
        ...ids,
        mode: "yurume",
        distanceKm: walk.distanceKm,
        durationMin: Math.ceil(walk.durationMin),
        cost: ZERO,
        estimated: false,
        geometry: walk.geometry,
      };
    }
    // Yürüme uzun çıktıysa tahmin de yürüme demesin
    if (walk && fallback.mode === "yurume" && transport === "toplu_tasima") {
      return {
        ...ids,
        mode: "toplu_tasima",
        distanceKm: walk.distanceKm,
        durationMin: Math.ceil((walk.distanceKm / TRANSIT_KMH) * 60) + TRANSIT_WAIT_MIN,
        cost: scaleRange(city.transitFare, travelers),
        estimated: true,
        geometry: null,
      };
    }
  }

  if (transport === "araba") {
    const drive = await osrmRoute("car", from, to);
    if (drive) {
      return {
        ...ids,
        mode: "araba",
        distanceKm: drive.distanceKm,
        durationMin: Math.ceil(drive.durationMin * CAR_TRAFFIC_FACTOR) + CAR_PARKING_MIN,
        cost: roundRange(scaleRange(city.carCostPerKm, drive.distanceKm)),
        // Trafik çarpanı tahmini olsa da güzergah gerçek
        estimated: false,
        geometry: drive.geometry,
      };
    }
    return fallback;
  }

  // Toplu taşıma: GTFS bağlanana kadar tahmin
  return fallback;
}

const isBreakfast =(p: Place) => p.tags.includes("kahvalti");
const isMeal = (p: Place) => p.category === "yemek" || p.category === "kafe";

function tourLength(order: Place[]): number {
  let total = 0;
  for (let i = 1; i < order.length; i++) {
    total += haversineKm(order[i - 1], order[i]);
  }
  return total;
}

/** En yakın komşu + 2-opt ile gezilecek yerleri sırala. */
function orderSights(sights: Place[]): Place[] {
  if (sights.length <= 2) return sights;

  const remaining = [...sights];
  const order = [remaining.shift()!];
  while (remaining.length) {
    const last = order[order.length - 1];
    let best = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (haversineKm(last, remaining[i]) < haversineKm(last, remaining[best])) {
        best = i;
      }
    }
    order.push(remaining.splice(best, 1)[0]);
  }

  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        if (tourLength(candidate) < tourLength(order) - 1e-9) {
          order.splice(0, order.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return order;
}

/** Yemek durağını rotayı en az uzatacak yere yerleştir. */
function insertMeal(order: Place[], meal: Place, minIndex: number): Place[] {
  let bestIdx = order.length;
  let bestCost = Infinity;
  for (let i = Math.min(minIndex, order.length); i <= order.length; i++) {
    const candidate = [...order.slice(0, i), meal, ...order.slice(i)];
    const cost = tourLength(candidate);
    if (cost < bestCost) {
      bestCost = cost;
      bestIdx = i;
    }
  }
  return [...order.slice(0, bestIdx), meal, ...order.slice(bestIdx)];
}

export function orderDay(places: Place[]): Place[] {
  const breakfasts = places.filter(isBreakfast);
  const meals = places.filter((p) => isMeal(p) && !isBreakfast(p));
  let order = orderSights(places.filter((p) => !isMeal(p)));
  // Öğle/akşam yemeği ilk duraktan sonra gelsin
  for (const meal of meals) order = insertMeal(order, meal, 1);
  return [...breakfasts, ...order];
}

export async function buildDay(
  dayIndex: number,
  places: Place[],
  city: City,
  transport: TransportMode,
  startDate: string,
  travelers: number,
  notes: Map<string, string>,
): Promise<DayPlan> {
  const ordered = orderDay(places);
  // Tüm ayakları paralel sor (OSRM istemcisi eşzamanlılığı sınırlar)
  const legs: Leg[] = await Promise.all(
    ordered
      .slice(1)
      .map((place, i) => resolveLeg(ordered[i], place, transport, city, travelers)),
  );
  const stops: Stop[] = [];
  let clock = toMinutes(DAY_START);

  ordered.forEach((place, i) => {
    if (i > 0) clock += legs[i - 1].durationMin;
    // Mekan henüz açılmadıysa bekle
    if (place.hours) clock = Math.max(clock, toMinutes(place.hours.open));
    const arrival = clock;
    clock += place.durationMin;
    stops.push({
      place,
      arrival: toHHMM(arrival),
      departure: toHHMM(clock),
      note: notes.get(place.id),
    });
  });

  const placeCosts = ordered.map((p) => scaleRange(p.price, travelers));
  const legCosts = legs.map((l) => l.cost);
  const parking =
    transport === "araba" && legs.some((l) => l.mode === "araba")
      ? [city.parkingPerDay]
      : [];

  return {
    day: dayIndex + 1,
    date: addDays(startDate, dayIndex),
    stops,
    legs,
    cost: sumRanges([...placeCosts, ...legCosts, ...parking]),
  };
}
