import { describe, expect, it } from "vitest";
import { bestFittingLine, chainWays, fitStopsToLine } from "./osm-lines.mjs";

const pt = (lat, lon) => ({ lat, lon });

describe("chainWays", () => {
  it("ters yönlü parçayı çevirip uç uca ekler, sıçramayı ölçer", () => {
    const rel = {
      members: [
        { type: "way", role: "", geometry: [pt(40, 29), pt(40, 29.01)] },
        { type: "way", role: "", geometry: [pt(40, 29.02), pt(40, 29.01)] }, // ters
        { type: "way", role: "platform", geometry: [pt(41, 30), pt(41, 30.1)] }, // atlanır
        { type: "node", role: "stop" },
      ],
    };
    const { line, maxJumpM } = chainWays(rel);
    expect(line.map((p) => p.lon)).toEqual([29, 29.01, 29.02]);
    expect(maxJumpM).toBeLessThan(5);
  });

  it("kopuk parçalar arasındaki sıçramayı raporlar", () => {
    const { maxJumpM } = chainWays({
      members: [
        { type: "way", role: "", geometry: [pt(40, 29), pt(40, 29.01)] },
        { type: "way", role: "", geometry: [pt(40.1, 29.5), pt(40.1, 29.51)] },
      ],
    });
    expect(maxJumpM).toBeGreaterThan(10000);
  });
});

describe("fitStopsToLine / bestFittingLine", () => {
  const line = [
    [40, 29],
    [40, 29.005],
    [40, 29.01],
    [40, 29.015],
    [40, 29.02],
  ];
  const stops = [
    { lat: 40.0003, lng: 29.0 },
    { lat: 40.0002, lng: 29.01 },
    { lat: 40, lng: 29.02 },
  ];

  it("durakları sırayla çizgi noktalarına eşler", () => {
    expect(fitStopsToLine(stops, line).idx).toEqual([0, 2, 4]);
  });

  it("çizgiden uzak durakta null verir", () => {
    expect(fitStopsToLine([...stops, { lat: 40.05, lng: 29.02 }], line)).toBeNull();
  });

  it("ters yöndeki çizgiyi çevirerek oturtur ve en iyi adayı seçer", () => {
    const far = line.map(([la, lo]) => [la + 0.0008, lo]); // ~90 m kuzeyde, uyar ama daha kötü
    const best = bestFittingLine(stops, [far, [...line].reverse()], 120);
    expect(best.line[0]).toEqual([40, 29]);
  });
});
