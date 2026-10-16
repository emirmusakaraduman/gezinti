/**
 * Doğrulayıcı ajan (deterministik).
 *
 * Planı gerçek dünya kısıtlarına karşı kontrol eder: kapalı günler,
 * kapanış saatinden sonra varış, aşırı yoğun günler.
 */
import { toMinutes, weekday } from "@/lib/geo";
import type { DayPlan, PlanWarning } from "@/lib/types";

const DAY_NAMES = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const MAX_DAY_END = toMinutes("22:30");
const MAX_TRAVEL_MIN = 180;

export interface ValidationIssue extends PlanWarning {
  day: number;
  placeId?: string;
}

export function validateDays(days: DayPlan[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const day of days) {
    const dow = weekday(day.date);

    for (const stop of day.stops) {
      const { hours, name, id } = stop.place;
      if (!hours) continue;

      if (hours.closedDays.includes(dow)) {
        issues.push({
          level: "asim",
          day: day.day,
          placeId: id,
          message: `${day.day}. gün: ${name} ${DAY_NAMES[dow]} günleri kapalı.`,
        });
        continue;
      }
      const close = toMinutes(hours.close);
      // Gece yarısından sonra kapanan yerler (ör. 02:00) her zaman yetişilir
      const closesAfterMidnight = close < toMinutes(hours.open);
      if (!closesAfterMidnight && toMinutes(stop.departure) > close) {
        issues.push({
          level: "uyari",
          day: day.day,
          placeId: id,
          message: `${day.day}. gün: ${name} ${hours.close}'de kapanıyor, ziyaret süresi yetmeyebilir.`,
        });
      }
    }

    const last = day.stops.at(-1);
    if (last && toMinutes(last.departure) > MAX_DAY_END) {
      issues.push({
        level: "uyari",
        day: day.day,
        message: `${day.day}. gün çok yoğun, program ${last.departure}'e kadar sürüyor.`,
      });
    }

    const travelMin = day.legs.reduce((s, l) => s + l.durationMin, 0);
    if (travelMin > MAX_TRAVEL_MIN) {
      issues.push({
        level: "uyari",
        day: day.day,
        message: `${day.day}. gün yolda yaklaşık ${travelMin} dk geçiyor; birbirine yakın yerler seçmek daha iyi olabilir.`,
      });
    }
  }

  return issues;
}
