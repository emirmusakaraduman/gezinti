import { describe, expect, it } from "vitest";
import { addDays, addRange, formatRange, haversineKm, toHHMM, toMinutes, weekday } from "./geo";
import { range } from "@/test/fixtures";

describe("toHHMM", () => {
  it("dakikayı saate çevirir", () => {
    expect(toHHMM(570)).toBe("09:30");
    expect(toHHMM(0)).toBe("00:00");
  });

  it("59,6 dakikayı '10:60' değil '11:00' yazar (yuvarlama hatası)", () => {
    expect(toHHMM(659.6)).toBe("11:00");
    expect(toHHMM(599.5)).toBe("10:00");
  });

  it("gece yarısını aşınca başa sarar", () => {
    expect(toHHMM(24 * 60 + 15)).toBe("00:15");
  });

  it("toMinutes ile tersine çevrilebilir", () => {
    for (const t of ["00:00", "09:05", "12:45", "23:59"]) expect(toHHMM(toMinutes(t))).toBe(t);
  });
});

describe("tarih yardımcıları", () => {
  it("ay ve yıl sınırını aşarak gün ekler", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("haftanın gününü verir (0 = Pazar)", () => {
    expect(weekday("2026-10-20")).toBe(2); // Salı
    expect(weekday("2026-10-25")).toBe(0); // Pazar
  });
});

describe("fiyat aralıkları", () => {
  it("biri tahminiyse toplam da tahmini olur", () => {
    const net = { ...range(100), confidence: "net" as const };
    expect(addRange(net, net).confidence).toBe("net");
    expect(addRange(net, range(50, 80))).toMatchObject({ min: 150, max: 180, confidence: "tahmini" });
  });

  it("biçimler", () => {
    expect(formatRange(range(0))).toBe("Ücretsiz");
    expect(formatRange(range(250))).toBe("250 TL");
    expect(formatRange(range(1500, 3000))).toBe("1.500–3.000 TL");
  });
});

describe("haversineKm", () => {
  it("bilinen bir mesafeyi yaklaşık verir", () => {
    // Ayasofya – Galata Kulesi kuş uçuşu ~1,9 km
    const km = haversineKm({ lat: 41.0086, lng: 28.9802 }, { lat: 41.0256, lng: 28.9742 });
    expect(km).toBeGreaterThan(1.8);
    expect(km).toBeLessThan(2.0);
  });
});
