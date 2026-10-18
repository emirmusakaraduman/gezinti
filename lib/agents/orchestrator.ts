/**
 * Orkestratör.
 *
 * Keşif → rota → doğrulama → bütçe döngüsünü yönetir. Plan bütçeyi
 * kesin aşıyorsa veya kapalı mekan içeriyorsa geri bildirimle keşif
 * ajanını tekrar çalıştırır (en fazla MAX_REVISIONS tur).
 *
 * Düzenleme isteğinde (editPlan) keşif çalışmaz: mevcut plan düzenleyiciyle
 * değiştirilir, rota/doğrulama/bütçe yeniden hesaplanır.
 */
import { getCity } from "@/lib/data/cities";
import type { City, DayPlan, PlanEdit, PlanWarning, TripPlan, TripRequest } from "@/lib/types";
import { budgetWarnings, summarizeBudget } from "./budget";
import { selectPlaces, type Feedback, type Selection } from "./discovery";
import { applyEdit } from "./editor";
import { buildDay } from "./route";
import { validateDays, type ValidationIssue } from "./validator";

const MAX_REVISIONS = 2;

function cityOrThrow(id: string): City {
  const city = getCity(id);
  if (!city) throw new Error(`Bilinmeyen şehir: ${id}`);
  return city;
}

/** Seçimi günlere çevir: rota, saatler, maliyet */
function buildDays(city: City, req: TripRequest, selection: Pick<Selection, "days" | "notes">): Promise<DayPlan[]> {
  const byId = new Map(city.places.map((p) => [p.id, p]));
  return Promise.all(
    selection.days.map((ids, i) =>
      buildDay(
        i,
        ids.map((id) => byId.get(id)!),
        city,
        req,
        selection.notes,
      ),
    ),
  );
}

export async function planTrip(req: TripRequest): Promise<TripPlan> {
  const city = cityOrThrow(req.cityId);
  let feedback: Feedback | undefined;
  let revisions = 0;

  while (true) {
    const selection = await selectPlaces(city, req, feedback);
    const days = await buildDays(city, req, selection);
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

    return finalize(city, req, days, issues, {
      summary: selection.summary,
      plannedBy: selection.plannedBy,
      revisions,
    });
  }
}

/** Mevcut planda tek bir durağı çıkar ya da değiştir */
export async function editPlan(req: TripRequest, edit: PlanEdit): Promise<TripPlan> {
  const city = cityOrThrow(req.cityId);
  const { days: ids, message } = applyEdit(city, req, edit);
  const days = await buildDays(city, req, { days: ids, notes: new Map(Object.entries(edit.notes ?? {})) });
  return finalize(city, req, days, validateDays(days), {
    summary: edit.summary ?? "",
    plannedBy: edit.plannedBy ?? "sezgisel",
    revisions: 0,
    editMessage: message,
  });
}

function finalize(
  city: City,
  req: TripRequest,
  days: DayPlan[],
  issues: ValidationIssue[],
  meta: Pick<TripPlan, "summary" | "plannedBy" | "revisions" | "editMessage">,
): TripPlan {
  const budget = summarizeBudget(days, city, req);
  const warnings: PlanWarning[] = [
    ...budgetWarnings(budget),
    ...issues.map(({ level, message }) => ({ level, message })),
  ];
  const transitLegs = days.flatMap((d) => d.legs).filter((l) => l.mode === "toplu_tasima");
  if (transitLegs.some((l) => l.transit && !l.estimated)) {
    warnings.push({
      level: "bilgi",
      message: `${city.name} toplu taşıması, belediyenin yayımladığı sefer verisiyle planlandı. Sefer saatleri değişmiş olabilir; yola çıkmadan kontrol et.`,
    });
  }
  // Bazı hatlar sentetik tarifeli (ör. Ankara Başkentray): güzergah gerçek, saatler tahmini
  if (transitLegs.some((l) => l.transit && l.estimated)) {
    warnings.push({
      level: "bilgi",
      message: `${city.name} planında kullanılan bazı hatların (OpenStreetMap'ten türetilmiş) sefer saatleri tahminidir; gerçek tarife değildir.`,
    });
  }
  // Tarifesi gezi gününden önce bitmiş hat: yayımlanan veri güncel değil
  const stale = days.flatMap((d) => d.legs.filter((l) => l.validTo && l.validTo < d.date));
  if (stale.length) {
    const until = stale.map((l) => l.validTo!).sort()[0];
    const [y, m, d] = until.split("-");
    warnings.push({
      level: "bilgi",
      message: `${city.name}: planda kullanılan bazı hatların yayımlanmış tarifesi ${d}.${m}.${y} tarihinde bitiyor (kaynaktaki veri güncel değil); gerçek sefer saatleri farklı olabilir.`,
    });
  }
  if (transitLegs.some((l) => !l.transit)) {
    warnings.push({
      level: "bilgi",
      message: `${city.name} için bazı toplu taşıma süreleri tahminidir (sefer verisi yok veya güzergah bulunamadı).`,
    });
  }
  if (meta.plannedBy === "sezgisel") {
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
    ...meta,
  };
}
