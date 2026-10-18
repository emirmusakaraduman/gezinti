/**
 * Bütçe ajanı (deterministik).
 *
 * Tüm kalemleri fiyat aralığı olarak toplar. Tahmini üst sınıra göre
 * durum belirler ve aşım riski varsa tasarruf önerir. Müzekart'ı yoksa ve
 * plandaki Müzekart geçen yerlerin biletleri kartın fiyatını aşıyorsa
 * Müzekart almayı önerir.
 */
import { formatRange, roundRange, scaleRange, sumRanges } from "@/lib/geo";
import { MUZEKART_PRICE, ticketPrice } from "@/lib/pricing";
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
  const cost = (s: (typeof stops)[number]) => scaleRange(ticketPrice(s.place, req), req.travelers);

  const activities = sumRanges(stops.filter((s) => !isFood(s.place.category)).map(cost));
  const food = sumRanges(stops.filter((s) => isFood(s.place.category)).map(cost));
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

  // Tasarruf önerileri: en pahalı ücretli kalemler
  const savings =
    status === "rahat"
      ? []
      : stops
          .map((s) => ({ placeId: s.place.id, placeName: s.place.name, saves: cost(s) }))
          .filter((s) => s.saves.max > 0)
          .sort((a, b) => b.saves.max - a.saves.max)
          .slice(0, 3);

  return {
    budget: req.budget,
    total,
    breakdown: { activities, food, transport, parking },
    usageRatio,
    status,
    savings,
    muzekart: muzekartTip(stops.map((s) => s.place), req),
  };
}

/**
 * Müzekart yoksa: Müzekart geçen yerlerin kişi başı bilet toplamı kartın
 * fiyatını kesin olarak (alt sınırla bile) aşıyorsa toplam tasarruf
 */
function muzekartTip(places: DayPlan["stops"][number]["place"][], req: TripRequest): BudgetSummary["muzekart"] {
  if (req.hasMuzekart) return undefined;
  const covered = places.filter((p) => p.muzekart);
  if (!covered.length) return undefined;
  const perPerson = sumRanges(covered.map((p) => p.price));
  if (perPerson.min <= MUZEKART_PRICE.max) return undefined;
  return {
    places: covered.map((p) => p.name),
    saves: scaleRange(
      { ...perPerson, min: perPerson.min - MUZEKART_PRICE.max, max: perPerson.max - MUZEKART_PRICE.min },
      req.travelers,
    ),
  };
}

export function budgetWarnings(summary: BudgetSummary): PlanWarning[] {
  const budgetText = `${summary.budget.toLocaleString("tr-TR")} TL`;
  const totalText = formatRange(summary.total);
  const tips = summary.savings
    .map((s) => `${s.placeName} (${formatRange(s.saves)})`)
    .join(", ");

  const warnings: PlanWarning[] = [];
  switch (summary.status) {
    case "asiyor":
      warnings.push({
        level: "asim",
        message: `Tahmini maliyet (${totalText}) bütçeni (${budgetText}) aşıyor. Çıkarılabilecekler: ${tips}.`,
      });
      break;
    case "asabilir":
      warnings.push({
        level: "uyari",
        message: `Fiyatlar aralığın üst ucuna yakın olursa bütçe (${budgetText}) aşılabilir; tahmin ${totalText}. Gerekirse çıkarılabilecekler: ${tips}.`,
      });
      break;
    case "yaklasiyor":
      warnings.push({
        level: "bilgi",
        message: `Bütçenin %${Math.round(summary.usageRatio * 100)}'i kullanılıyor (${totalText}). Ek harcamalar için az pay kalıyor.`,
      });
      break;
  }
  if (summary.muzekart) {
    warnings.push({
      level: "bilgi",
      message: `Müzekart alırsan (kişi başı ${formatRange(MUZEKART_PRICE)}, bir yıl geçerli) ${summary.muzekart.places.join(", ")} girişleri ücretsiz olur; yaklaşık ${formatRange(summary.muzekart.saves)} tasarruf. "Müzekart'ım var" seçeneğiyle planı yeniden hesaplayabilirsin.`,
    });
  }
  return warnings;
}
