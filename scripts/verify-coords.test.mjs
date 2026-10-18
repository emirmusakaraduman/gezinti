import { describe, expect, it } from "vitest";
import { nameMatches, parseCurated } from "./verify-coords.mjs";

describe("nameMatches", () => {
  it("Türkçe harf ve büyük/küçük farkını yok sayar", () => {
    expect(nameMatches("Hamamönü", "HAMAMÖNÜ")).toBe(true);
    expect(nameMatches("Rahmi M. Koç Müzesi", "Rahmi M. Koç Müzesi Ankara")).toBe(true);
    expect(nameMatches("Kapalıçarşı", "Kapalicarsi")).toBe(true);
  });

  it("alakasız adları eşleştirmez", () => {
    expect(nameMatches("Atakule", "Kızılay Meydanı")).toBe(false);
  });
});

describe("parseCurated", () => {
  const src = `const experiences: Place[] = [
  {
    id: "ank-a",
    name: "Alfa",
    lat: 39.9346,
    lng: 32.864,
    source: "kurator",
  },
  {
    id: "ank-b",
    name: "Beta",
    lat: 39.1,
    lng: 32.2,
    source: "populer",
  },
];`;
  it("yalnızca kurator kayıtlarını okur", () => {
    expect(parseCurated(src)).toEqual([{ id: "ank-a", name: "Alfa", lat: 39.9346, lng: 32.864 }]);
  });
});

describe("nameMatches: genel sözcükler", () => {
  it("yalnızca 'cadde/çarşı' gibi ortak sözcükle eşleşmez", () => {
    expect(nameMatches("İstiklal Caddesi", "Yeni Çarşı Caddesi")).toBe(false);
    expect(nameMatches("İstiklal Caddesi", "İstiklal Cd.")).toBe(true);
  });
});
