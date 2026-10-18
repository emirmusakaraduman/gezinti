import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildEgoGtfs, decodeEntities, parseLineOptions, parseLinePage, stationKey } from "./ego.mjs";

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

describe("raylı hat: ara istasyondan başlayan seferler", () => {
  const html = `<table><tr><td class="key">Hat No</td><td class="sep">:</td><td>M1-D</td></tr></table>
<table class="hs-table"><tbody><tr>
<td class="hs-times">06:00 -<br />06:10 -<br />06:00 ULUS METRO İSTASYONUNDAN BAŞLAYACAK<br />06:20 -<br /></td>
<td class="hs-times"></td><td class="hs-times"></td></tr></tbody></table>
<table class="route-table"><tbody>
<tr><td>1</td><td>M33</td><td>KORU İSTASYONU</td><td>-</td></tr>
<tr><td>2</td><td>M3</td><td>ULUS İSTASYONU</td><td>-</td></tr>
<tr><td>3</td><td>M12</td><td>BATIKENT İSTASYONU</td><td>-</td></tr>
</tbody></table>`;
  const line = parseLinePage(html, "M1-D");

  it("notlu saati ayrı tutar, düz saatlere katmaz", () => {
    expect(line.times.wd).toEqual([6 * 3600, 6 * 3600 + 600, 6 * 3600 + 1200]);
    expect(line.partial.wd).toEqual([{ sec: 6 * 3600, from: "ULUS METRO İSTASYONU" }]);
    expect(line.stops.map((s) => s.no)).toEqual(["M33", "M3", "M12"]);
  });

  it("seferi o istasyondan başlatır; rota adından yön ekini atar", () => {
    const pos = new Map([
      ["M33", { lat: 39.88, lng: 32.7 }],
      ["M3", { lat: 39.94, lng: 32.85 }],
      ["M12", { lat: 39.97, lng: 32.73 }],
    ]);
    const { files } = buildEgoGtfs([{ ...line, type: 1 }], pos);
    const rows = files["stop_times.txt"].trim().split("\n").slice(1);
    const fromUlus = rows.filter((r) => r.startsWith("M1-D-WD-21600-1,"));
    expect(fromUlus.map((r) => r.split(",")[3])).toEqual(["M3", "M12"]);
    expect(fromUlus[0].split(",")[1]).toBe("06:00:00");
    expect(files["routes.txt"]).toContain("M1-D,1,M1,M1: ");
  });
});

describe("stationKey", () => {
  it("istasyon/metro sözcüklerini ve tek haneli peron numarasını atar", () => {
    expect(stationKey("ŞEHİTLER İSTASYONU 1")).toBe("sehitler");
    expect(stationKey("ÜMİTKÖY METRO İSTASYONU")).toBe("umitkoy");
    expect(stationKey("Ümitköy")).toBe("umitkoy");
  });
});
