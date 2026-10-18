import { describe, expect, it } from "vitest";
import type { PlanEdit } from "@/lib/types";
import { city, hoursFn, place, request } from "@/test/fixtures";
import { applyEdit, EditError } from "./editor";
import { assignMeals } from "./route";

const pop = (score: number) => ({ popularity: { views: 0, sitelinks: 0, score } });

// Test günü 2026-10-20 Salı (weekday 2)
const TUESDAY = 2;

const museumA = place({ name: "Müze A", category: "muze", ...pop(6) });
const museumNear = place({ name: "Yakın müze", category: "muze", lat: 41.002, ...pop(5) });
const museumFar = place({ name: "Uzak müze", category: "muze", lat: 41.2, ...pop(7) });
const museumClosed = place({ name: "Salı kapalı", category: "muze", lat: 41.001, hours: hoursFn([TUESDAY]), ...pop(8) });
const mosque = place({ name: "Cami", category: "tarih", ...pop(6) });
const lunch = place({ name: "Öğle", category: "yemek" });
const dinner = place({ name: "Akşam", category: "yemek" });
const otherFood = place({ name: "Başka lokanta", category: "yemek", lat: 41.001 });

const c = city([museumA, museumNear, museumFar, museumClosed, mosque, lunch, dinner, otherFood]);

const edit = (overrides: Partial<PlanEdit>): PlanEdit => ({
  days: [[museumA.id, lunch.id, mosque.id, dinner.id]],
  action: "cikar",
  placeId: museumA.id,
  day: 1,
  ...overrides,
});

describe("applyEdit: çıkar", () => {
  it("yalnızca o durağı çıkarır", () => {
    const r = applyEdit(c, request(), edit({}));
    expect(r.days).toEqual([[lunch.id, mosque.id, dinner.id]]);
    expect(r.message).toContain("Müze A");
  });

  it("planda olmayan mekan için hata verir", () => {
    expect(() => applyEdit(c, request(), edit({ placeId: museumNear.id }))).toThrow(EditError);
    expect(() => applyEdit(c, request(), edit({ day: 2 }))).toThrow(EditError);
  });
});

describe("applyEdit: değiştir", () => {
  it("aynı kategoriden, o gün açık, popülerlik ve yakınlıkça en iyisini seçer", () => {
    const r = applyEdit(c, request(), edit({ action: "degistir" }));
    // Salı kapalı olan daha popüler müze ve 22 km uzaktaki müze yerine yakın müze
    expect(r.days[0]).toContain(museumNear.id);
    expect(r.days[0]).not.toContain(museumClosed.id);
    expect(r.days[0]).not.toContain(museumFar.id);
    expect(r.message).toBe("Müze A yerine Yakın müze eklendi.");
  });

  it("yerine geleni aynı sıraya koyar", () => {
    const r = applyEdit(c, request(), edit({ action: "degistir" }));
    expect(r.days[0][0]).toBe(museumNear.id);
  });

  it("öğle yemeği değişince akşam yemeği akşam kalır (regresyon)", () => {
    const r = applyEdit(c, request(), edit({ action: "degistir", placeId: lunch.id }));
    const byId = new Map(c.places.map((p) => [p.id, p]));
    const roles = assignMeals(r.days[0].map((id) => byId.get(id)!));
    expect(roles.get(otherFood.id)).toBe("ogle");
    expect(roles.get(dinner.id)).toBe("aksam");
  });

  it("yeme-içme yerine gezi yeri koymaz; planda olanı tekrar eklemez", () => {
    const r = applyEdit(c, request(), edit({ action: "degistir", placeId: lunch.id }));
    expect(r.days[0].filter((id) => id === dinner.id)).toHaveLength(1);
    expect(r.days[0]).toContain(otherFood.id);
  });

  it("alternatif yoksa çıkarır ve bunu söyler", () => {
    const solo = city([museumA]);
    const r = applyEdit(solo, request(), edit({ days: [[museumA.id]], action: "degistir" }));
    expect(r.days).toEqual([[]]);
    expect(r.message).toContain("alternatif bulunamadı");
  });
});
