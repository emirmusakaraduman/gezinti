import { haversineKm } from "@/lib/geo";
import type { OpeningHours, Place, PriceRange } from "@/lib/types";

const isFood = (p: Pick<Place, "category">) => p.category === "yemek" || p.category === "kafe";

/** Bu mesafede aynı türden bir üretilmiş yer varsa küratörlü kayıt düşer */
const DUPLICATE_KM = 0.25;

/**
 * Açık veriden üretilen mekanlarla (scripts/fetch-places.mjs) küratörlü
 * "deneyimleri" birleştirir. Küratörlü kayıt, yakınında aynı türden
 * (yeme-içme / gezi) üretilmiş bir yer varsa tekrar sayılıp atılır.
 *
 * Üretilmiş JSON'daki alanlar düz string olarak tiplenir; yükleme sırasında
 * CitySchema ile doğrulandığı için burada Place'e çevrilir.
 */
export function mergePlaces(generated: unknown[], curated: Place[]): Place[] {
  const gen = generated as Place[];
  const kept = curated.filter(
    (c) => !gen.some((g) => isFood(g) === isFood(c) && haversineKm(g, c) < DUPLICATE_KM),
  );
  return [...gen, ...kept];
}

/** Tahmini fiyat aralığı (güncel veri yok veya eski) */
export const est = (min: number, max: number): PriceRange => ({
  min,
  max,
  confidence: "tahmini",
  lastVerified: null,
});

/** Doğrulanmış net fiyat */
export const exact = (amount: number, verifiedOn: string): PriceRange => ({
  min: amount,
  max: amount,
  confidence: "net",
  lastVerified: verifiedOn,
});

export const FREE: PriceRange = exact(0, "2026-10-16");

export const hours = (
  open: string,
  close: string,
  closedDays: number[] = [],
): OpeningHours => ({ open, close, closedDays });

export const SUNDAY = 0;
export const MONDAY = 1;
export const TUESDAY = 2;
