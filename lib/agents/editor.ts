/**
 * Plan düzenleyici (deterministik).
 *
 * Mevcut planda tek bir durağı çıkarır ya da yerine benzer bir mekan koyar.
 * Diğer günler ve duraklar korunur; keşif ajanı yeniden çalıştırılmaz.
 */
import { addDays, haversineKm, weekday } from "@/lib/geo";
import type { City, Place, PlanEdit, TripRequest } from "@/lib/types";
import { popularity } from "./discovery";

/** Popülerlikle yakınlığı dengeler: 1 puan ≈ 1,5 km */
const KM_PER_POINT = 1.5;
/** Aynı kategoriden olana öncelik */
const SAME_CATEGORY_BONUS = 2;

const isFood = (p: Place) => p.category === "yemek" || p.category === "kafe";

export interface EditResult {
  days: string[][];
  message: string;
}

export function applyEdit(city: City, req: TripRequest, edit: PlanEdit): EditResult {
  const byId = new Map(city.places.map((p) => [p.id, p]));
  const days = edit.days.map((ids) => ids.filter((id) => byId.has(id)));
  const dayIdx = edit.day - 1;
  const target = byId.get(edit.placeId);
  if (!target || !days[dayIdx]?.includes(edit.placeId)) {
    throw new EditError("Düzenlenecek mekan planda bulunamadı");
  }

  days[dayIdx] = days[dayIdx].filter((id) => id !== edit.placeId);
  if (edit.action === "cikar") {
    return { days, message: `${target.name} plandan çıkarıldı.` };
  }

  const replacement = findReplacement(city, req, target, new Set(days.flat()), addDays(req.startDate, dayIdx));
  if (!replacement) {
    return { days, message: `${target.name} için uygun bir alternatif bulunamadı; plandan çıkarıldı.` };
  }
  days[dayIdx].push(replacement.id);
  return { days, message: `${target.name} yerine ${replacement.name} eklendi.` };
}

/**
 * Yerine konacak mekan: aynı tür (yeme-içme ↔ yeme-içme, gezi ↔ gezi), o gün
 * açık, planda olmayan; popülerlik, kategori uyumu ve yakınlığın en iyi dengesi.
 */
function findReplacement(city: City, req: TripRequest, removed: Place, used: Set<string>, date: string): Place | null {
  const dow = weekday(date);
  const interests = new Set(req.interests);
  const score = (p: Place) =>
    popularity(p) +
    (p.category === removed.category ? SAME_CATEGORY_BONUS : 0) -
    haversineKm(removed, p) / KM_PER_POINT;

  const candidates = city.places.filter(
    (p) =>
      p.id !== removed.id &&
      !used.has(p.id) &&
      isFood(p) === isFood(removed) &&
      !p.hours?.closedDays.includes(dow) &&
      // Gezi yerinde kullanıcının ilgi alanı ya da çıkarılanla aynı kategori
      (isFood(p) || p.category === removed.category || interests.has(p.category)),
  );
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? null;
}

export class EditError extends Error {}
