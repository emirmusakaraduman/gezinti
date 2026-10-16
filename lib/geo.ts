import type { PriceRange } from "@/lib/types";

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// ---------- Fiyat aralığı aritmetiği ----------

export const ZERO: PriceRange = {
  min: 0,
  max: 0,
  confidence: "net",
  lastVerified: null,
};

/** İki aralığı topla; biri tahminiyse sonuç da tahminidir. */
export function addRange(a: PriceRange, b: PriceRange): PriceRange {
  return {
    min: a.min + b.min,
    max: a.max + b.max,
    confidence:
      a.confidence === "tahmini" || b.confidence === "tahmini"
        ? "tahmini"
        : "net",
    lastVerified: null,
  };
}

export function scaleRange(r: PriceRange, factor: number): PriceRange {
  return { ...r, min: r.min * factor, max: r.max * factor };
}

export function sumRanges(ranges: PriceRange[]): PriceRange {
  return ranges.reduce(addRange, ZERO);
}

export function roundRange(r: PriceRange, step = 10): PriceRange {
  return {
    ...r,
    min: Math.floor(r.min / step) * step,
    max: Math.ceil(r.max / step) * step,
  };
}

export function formatRange(r: PriceRange): string {
  const fmt = (n: number) => Math.round(n).toLocaleString("tr-TR");
  if (r.max === 0) return "Ücretsiz";
  if (r.min === r.max) return `${fmt(r.min)} TL`;
  return `${fmt(r.min)}–${fmt(r.max)} TL`;
}

// ---------- Saat yardımcıları ----------

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekday(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}
