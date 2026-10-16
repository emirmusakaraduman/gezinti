/**
 * Bütçe ajanı (deterministik).
 *
 * Tüm kalemleri fiyat aralığı olarak toplar. Tahmini üst sınıra göre
 * durum belirler ve aşım riski varsa tasarruf önerir.
 */
import { formatRange, roundRange, scaleRange, sumRanges } from "@/lib/geo";
import type {
  BudgetSummary,
  City,
  DayPlan,
  PlanWarning,
  TripRequest,
} from "@/lib/types";

/** Bu oranın üstünde "yaklaşıyor" uyarısı verilir */
const NEAR_LIMIT = 0.8;

export function summarizeBudget(
  days: DayPlan[],
  city: City,
  req: TripRequest,
): BudgetSummary {
  const stops = days.flatMap((d) => d.stops);
  const legs = days.flatMap((d) => d.legs);
  const isFood = (c: string) => c === "yemek" || c === "kafe";

  const activities = sumRanges(
    stops
      .filter((s) => !isFood(s.place.category))
      .map((s) => scaleRange(s.place.price, req.travelers)),
  );
  const food = sumRanges(
    stops
      .filter((s) => isFood(s.place.category))
      .map((s) => scaleRange(s.place.price, req.travelers)),
  );
  const transport = sumRanges(legs.map((l) => l.cost));
  const parking = sumRanges(
    days
      .filter(
        (d) => req.transport === "araba" && d.legs.some((l) => l.mode === "araba"),
      )
      .map(() => city.parkingPerDay),
  );
  const total = roundRange(sumRanges([activities, food, transport, parking]));

  const usageRatio = total.max / req.budget;
  const status: BudgetSummary["status"] =
    total.min > req.budget
      ? "asiyor"
      : total.max > req.budget
        ? "asabilir"
        : usageRatio >= NEAR_LIMIT
          ? "yaklasiyor"
          : "rahat";

  // Tasarruf önerileri: en pahalı ücretli aktiviteler
  const savings =
    status === "rahat"
      ? []
      : stops
          .filter((s) => s.place.price.max > 0)
          .map((s) => ({
            placeId: s.place.id,
            placeName: s.place.name,
            saves: scaleRange(s.place.price, req.travelers),
          }))
          .sort((a, b) => b.saves.max - a.saves.max)
          .slice(0, 3);

  return {
    budget: req.budget,
    total,
    breakdown: { activities, food, transport, parking },
    usageRatio,
    status,
    savings,
  };
}

export function budgetWarnings(summary: BudgetSummary): PlanWarning[] {
  const budgetText = `${summary.budget.toLocaleString("tr-TR")} TL`;
  const totalText = formatRange(summary.total);
  const tips = summary.savings
    .map((s) => `${s.placeName} (${formatRange(s.saves)})`)
    .join(", ");

  switch (summary.status) {
    case "asiyor":
      return [
        {
          level: "asim",
          message: `Tahmini maliyet (${totalText}) bütçeni (${budgetText}) aşıyor. Çıkarılabilecekler: ${tips}.`,
        },
      ];
    case "asabilir":
      return [
        {
          level: "uyari",
          message: `Fiyatlar aralığın üst ucuna yakın olursa bütçe (${budgetText}) aşılabilir; tahmin ${totalText}. Gerekirse çıkarılabilecekler: ${tips}.`,
        },
      ];
    case "yaklasiyor":
      return [
        {
          level: "bilgi",
          message: `Bütçenin %${Math.round(summary.usageRatio * 100)}'i kullanılıyor (${totalText}). Ek harcamalar için az pay kalıyor.`,
        },
      ];
    default:
      return [];
  }
}
