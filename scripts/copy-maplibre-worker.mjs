// MapLibre worker'ı kendi modül URL'sine göre arar; Turbopack paketlediğinde
// bu yol bozulur. Worker'ı public/ altına kopyalayıp setWorkerUrl ile veriyoruz.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/maplibre", { recursive: true });
copyFileSync(
  "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
  "public/maplibre/maplibre-gl-worker.mjs",
);
