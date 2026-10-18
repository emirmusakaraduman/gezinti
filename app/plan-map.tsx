"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap, Marker, StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { dayColor } from "@/lib/colors";
import { formatRange } from "@/lib/geo";
import type { DayPlan } from "@/lib/types";

const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> katkıcıları',
    },
  },
  // Zemin harita siyah-beyaz; renkli yalnızca rota çizgileri ve gün işaretçileri
  layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -1, "raster-contrast": 0.15 } }],
};

const ROUTE_SOURCE = "route";

/** Çizgi stili: araçla gerçek yol, yürüme, ya da yaklaşık güzergah */
type LineStyle = "ride" | "walk" | "approx";

function feature(coordinates: [number, number][], color: string, style: LineStyle): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: "Feature", properties: { color, style }, geometry: { type: "LineString", coordinates } };
}

/**
 * Her ayak ayrı çizgi; toplu taşıma ayaklarında her adım (yürüme, biniş)
 * ayrı çizilir. Gerçek geometri yoksa iki nokta arası düz çizgi.
 */
function routeGeoJSON(days: DayPlan[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: days.flatMap((d) =>
      d.legs.flatMap((leg, i) => {
        const color = dayColor(d.day);
        if (leg.transit) {
          return leg.transit.map((step) =>
            feature(step.geometry, color, step.kind === "yurume" ? "walk" : step.geometryExact ? "ride" : "approx"),
          );
        }
        const from = d.stops[i].place;
        const to = d.stops[i + 1].place;
        if (!leg.geometry) {
          return [feature([[from.lng, from.lat], [to.lng, to.lat]], color, "approx")];
        }
        return [feature(leg.geometry, color, leg.mode === "yurume" ? "walk" : "ride")];
      }),
    ),
  };
}

/**
 * MapLibre konumlandırmayı dış öğenin transform'u ile yapar; animasyon bu yüzden iç
 * öğede. delay, işaretçilerin sırayla düşmesi içindir.
 */
function markerElement(label: string, color: string, delayMs: number): HTMLElement {
  const outer = document.createElement("div");
  const inner = document.createElement("div");
  inner.className = "marker-in";
  inner.textContent = label;
  inner.style.cssText = `width:28px;height:28px;border-radius:9999px;background:${color};color:#fff;font:600 13px/28px var(--font-body),system-ui,sans-serif;text-align:center;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5);cursor:pointer;animation-delay:${delayMs}ms`;
  outer.append(inner);
  return outer;
}

function popupElement(title: string, lines: string[]): HTMLElement {
  // textContent ile kur; mekan adları HTML olarak yorumlanmasın
  const root = document.createElement("div");
  root.style.cssText = "font:13px/1.45 var(--font-body),system-ui,sans-serif;color:#000";
  const h = document.createElement("strong");
  h.textContent = title;
  root.append(h);
  for (const line of lines) {
    const p = document.createElement("div");
    p.textContent = line;
    root.append(p);
  }
  return root;
}

/** Rota çizgileri her güncellemede 0'dan görünür hale gelir (hareket azaltılmışsa anında) */
function fadeInRoutes(map: MlMap) {
  const layers: [string, number][] = [
    ["route-ride", 0.9],
    ["route-approx", 0.85],
    ["route-walk", 0.9],
  ];
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const t0 = performance.now();
  const tick = (t: number) => {
    const p = Math.min(1, (t - t0) / 700);
    for (const [id, target] of layers) {
      if (map.getLayer(id)) map.setPaintProperty(id, "line-opacity", target * p);
    }
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export default function PlanMap({ days, center }: { days: DayPlan[]; center: { lat: number; lng: number } }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<number | "all">("all");

  // Haritayı bir kez oluştur
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | undefined;

    import("maplibre-gl").then((lib) => {
      if (cancelled || !containerRef.current) return;
      libRef.current = lib;
      // Worker public/ altından sunulur (bkz. scripts/copy-maplibre-worker.mjs)
      lib.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      map = new lib.Map({
        container: containerRef.current,
        style: OSM_STYLE,
        center: [center.lng, center.lat],
        zoom: 12,
      });
      map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        map!.addSource(ROUTE_SOURCE, { type: "geojson", data: routeGeoJSON([]) });
        map!.addLayer({
          id: "route-ride",
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["==", ["get", "style"], "ride"],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": ["get", "color"], "line-width": 4.5, "line-opacity": 0.9 },
        });
        map!.addLayer({
          id: "route-approx",
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["==", ["get", "style"], "approx"],
          layout: { "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": 4.5,
            "line-opacity": 0.85,
            // Kesikli: gerçek yol/hat geometrisi yok, duraklar arası çizgi
            "line-dasharray": [2, 1.5],
          },
        });
        map!.addLayer({
          id: "route-walk",
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["==", ["get", "style"], "walk"],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": 3,
            "line-opacity": 0.9,
            // Yuvarlak uçlu sıfır uzunluklu tireler nokta olarak çizilir
            "line-dasharray": [0, 2],
          },
        });
        mapRef.current = map!;
        setReady(true);
      });
    });

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map?.remove();
      mapRef.current = null;
    };
    // Merkez yalnızca ilk açılışta kullanılır; sonra fitBounds devralır
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Plan veya seçili gün değişince durakları ve rotayı güncelle
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;

    const visible = selected === "all" ? days : days.filter((d) => d.day === selected);

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const bounds = new lib.LngLatBounds();
    let markerCount = 0;
    for (const day of visible) {
      day.stops.forEach((stop, i) => {
        const lngLat: [number, number] = [stop.place.lng, stop.place.lat];
        bounds.extend(lngLat);
        const popup = new lib.Popup({ offset: 18, closeButton: false }).setDOMContent(
          popupElement(stop.place.name, [
            `${day.day}. gün · ${stop.arrival}–${stop.departure}`,
            formatRange(stop.place.price),
          ]),
        );
        const marker = new lib.Marker({ element: markerElement(String(i + 1), dayColor(day.day), markerCount++ * 60) })
          .setLngLat(lngLat)
          .setPopup(popup)
          .addTo(map);
        markersRef.current.push(marker);
      });
    }

    const source = map.getSource(ROUTE_SOURCE);
    if (source && "setData" in source) {
      (source as import("maplibre-gl").GeoJSONSource).setData(routeGeoJSON(visible));
      fadeInRoutes(map);
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 600 });
    }
  }, [ready, days, selected]);

  const pill = (active: boolean) =>
    `flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium shadow-card transition-colors ${
      active ? "bg-ink text-bg" : "bg-surface text-ink hover:bg-accent-soft"
    }`;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-line shadow-card">
      <div ref={containerRef} className="h-[min(440px,55vh)] w-full bg-surface-2" />
      <div className="absolute top-3 left-3 z-[1] flex flex-wrap gap-1.5" role="group" aria-label="Gün filtresi">
        <button type="button" aria-pressed={selected === "all"} className={pill(selected === "all")} onClick={() => setSelected("all")}>
          Tümü
        </button>
        {days.map((d) => (
          <button key={d.day} type="button" aria-pressed={selected === d.day} className={pill(selected === d.day)} onClick={() => setSelected(d.day)}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: dayColor(d.day) }} />
            {d.day}. gün
          </button>
        ))}
      </div>
      <ul className="absolute right-3 bottom-7 z-[1] space-y-1 rounded-xl bg-surface/95 px-3 py-2 text-xs text-muted shadow-card backdrop-blur">
        <li className="flex items-center gap-2">
          <span className="h-0 w-6 border-t-[3px] border-ink/70" /> Araç yolu
        </li>
        <li className="flex items-center gap-2">
          <span className="h-0 w-6 border-t-[3px] border-dotted border-ink/70" /> Yürüme
        </li>
        <li className="flex items-center gap-2">
          <span className="h-0 w-6 border-t-[3px] border-dashed border-ink/70" /> Yaklaşık güzergah
        </li>
      </ul>
    </div>
  );
}
