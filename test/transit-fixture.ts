/**
 * Yönlendirici testleri için küçük yapay GTFS ağı. scripts/build-gtfs.mjs'in
 * ürettiği ikili biçimi (meta.json + .bin, 4 bayta hizalı tipli diziler)
 * aynen yazar.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface FixtureStop {
  name: string;
  lat: number;
  lng: number;
}

export interface FixtureTrip {
  route: string;
  /** Ardışık durak indeksleri ve saatleri ("HH:MM") */
  stops: { stop: number; time: string }[];
  /** Bit 0 = Pazar; varsayılan her gün */
  dayMask?: number;
}

const sec = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 3600 + m * 60;
};

export function writeFixture(stops: FixtureStop[], trips: FixtureTrip[]) {
  const routeNames = [...new Set(trips.map((t) => t.route))];
  const conns: number[][] = [];
  const patStart = [0];
  const patStops: number[] = [];
  trips.forEach((t, ti) => {
    for (let i = 0; i + 1 < t.stops.length; i++) {
      const a = t.stops[i];
      const b = t.stops[i + 1];
      conns.push([a.stop, b.stop, sec(a.time), sec(b.time), ti, t.dayMask ?? 0b1111111]);
    }
    patStops.push(...t.stops.map((s) => s.stop));
    patStart.push(patStops.length);
  });
  conns.sort((x, y) => x[2] - y[2]);
  const col = (i: number) => conns.map((c) => c[i]);

  const arrays: Record<string, Int32Array | Uint16Array | Uint8Array> = {
    connDepTime: Int32Array.from(col(2)),
    connArrTime: Int32Array.from(col(3)),
    connTrip: Int32Array.from(col(4)),
    tripRoute: Int32Array.from(trips.map((t) => routeNames.indexOf(t.route))),
    tripPattern: Int32Array.from(trips.map((_, i) => i)),
    patStart: Int32Array.from(patStart),
    patStops: Int32Array.from(patStops),
    patStopShapePt: new Int32Array(patStops.length).fill(-1),
    shapeLat: new Int32Array(0),
    shapeLng: new Int32Array(0),
    // Yürüme aktarması yok
    footStart: new Int32Array(stops.length + 1),
    footTo: new Int32Array(0),
    footDur: new Int32Array(0),
    connDepStop: Uint16Array.from(col(0)),
    connArrStop: Uint16Array.from(col(1)),
    connDayMask: Uint8Array.from(col(5)),
  };

  const layout: Record<string, { type: string; offset: number; length: number }> = {};
  let offset = 0;
  for (const [name, arr] of Object.entries(arrays)) {
    layout[name] = { type: arr.constructor.name, offset, length: arr.length };
    offset += Math.ceil(arr.byteLength / 4) * 4;
  }
  const bin = Buffer.alloc(offset);
  for (const [name, arr] of Object.entries(arrays)) {
    Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(bin, layout[name].offset);
  }

  const dir = mkdtempSync(path.join(tmpdir(), "gezinti-gtfs-"));
  const binPath = path.join(dir, "test.bin");
  const metaPath = path.join(dir, "test.meta.json");
  writeFileSync(binPath, bin);
  writeFileSync(
    metaPath,
    JSON.stringify({
      version: 2,
      builtAt: "test",
      source: "test",
      layout,
      stops: { name: stops.map((s) => s.name), lat: stops.map((s) => s.lat), lng: stops.map((s) => s.lng) },
      routes: routeNames.map((name) => ({ name, longName: name, type: 3, agency: "" })),
    }),
  );
  return { binPath, metaPath };
}
