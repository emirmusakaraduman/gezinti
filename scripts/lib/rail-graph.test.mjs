import { describe, expect, it } from "vitest";
import { createRailGraph, railLine, shortestPath, snap } from "./rail-graph.mjs";

// İki paralel hat arasında bağ olmayan küçük ağ: doğu-batı çizgisi ve kıvrımlı kol
const ways = [
  [40, 29, 40, 29.01, 40, 29.02],
  [40, 29.02, 40.005, 29.025, 40, 29.03], // kıvrım
];

describe("raylı ağ", () => {
  const g = createRailGraph(ways);

  it("ortak düğümlerden yol bulur ve kıvrımı izler", () => {
    const a = snap(g, { lat: 40, lng: 29 }, 100);
    const b = snap(g, { lat: 40, lng: 29.03 }, 100);
    const path = shortestPath(g, a, b, 20000);
    expect(path).not.toBeNull();
    expect(path.map((i) => [g.nodes[i].lat, g.nodes[i].lng])).toContainEqual([40.005, 29.025]);
  });

  it("bağlantısız veya aşırı dolambaçlı yolda vazgeçer", () => {
    const g2 = createRailGraph([...ways, [41, 29, 41, 29.01]]);
    const a = snap(g2, { lat: 40, lng: 29 }, 100);
    const far = snap(g2, { lat: 41, lng: 29.01 }, 100);
    expect(shortestPath(g2, a, far, 1e6)).toBeNull();
    const b = snap(g, { lat: 40, lng: 29.03 }, 100);
    expect(shortestPath(g, a, b, 500)).toBeNull();
  });

  it("railLine: ağa oturmayan durakta null verir", () => {
    expect(railLine(g, [{ lat: 40, lng: 29 }, { lat: 45, lng: 29 }])).toBeNull();
    const line = railLine(g, [{ lat: 40, lng: 29 }, { lat: 40, lng: 29.02 }, { lat: 40, lng: 29.03 }]);
    expect(line[0]).toEqual([40, 29]);
    expect(line.at(-1)).toEqual([40, 29.03]);
  });
});
