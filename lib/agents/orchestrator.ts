/**
 * Orkestratör.
 *
 * Keşif → rota → doğrulama → bütçe döngüsünü yönetir. Plan bütçeyi
 * kesin aşıyorsa veya kapalı mekan içeriyorsa geri bildirimle keşif
 * ajanını tekrar çalıştırır (en fazla MAX_REVISIONS tur).
 */
import { getCity } from "@/lib/data/cities";
import type { PlanWarning, TripPlan, TripRequest } from "@/lib/types";
import { budgetWarnings, summarizeBudget } from "./budget";
import { selectPlaces, type Feedback } from "./discovery";
import { buildDay } from "./route";
import { validateDays } from "./validator";

const MAX_REVISIONS = 2;

export async function planTrip(req: TripRequest): Promise<TripPlan> {
  const city = getCity(req.cityId);
  if (!city) throw new Error(`Bilinmeyen şehir: ${req.cityId}`);
  const byId = new Map(city.places.map((p) => [p.id, p]));

  let feedback: Feedback | undefined;
  let revisions = 0;

  while (true) {
    const selection = await selectPlaces(city, req, feedback);

    const days = await Promise.all(
      selection.days.map((ids, i) =>
        buildDay(
          i,
          ids.map((id) => byId.get(id)!),
          city,
          req.transport,
          req.startDate,
          req.travelers,
          selection.notes,
        ),
      ),
    );

    const issues = validateDays(days);
    const budget = summarizeBudget(days, city, req);
    const closed = issues.filter((i) => i.level === "asim" && i.placeId);
    const needsRevision = budget.status === "asiyor" || closed.length > 0;

    if (needsRevision && revisions < MAX_REVISIONS) {
      revisions++;
      const messages = closed.map((i) => i.message);
      const excludeIds = [...(feedback?.excludeIds ?? [])];
      if (budget.status === "asiyor") {
        messages.push(
          `Tahmini toplam ${budget.total.min}-${budget.total.max} TL, bütçe ${req.budget} TL. Daha ucuz veya ücretsiz yerler seç.`,
        );
        // En pahalı kalemi bir sonraki turda dışarıda bırak
        if (budget.savings[0]) excludeIds.push(budget.savings[0].placeId);
      }
      feedback = { messages, excludeIds };
      continue;
    }

    const warnings: PlanWarning[] = [
      ...budgetWarnings(budget),
      ...issues.map(({ level, message }) => ({ level, message })),
    ];
    const transitLegs = days.flatMap((d) => d.legs).filter((l) => l.mode === "toplu_tasima");
    if (transitLegs.some((l) => l.transit)) {
      warnings.push({
        level: "bilgi",
        message:
          "Toplu taşıma, İBB'nin GTFS sefer verisiyle planlandı. Sefer saatleri değişmiş olabilir; yola çıkmadan kontrol et.",
      });
    }
    if (transitLegs.some((l) => !l.transit)) {
      warnings.push({
        level: "bilgi",
        message: `${city.name} için bazı toplu taşıma süreleri tahminidir (sefer verisi yok veya güzergah bulunamadı).`,
      });
    }
    if (selection.plannedBy === "sezgisel") {
      warnings.push({
        level: "bilgi",
        message: "Plan AI yerine yedek sezgisel yöntemle hazırlandı (API anahtarı yok veya AI çağrısı başarısız).",
      });
    }

    return {
      request: req,
      cityName: city.name,
      cityCenter: city.center,
      days,
      budget,
      warnings,
      summary: selection.summary,
      plannedBy: selection.plannedBy,
      revisions,
    };
  }
}
