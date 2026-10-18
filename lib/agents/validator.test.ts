import { describe, expect, it } from "vitest";
import { ZERO } from "@/lib/geo";
import type { DayPlan, Leg, Place } from "@/lib/types";
import { hoursFn, place } from "@/test/fixtures";
import { validateDays } from "./validator";

// 2026-10-20 Salı (2)
function day(stops: [Place, string, string][], legs: Partial<Leg>[] = []): DayPlan {
  return {
    day: 1,
    date: "2026-10-20",
    stops: stops.map(([p, arrival, departure]) => ({ place: p, arrival, departure })),
    legs: legs.map((l) => ({
      fromId: "a",
      toId: "b",
      mode: "yurume",
      distanceKm: 1,
      durationMin: 10,
      cost: ZERO,
      estimated: false,
      geometry: null,
      ...l,
    })),
    cost: ZERO,
  };
}

describe("validateDays", () => {
  it("o gün kapalı olan yeri kritik hata olarak bildirir", () => {
    const topkapi = place({ name: "Topkapı", hours: hoursFn([2]) });
    const issues = validateDays([day([[topkapi, "10:00", "12:00"]])]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: "asim", placeId: topkapi.id });
    expect(issues[0].message).toContain("Salı");
  });

  it("kapanıştan sonra çıkılacaksa uyarır", () => {
    const museum = place({ hours: hoursFn() }); // 09:00-18:00
    expect(validateDays([day([[museum, "17:30", "18:30"]])])[0]).toMatchObject({ level: "uyari" });
    expect(validateDays([day([[museum, "16:00", "17:30"]])])).toEqual([]);
  });

  it("gece yarısından sonra kapanan yerde kapanış uyarısı vermez", () => {
    // Gün 22:30 sınırını aşmasın diye (ayrı bir kural) saatler erken
    const bar = place({ hours: { open: "18:00", close: "02:00", closedDays: [] } });
    expect(validateDays([day([[bar, "20:00", "21:30"]])])).toEqual([]);
  });

  it("saati bilinmeyen yerde sessiz kalır", () => {
    expect(validateDays([day([[place({ hours: null }), "08:00", "21:00"]])])).toEqual([]);
  });

  it("çok uzun günü ve çok fazla yolu bildirir", () => {
    const late = validateDays([day([[place(), "21:30", "23:00"]])]);
    expect(late.some((i) => i.message.includes("çok yoğun"))).toBe(true);
    const travel = validateDays([day([[place(), "10:00", "11:00"]], [{ durationMin: 120 }, { durationMin: 90 }])]);
    expect(travel.some((i) => i.message.includes("yolda"))).toBe(true);
  });
});
