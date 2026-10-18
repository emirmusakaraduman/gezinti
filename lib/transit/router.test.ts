import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toMinutes } from "@/lib/geo";
import { writeFixture, type FixtureTrip } from "@/test/transit-fixture";
import { TransitRouter, type TransitJourney } from "./router";

// Kuzeye doğru ~1,1 km arayla dört durak; başlangıç S0'da, hedef S3'te.
// Erişim yarıçapı 800 m olduğundan başlangıçtan yalnızca S0'a, hedefe
// yalnızca S3'ten yürünebilir.
const STOPS = [0, 1, 2, 3].map((i) => ({ name: `S${i}`, lat: 41 + i * 0.01, lng: 29 }));
const FROM = { lat: STOPS[0].lat, lng: STOPS[0].lng };
const TO = { lat: STOPS[3].lat, lng: STOPS[3].lng };
const TEN = 10 * 3600;
const TUESDAY = 2;

const router = (trips: FixtureTrip[]) => {
  const { binPath, metaPath } = writeFixture(STOPS, trips);
  return new TransitRouter(binPath, metaPath);
};

const direct = (arrive: string, dayMask?: number): FixtureTrip => ({
  route: "A",
  stops: [
    { stop: 0, time: "10:05" },
    { stop: 3, time: arrive },
  ],
  dayMask,
});
const firstLeg: FixtureTrip = {
  route: "B",
  stops: [
    { stop: 0, time: "10:05" },
    { stop: 1, time: "10:08" },
  ],
};
const secondLeg = (depart: string, arrive = "10:20"): FixtureTrip => ({
  route: "C",
  stops: [
    { stop: 1, time: depart },
    { stop: 3, time: arrive },
  ],
});

const lines = (j: TransitJourney | null) => j?.steps.filter((s) => s.kind === "binis").map((s) => s.line);
const arrival = (j: TransitJourney | null) => (j ? j.arriveSec / 60 : NaN);

describe("TransitRouter.plan", () => {
  it("aktarmalı daha hızlı yolu bulur", () => {
    const j = router([direct("10:45"), firstLeg, secondLeg("10:10")]).plan(FROM, TO, TEN, TUESDAY);
    expect(lines(j)).toEqual(["B", "C"]);
    expect(j!.rides).toBe(2);
    expect(arrival(j)).toBe(toMinutes("10:20"));
  });

  it("aktarma için 2 dakikadan az kalıyorsa o aktarmayı kullanmaz", () => {
    // B 10:08'de varıyor, C 10:09'da kalkıyor: yetişilemez
    const j = router([direct("10:45"), firstLeg, secondLeg("10:09", "10:19")]).plan(FROM, TO, TEN, TUESDAY);
    expect(lines(j)).toEqual(["A"]);
  });

  it("birkaç dakika kazandıran aktarma yerine tek binişi tercih eder (biniş cezası)", () => {
    // Tek biniş 10:24, aktarmalı 10:20: 4 dakika için ikinci biniş değmez
    const j = router([direct("10:24"), firstLeg, secondLeg("10:10")]).plan(FROM, TO, TEN, TUESDAY);
    expect(lines(j)).toEqual(["A"]);
    expect(arrival(j)).toBe(toMinutes("10:24"));
  });

  it("o gün çalışmayan seferleri kullanmaz", () => {
    const sundayOnly = 0b0000001;
    const r = router([direct("10:30", sundayOnly)]);
    expect(r.plan(FROM, TO, TEN, 0)).not.toBeNull();
    expect(r.plan(FROM, TO, TEN, TUESDAY)).toBeNull();
  });

  it("kalkış saatinden önceki seferleri kullanmaz", () => {
    expect(router([direct("10:30")]).plan(FROM, TO, TEN + 6 * 60, TUESDAY)).toBeNull();
  });

  it("yürümek daha iyiyse yolculuk önermez", () => {
    const near = { lat: FROM.lat + 0.003, lng: FROM.lng }; // ~330 m
    expect(router([direct("10:45")]).plan(FROM, near, TEN, TUESDAY)).toBeNull();
  });

  it("adım saatleri tutarlı: hiçbir adım öncekinin bitişinden önce başlamaz", () => {
    const j = router([direct("10:45"), firstLeg, secondLeg("10:10")]).plan(FROM, TO, TEN, TUESDAY)!;
    const mins = (t: string) => toMinutes(t);
    for (let i = 1; i < j.steps.length; i++) {
      expect(mins(j.steps[i].depart)).toBeGreaterThanOrEqual(mins(j.steps[i - 1].arrive));
    }
  });
});

// Gerçek İstanbul verisiyle uçtan uca (npm run gtfs:build ile üretilmişse)
const BUILD = path.join(process.cwd(), "data", "gtfs", "build");
const hasIstanbul = existsSync(path.join(BUILD, "istanbul.bin"));

describe.skipIf(!hasIstanbul)("İstanbul verisiyle", () => {
  it("Sultanahmet'ten Taksim'e tutarlı bir yolculuk bulur", () => {
    const r = new TransitRouter(path.join(BUILD, "istanbul.bin"), path.join(BUILD, "istanbul.meta.json"));
    const j = r.plan({ lat: 41.0054, lng: 28.9768 }, { lat: 41.0335, lng: 28.9779 }, TEN, TUESDAY);
    expect(j).not.toBeNull();
    expect(j!.rides).toBeGreaterThanOrEqual(1);
    expect(j!.arriveSec).toBeGreaterThan(TEN);
    // Bir saatten kısa sürmeli (gerçekte ~30 dk)
    expect(j!.arriveSec - TEN).toBeLessThan(3600);
  });
});
