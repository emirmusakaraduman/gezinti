import type { OpeningHours, PriceRange } from "@/lib/types";

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
