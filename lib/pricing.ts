/**
 * Giriş ücretleri: tüm ajanlar fiyatı buradan okur, Müzekart tek yerde
 * hesaba katılır. Fiyatlar T.C. vatandaşı (yerli) tarifesidir.
 */
import { ZERO } from "@/lib/geo";
import type { Place, PriceRange, TripRequest } from "@/lib/types";

/**
 * Kültür ve Turizm Bakanlığı Müzekart'ı, T.C. vatandaşı, yıllık
 * (2 Şubat 2026'dan beri; birden çok kaynakta tutarlı)
 */
export const MUZEKART_PRICE: PriceRange = {
  min: 200,
  max: 200,
  confidence: "net",
  lastVerified: "2026-10-18",
};

/** Kişi başı giriş ücreti; Müzekart varsa ve geçerliyse ücretsiz */
export function ticketPrice(place: Place, req: Pick<TripRequest, "hasMuzekart">): PriceRange {
  return req.hasMuzekart && place.muzekart ? ZERO : place.price;
}
