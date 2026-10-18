import { describe, expect, it } from "vitest";
import { haversineM } from "./common.mjs";

describe("haversineM", () => {
  it("lng ve lon alan adlarını eşit sayar", () => {
    const a = { lat: 41, lng: 29 };
    const b = { lat: 41.01, lng: 29.01 };
    const d = haversineM(a, b);
    expect(d).toBeGreaterThan(1300);
    expect(d).toBeLessThan(1500);
    expect(haversineM({ lat: 41, lon: 29 }, { lat: 41.01, lon: 29.01 })).toBeCloseTo(d, 6);
    expect(haversineM(a, { lat: 41.01, lon: 29.01 })).toBeCloseTo(d, 6);
  });

  it("aynı noktada 0 verir", () => {
    expect(haversineM({ lat: 40, lng: 30 }, { lat: 40, lng: 30 })).toBe(0);
  });
});
