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
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const ROUTE_SOURCE = "route";

/** Her ayak ayrı çizgi: gerçek geometri varsa o, yoksa iki durak arası düz çizgi */
function routeGeoJSON(days: DayPlan[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: days.flatMap((d) =>
      d.legs.map((leg, i): GeoJSON.Feature<GeoJSON.LineString> => {
        const from = d.stops[i].place;
        const to = d.stops[i + 1].place;
        return {
          type: "Feature",
          properties: { color: dayColor(d.day), estimated: leg.geometry === null },
          geometry: {
            type: "LineString",
            coordinates: leg.geometry ?? [
              [from.lng, from.lat],
              [to.lng, to.lat],
            ],
          },
        };
      }),
    ),
  };
}

function markerElement(label: string, color: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = label;
  el.style.cssText = `width:28px;height:28px;border-radius:9999px;background:${color};color:#fff;font:600 13px/28px system-ui,sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:pointer`;
  return el;
}

function popupElement(title: string, lines: string[]): HTMLElement {
  // textContent ile kur; mekan adları HTML olarak yorumlanmasın
  const root = document.createElement("div");
  root.style.cssText = "font:13px/1.4 system-ui,sans-serif;color:#18181b";
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
          id: "route-real",
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["==", ["get", "estimated"], false],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.85 },
        });
        map!.addLayer({
          id: "route-estimated",
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["==", ["get", "estimated"], true],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": 4,
            "line-opacity": 0.85,
            // Kesikli: gerçek yol geometrisi yok, iki durak arası düz çizgi
            "line-dasharray": [2, 1.5],
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
        const marker = new lib.Marker({ element: markerElement(String(i + 1), dayColor(day.day)) })
          .setLngLat(lngLat)
          .setPopup(popup)
          .addTo(map);
        markersRef.current.push(marker);
      });
    }

    const source = map.getSource(ROUTE_SOURCE);
    if (source && "setData" in source) {
      (source as import("maplibre-gl").GeoJSONSource).setData(routeGeoJSON(visible));
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 600 });
    }
  }, [ready, days, selected]);

  const tab = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm ${
      active ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700"
    }`;

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <button type="button" className={tab(selected === "all")} onClick={() => setSelected("all")}>
          Tümü
        </button>
        {days.map((d) => (
          <button key={d.day} type="button" className={tab(selected === d.day)} onClick={() => setSelected(d.day)}>
            <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: dayColor(d.day) }} />
            {d.day}. gün
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-500">Düz: gerçek yol · Kesikli: tahmini güzergah</span>
      </div>
      <div ref={containerRef} className="h-[420px] w-full" />
    </div>
  );
}
