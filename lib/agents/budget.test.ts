import { describe, expect, it } from "vitest";
import { ZERO } from "@/lib/geo";
import type { DayPlan, Leg, Place } from "@/lib/types";
import { city, place, range, request } from "@/test/fixtures";
import { budgetWarnings, summarizeBudget } from "./budget";

function day(places: Place[], legs: Partial<Leg>[] = []): DayPlan {
  return {
    day: 1,
    date: "2026-10-20",
    stops: places.map((p) => ({ place: p, arrival: "10:00", departure: "11:00" })),
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

const museum = (min: number, max: number) => place({ category: "muze", price: range(min, max) });
const meal = (min: number, max: number) => place({ category: "yemek", price: range(min, max) });

describe("summarizeBudget", () => {
  it("kalemleri kişi sayısıyla çarpıp aktivite/yemek/ulaşım olarak ayırır", () => {
    const s = summarizeBudget(
      [day([museum(100, 200), meal(300, 400)], [{ mode: "toplu_tasima", cost: range(60, 80) }])],
      city([]),
      request({ travelers: 2, budget: 10_000 }),
    );
    expect(s.breakdown.activities).toMatchObject({ min: 200, max: 400 });
    expect(s.breakdown.food).toMatchObject({ min: 600, max: 800 });
    expect(s.breakdown.transport).toMatchObject({ min: 60, max: 80 });
    expect(s.total).toMatchObject({ min: 860, max: 1280 });
  });

  it.each([
    // [üst sınır, bütçe, beklenen durum]
    [500, 1000, "rahat"],
    [850, 1000, "yaklasiyor"],
  ] as const)("üst sınır %i / bütçe %i → %s", (max, budget, status) => {
    const s = summarizeBudget([day([museum(0, max)])], city([]), request({ budget }));
    expect(s.status).toBe(status);
    expect(s.savings).toHaveLength(status === "rahat" ? 0 : 1);
  });

  it("alt sınır sığıyor üst sınır sığmıyorsa 'aşabilir'; en pahalı kalemleri önerir", () => {
    const cheap = museum(50, 100);
    const pricey = museum(300, 900);
    const s = summarizeBudget([day([cheap, pricey])], city([]), request({ budget: 600 }));
    expect(s.status).toBe("asabilir");
    expect(s.savings.map((x) => x.placeId)).toEqual([pricey.id, cheap.id]);
  });

  it("alt sınır bile aşıyorsa 'aşıyor'", () => {
    const s = summarizeBudget([day([museum(800, 900)])], city([]), request({ budget: 500 }));
    expect(s.status).toBe("asiyor");
  });

  it("otopark yalnızca arabayla ve araba ayağı olan günlere eklenir", () => {
    const c = city([]);
    const carDay = day([museum(0, 0)], [{ mode: "araba", cost: range(20) }]);
    const walkDay = day([museum(0, 0)], [{ mode: "yurume" }]);
    const s = summarizeBudget([carDay, walkDay], c, request({ transport: "araba", budget: 10_000 }));
    expect(s.breakdown.parking).toMatchObject({ min: 200, max: 400 });
    const transit = summarizeBudget([carDay], c, request({ transport: "toplu_tasima", budget: 10_000 }));
    expect(transit.breakdown.parking).toMatchObject({ min: 0, max: 0 });
  });
});

describe("Müzekart", () => {
  const covered = (price: number) => place({ category: "muze", price: range(price), muzekart: true });

  it("kartı olana Müzekart geçen yerler ücretsiz", () => {
    const s = summarizeBudget([day([covered(500), museum(100, 100)])], city([]), request({ hasMuzekart: true, budget: 10_000 }));
    expect(s.breakdown.activities).toMatchObject({ min: 100, max: 100 });
    expect(s.muzekart).toBeUndefined();
  });

  it("biletler kartın fiyatını aşıyorsa kişi sayısıyla tasarrufu önerir", () => {
    // Kişi başı 500 + 150 = 650 TL, kart 200 TL → kişi başı 450, 2 kişi 900 TL
    const s = summarizeBudget([day([covered(500), covered(150)])], city([]), request({ travelers: 2, budget: 10_000 }));
    expect(s.muzekart?.saves).toMatchObject({ min: 900, max: 900 });
    expect(s.muzekart?.places).toHaveLength(2);
    expect(budgetWarnings(s).some((w) => w.message.includes("Müzekart alırsan"))).toBe(true);
  });

  it("biletler kartın fiyatını aşmıyorsa önermez", () => {
    const s = summarizeBudget([day([covered(150)])], city([]), request({ budget: 10_000 }));
    expect(s.muzekart).toBeUndefined();
  });

  it("alt sınır kartı aşmıyorsa (belirsizse) önermez", () => {
    const uncertain = place({ category: "muze", price: range(100, 400), muzekart: true });
    expect(summarizeBudget([day([uncertain])], city([]), request({ budget: 10_000 })).muzekart).toBeUndefined();
  });
});

describe("budgetWarnings", () => {
  it("duruma göre uyarı seviyesi verir", () => {
    const at = (min: number, max: number, budget: number) =>
      budgetWarnings(summarizeBudget([day([museum(min, max)])], city([]), request({ budget })));
    expect(at(0, 100, 1000)).toEqual([]);
    expect(at(0, 900, 1000)[0].level).toBe("bilgi");
    expect(at(500, 1500, 1000)[0].level).toBe("uyari");
    expect(at(1500, 2000, 1000)[0].level).toBe("asim");
  });
});
