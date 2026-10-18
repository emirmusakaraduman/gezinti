import { describe, expect, it } from "vitest";
import { buildMetroGtfs, fold, orderForDirection, timesToSeconds } from "./metroistanbul.mjs";

const st = (Id, Name, Order, lat, lng, Description = Name) => ({
  Id,
  Name,
  Description,
  Order,
  DetailInfo: { Latitude: String(lat), Longitude: String(lng) },
});

const M2 = [
  st(20, "YENIKAPI", 1, 41.0, 28.95, "Yenikapı"),
  st(21, "VEZNECILER", 2, 41.01, 28.96, "Vezneciler-İstanbul Ü."),
  st(22, "HACIOSMAN", 3, 41.1, 29.03, "Hacıosman"),
];

describe("fold", () => {
  it("Türkçe harfleri ve işaretleri atar", () => {
    expect(fold("Atatürk Havalimanı")).toBe("ataturk havalimani");
    expect(fold("HACIOSMAN")).toBe("haciosman");
  });
});

describe("timesToSeconds", () => {
  it("gece yarısını geçince 24 saat ekler", () => {
    expect(timesToSeconds(["23:45", "00:00", "00:20"])).toEqual([23 * 3600 + 45 * 60, 24 * 3600, 24 * 3600 + 20 * 60]);
  });

  it("bozuk girdiyi atlar", () => {
    expect(timesToSeconds(["10:07", "x", "10:14"])).toEqual([10 * 3600 + 7 * 60, 10 * 3600 + 14 * 60]);
  });
});

describe("orderForDirection", () => {
  it("yön adına göre istasyon sırasını çevirir", () => {
    expect(orderForDirection(M2, "Yenikapı->Hacıosman").map((s) => s.Id)).toEqual([20, 21, 22]);
    expect(orderForDirection(M2, "Hacıosman->Yenikapı").map((s) => s.Id)).toEqual([22, 21, 20]);
  });

  it("hattın yalnızca bir kesimini kapsayan yönü o kesimle sınırlar", () => {
    expect(orderForDirection(M2, "Yenikapı->Vezneciler").map((s) => s.Id)).toEqual([20, 21]);
    expect(orderForDirection(M2, "Hacıosman->Vezneciler").map((s) => s.Id)).toEqual([22, 21]);
  });

  it("eşleşmeyen yön için null verir", () => {
    expect(orderForDirection(M2, "Kadıköy->Tavşantepe")).toBeNull();
  });
});

describe("buildMetroGtfs", () => {
  const model = {
    lines: [{ name: "M2", type: 1 }],
    directions: [
      { line: "M2", id: 34, name: "Yenikapı->Hacıosman" },
      { line: "M2", id: 35, name: "Hacıosman->Yenikapı" },
    ],
    stationsByLine: { M2: M2 },
    departures: (id, day) => (day === "wd" ? [6 * 3600, 6 * 3600 + 420] : day === "sun" && id === 34 ? [8 * 3600] : []),
    travelSec: (id) => (id === 34 ? 1200 : null),
  };

  it("her yön ve gün tipi için sefer üretir, süreyi mesafeyle dağıtır", () => {
    const { files, report } = buildMetroGtfs(model);
    const rows = files["stop_times.txt"].trim().split("\n").slice(1);
    const first = rows.filter((r) => r.startsWith("M2-34-WD-21600,"));
    expect(first.map((r) => r.split(",")[3])).toEqual(["20", "21", "22"]);
    expect(first[0].split(",")[1]).toBe("06:00:00");
    // 20 dk toplam; son istasyona tam süre
    expect(first[2].split(",")[1]).toBe("06:20:00");
    // 2 yön × 2 hafta içi + pazar yalnızca 34'te 1 sefer
    expect(files["trips.txt"].trim().split("\n")).toHaveLength(1 + 2 + 2 + 1);
    expect(report).toContain("M2");
  });

  it("değiştirilecek hat adlarını replaces.json'a yazar; seferi olmayan hattı atlar", () => {
    const empty = buildMetroGtfs({ ...model, lines: [{ name: "M2", type: 1 }], departures: () => [] });
    expect(JSON.parse(empty.files["replaces.json"])).toEqual([]);
    expect(empty.report).toContain("sefer yok");
    expect(JSON.parse(buildMetroGtfs(model).files["replaces.json"])).toEqual(["M2"]);
  });

  it("kesimler arasında boşluk olan hattı değiştirmez (eski veri korunur)", () => {
    const four = [...M2, st(23, "SON", 4, 41.2, 29.1, "Son")];
    const partial = buildMetroGtfs({
      ...model,
      stationsByLine: { M2: four },
      directions: [
        { line: "M2", id: 34, name: "Yenikapı->Vezneciler" }, // 20-21
        { line: "M2", id: 36, name: "Hacıosman->Son" }, // 22-23; 21-22 kapsanmıyor
      ],
      departures: () => [6 * 3600],
    });
    expect(JSON.parse(partial.files["replaces.json"])).toEqual([]);
    expect(partial.report).toContain("eksik kesim");
    expect(partial.report).toContain("Vezneciler-İstanbul Ü.-Hacıosman");
  });

  it("kesimler komşu çiftleri eksiksiz kapsıyorsa hat değiştirilir", () => {
    const whole = buildMetroGtfs({
      ...model,
      directions: [
        { line: "M2", id: 34, name: "Yenikapı->Vezneciler" },
        { line: "M2", id: 36, name: "Vezneciler->Hacıosman" },
      ],
      departures: () => [6 * 3600],
    });
    expect(JSON.parse(whole.files["replaces.json"])).toEqual(["M2"]);
  });

  it("koordinatsız istasyonu dışarıda bırakır", () => {
    const noCoord = [...M2, { ...st(23, "KOORDINATSIZ", 4, 0, 0), DetailInfo: {} }];
    const { files } = buildMetroGtfs({ ...model, stationsByLine: { M2: noCoord } });
    expect(files["stops.txt"]).not.toContain("KOORDINATSIZ");
  });
});
