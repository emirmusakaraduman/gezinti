import { describe, expect, it } from "vitest";
import { toMinutes } from "@/lib/geo";
import type { MealKind, Place } from "@/lib/types";
import { city, place, range } from "@/test/fixtures";
import { assignMeals, DAY_START, estimateLeg, orderDay } from "./route";

const TRAVEL = 15;
const travel = () => TRAVEL;

/** Testin bağımsız kontrolü: sabit yol süresiyle varış saatleri */
function arrivals(order: Place[], roles: Map<string, MealKind>): Map<string, number> {
  const earliest: Record<string, number> = { ogle: toMinutes("11:45"), ara: toMinutes("14:30"), aksam: toMinutes("18:30") };
  const out = new Map<string, number>();
  let clock = toMinutes(DAY_START);
  order.forEach((p, i) => {
    if (i > 0) clock += TRAVEL;
    clock = Math.max(clock, earliest[roles.get(p.id) ?? ""] ?? 0);
    out.set(p.id, clock);
    clock += p.durationMin;
  });
  return out;
}

// Doğu-batı doğrultusunda ~800 m arayla dizilmiş gezi noktaları
const sights = [0, 1, 2, 3].map((i) => place({ name: `Gezi ${i}`, lng: 29 + i * 0.01, durationMin: 60 }));
const breakfast = place({ category: "kafe", tags: ["kahvalti"], durationMin: 30 });
const lunch = place({ category: "yemek", lng: 29.015, durationMin: 60 });
const dinner = place({ category: "yemek", lng: 29.02, durationMin: 60 });
const dessert = place({ category: "kafe", lng: 29.025, durationMin: 30 });

describe("assignMeals", () => {
  it("kahvaltılık, ilk yemek öğle, ikinci yemek akşam, kafe ara öğün", () => {
    const roles = assignMeals([sights[0], breakfast, lunch, dessert, dinner]);
    expect(roles.get(breakfast.id)).toBe("kahvalti");
    expect(roles.get(lunch.id)).toBe("ogle");
    expect(roles.get(dinner.id)).toBe("aksam");
    expect(roles.get(dessert.id)).toBe("ara");
    expect(roles.has(sights[0].id)).toBe(false);
  });
});

describe("orderDay", () => {
  // Öğün türleri listedeki sıraya göre atanır: önce öğle, sonra akşam yemeği
  const all = [lunch, dessert, dinner, ...sights, breakfast];
  const roles = assignMeals(all);
  const order = orderDay(all, travel, roles);
  const at = arrivals(order, roles);

  it("tüm durakları bir kez içerir", () => {
    expect(new Set(order.map((p) => p.id))).toEqual(new Set(all.map((p) => p.id)));
  });

  it("kahvaltı başta, akşam yemeği sonda", () => {
    expect(order[0].id).toBe(breakfast.id);
    expect(order.at(-1)!.id).toBe(dinner.id);
  });

  it("öğle yemeği 11:45-14:00 arasında", () => {
    const t = at.get(lunch.id)!;
    expect(t).toBeGreaterThanOrEqual(toMinutes("11:45"));
    expect(t).toBeLessThanOrEqual(toMinutes("14:00"));
  });

  it("ara öğün öğleden sonra", () => {
    expect(at.get(dessert.id)!).toBeGreaterThanOrEqual(toMinutes("14:30"));
  });

  it("öğün saatini beklemek için gezileri ertelemez", () => {
    // Öğle yemeği yokken ara öğün: gezilerin arasına değil sonuna gelmeli
    const few = [sights[0], sights[1], dessert];
    const r = assignMeals(few);
    expect(orderDay(few, travel, r).at(-1)!.id).toBe(dessert.id);
  });
});

describe("estimateLeg", () => {
  const c = city([]);
  const a = place({ lat: 41.0, lng: 29.0 });
  const near = place({ lat: 41.005, lng: 29.0 }); // ~550 m
  const far = place({ lat: 41.05, lng: 29.0 }); // ~5,5 km

  it("kısa mesafe her modda yürünür ve ücretsizdir", () => {
    for (const mode of ["toplu_tasima", "araba"] as const) {
      const leg = estimateLeg(a, near, mode, c, 2);
      expect(leg.mode).toBe("yurume");
      expect(leg.cost.max).toBe(0);
    }
  });

  it("toplu taşıma ücreti kişi sayısıyla çarpılır", () => {
    const leg = estimateLeg(a, far, "toplu_tasima", c, 3);
    expect(leg.mode).toBe("toplu_tasima");
    expect(leg.cost).toMatchObject({ min: 90, max: 120 });
    expect(leg.estimated).toBe(true);
  });

  it("araba maliyeti mesafeyle orantılı, kişi sayısından bağımsız", () => {
    const one = estimateLeg(a, far, "araba", c, 1);
    const four = estimateLeg(a, far, "araba", c, 4);
    expect(one.mode).toBe("araba");
    expect(one.cost).toEqual(four.cost);
    expect(one.cost.max).toBeGreaterThan(0);
    expect(estimateLeg(a, far, "araba", city([], { carCostPerKm: range(10) }), 1).cost.max).toBeGreaterThan(one.cost.max);
  });
});
