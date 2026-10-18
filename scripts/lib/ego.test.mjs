import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildEgoGtfs, decodeEntities, parseLineOptions, parseLinePage } from "./ego.mjs";

const page = readFileSync(new URL("../../test/ego-line.fixture.html", import.meta.url), "utf8");

describe("decodeEntities", () => {
  it("sayısal ve adlandırılmış karakterleri çözer", () => {
    expect(decodeEntities("G&#214;LBA&#350;I &amp; Bah&#231;e")).toBe("GÖLBAŞI & Bahçe");
  });
});

describe("parseLineOptions", () => {
  it("yalnızca otobüs listesindeki hat kodlarını verir", () => {
    const html = `<select id="hat_liste_otobus"><option value="0">OTOBÜS</option><option value="101"> (101 ) - A</option><option value="105-1"> (105-1 ) - B</option></select><select id="x"><option value="M1">M1</option></select>`;
    expect(parseLineOptions(html)).toEqual(["101", "105-1"]);
  });
});

describe("parseLinePage", () => {
  const line = parseLinePage(page, "105-1");

  it("hat bilgilerini okur", () => {
    expect(line.name).toBe("GÖLBAŞI-KIZILAY-ULUS");
    expect(line.km).toBe(29);
    expect(line.durationMin).toBe(55);
  });

  it("hafta içi saatleri saniye olarak okur, boş günleri boş bırakır", () => {
    expect(line.times.wd).toHaveLength(12);
    expect(line.times.wd[0]).toBe(6 * 3600 + 8 * 60);
    expect(line.times.sat).toEqual([]);
    expect(line.times.sun).toEqual([]);
  });

  it("durakları sırayla ve numarasıyla okur", () => {
    expect(line.stops[0]).toEqual({ no: "14043", name: "GÖLBAŞI HAREKET NOKTASI" });
    expect(line.stops.length).toBeGreaterThanOrEqual(4);
  });

  it("durağı olmayan sayfa için null verir", () => {
    expect(parseLinePage("<html></html>", "x")).toBeNull();
  });
});

describe("buildEgoGtfs", () => {
  const line = {
    code: "9",
    name: "A-B",
    to: "B",
    durationMin: 10,
    times: { wd: [8 * 3600], sat: [], sun: [9 * 3600] },
    stops: [
      { no: "1", name: "Bir" },
      { no: "2", name: "Yok (OSM'de yok)" },
      { no: "3", name: "Üç" },
    ],
  };
  const osm = new Map([
    ["1", { lat: 39.9, lng: 32.8 }],
    ["3", { lat: 39.95, lng: 32.8 }],
  ]);

  it("OSM'de olmayan durağı çıkarır, süreyi baştan sona dağıtır", () => {
    const { files, report } = buildEgoGtfs([line], osm);
    const rows = files["stop_times.txt"].trim().split("\n").slice(1);
    // hafta içi 1 + pazar 1 sefer × 2 durak
    expect(rows).toHaveLength(4);
    expect(rows[0]).toBe("9-WD-28800,08:00:00,08:00:00,1,1");
    expect(rows[1]).toBe("9-WD-28800,08:10:00,08:10:00,3,2");
    expect(files["stops.txt"]).not.toContain("Yok");
    expect(report).toContain("2/3");
  });

  it("saati olmayan veya durakları yetersiz hattı atlar", () => {
    const { files } = buildEgoGtfs([{ ...line, times: { wd: [], sat: [], sun: [] } }, { ...line, code: "8" }], new Map([["1", osm.get("1")]]));
    expect(files["routes.txt"].trim().split("\n")).toHaveLength(1);
  });
});
