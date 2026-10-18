import { describe, expect, it } from "vitest";
import { decode, fixMojibake, foldTurkish, parseCoord, parseOpeningHours, parseTime, slug } from "./text.mjs";

describe("fixMojibake", () => {
  it("çift UTF-8 kodlanmış Türkçeyi düzeltir (İETT hat adları)", () => {
    expect(fixMojibake("KADIKÃ–Y - KÄ°RAZLITEPE")).toBe("KADIKÖY - KİRAZLITEPE");
  });

  it("düzgün metne dokunmaz", () => {
    for (const s of ["Kadıköy", "ŞİŞLİ", "Ümraniye", "Taksim"]) expect(fixMojibake(s)).toBe(s);
  });
});

describe("decode", () => {
  it("UTF-8'i okur, değilse Windows-1254 sayar", () => {
    expect(decode(Buffer.from("Kadıköy", "utf8"))).toBe("Kadıköy");
    // Windows-1254: Ş=0xDE, ı=0xFD
    expect(decode(Buffer.from([0xde, 0x65, 0x68, 0xfd, 0x72]))).toBe("Şehır");
  });
});

describe("parseCoord", () => {
  it("normal koordinatı okur", () => {
    expect(parseCoord("41.0191")).toBe(41.0191);
    expect(parseCoord("28,97")).toBe(28.97);
  });

  it("binlik ayracıyla bozulmuş İETT koordinatını kurtarır", () => {
    expect(parseCoord("410.191.700.005.564")).toBeCloseTo(41.0191700005564, 10);
    expect(parseCoord("286.843.529.999.755")).toBeCloseTo(28.6843529999755, 10);
  });

  it("boşsa NaN", () => {
    expect(parseCoord("")).toBeNaN();
  });
});

describe("parseTime", () => {
  it("24 saati aşan GTFS saatlerini kabul eder", () => {
    expect(parseTime("06:40:00")).toBe(6 * 3600 + 40 * 60);
    expect(parseTime("24:40")).toBe(24 * 3600 + 40 * 60);
    expect(parseTime("")).toBeNull();
  });
});

describe("foldTurkish", () => {
  const matches = (pattern, name) => new RegExp(foldTurkish(pattern), "i").test(name);

  it("ASCII yazılmış adları eşler", () => {
    expect(matches("Boğaziçi Lokantası", "Bogazici Lokantasi")).toBe(true);
    expect(matches("Hacı Abdullah", "HACI ABDULLAH")).toBe(true);
    expect(matches("Dostlar Fırını", "dostlar firini")).toBe(true);
  });

  it("karakter sınıflarının içine dokunmaz", () => {
    expect(foldTurkish("F[ıi]r")).toBe("F[ıi]r");
  });

  it("farklı adları eşlemez", () => {
    expect(matches("^Kanaat", "Kanat Lokantası")).toBe(false);
  });
});

describe("parseOpeningHours", () => {
  it("her gün açık", () => {
    expect(parseOpeningHours("Mo-Su 09:00-19:00")).toEqual({ open: "09:00", close: "19:00", closedDays: [] });
  });

  it("kapalı günü çıkarır", () => {
    expect(parseOpeningHours("Tu-Su 09:00-17:00; Mo off")).toEqual({ open: "09:00", close: "17:00", closedDays: [1] });
  });

  it("farklı saatli günleri en geniş aralıkta birleştirir", () => {
    expect(parseOpeningHours("Mo-Fr 08:00-18:00; Sa 10:00-16:00")).toEqual({
      open: "08:00",
      close: "18:00",
      closedDays: [0],
    });
  });

  it("hafta sonunu saran aralık (Fr-Mo)", () => {
    expect(parseOpeningHours("Fr-Mo 10:00-20:00")?.closedDays).toEqual([2, 3, 4]);
  });

  it("gece yarısı kapanışı ve 24/7", () => {
    expect(parseOpeningHours("Mo-Su 10:00-00:00")?.close).toBe("23:59");
    expect(parseOpeningHours("24/7")).toBeNull();
  });

  it("anlayamadığı biçimde null döner (yanlış kapalı gün üretmez)", () => {
    expect(parseOpeningHours("Mo-Fr 09:00-12:00,13:00-18:00")).toBeNull();
    expect(parseOpeningHours("sunrise-sunset")).toBeNull();
  });
});

describe("slug", () => {
  it("Türkçe adlardan kimlik üretir", () => {
    expect(slug("Tarihi Sultanahmet Köftecisi Selim Usta")).toBe("tarihi-sultanahmet-koftecisi-selim-usta");
    expect(slug("Çırağan Sarayı")).toBe("ciragan-sarayi");
  });
});
