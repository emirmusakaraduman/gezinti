# Rotalama, harita ve koordinat doğrulama

Yürüme/araba rotalarının nereden geldiği, haritanın nasıl çizildiği ve elle girilmiş mekan koordinatlarının nasıl denetlendiği. Genel bakış için [README](../README.md).

## Rotalama

Yürüme ve araba ayakları `lib/routing/osrm.ts` ile OSRM'den gelir (varsayılan:
FOSSGIS'in açık sunucusu routing.openstreetmap.de, demo amaçlıdır). Kendi sunucun için
`OSRM_CAR_URL` ve `OSRM_FOOT_URL` ortam değişkenlerini ver. OSRM trafiksiz süre verdiği için
araba sürelerine ×1,5 trafik çarpanı uygulanır. OSRM'e ulaşılamazsa kuş uçuşu tahmine düşülür.

## Koordinat doğrulama

`.places.json` mekanları OSM'den geldiği için koordinatları zaten OSM'dir. Elle girilmiş
(`source: "kurator"`) mekanları denetlemek için:

```bash
node scripts/verify-coords.mjs
```

Her mekan için 1 km içinde adı eşleşen OSM nesnesi aranır, sapma 150 m'yi aşarsa ya da
eşleşme yoksa `!!` ile işaretlenir. Dosyaları değiştirmez; karar elle verilir. Son
çalıştırmada Rahmi M. Koç Müzesi (351 m) ve Boğaz Vapur Turu (209 m, gerçek iskele)
düzeltildi; Kordon Boyu uzun bir yürüyüş yolu olduğu için olduğu gibi bırakıldı.
Eşleşme adla yapıldığı için yiyecek gibi genel adlı kayıtlarda "ok" yanlış nesneye
de denk gelebilir; rapor bir ipucudur, kanıt değil.

## Harita

`app/plan-map.tsx` MapLibre GL ve OSM karolarını kullanır. Gerçek güzergahlar düz,
tahmini olanlar kesikli çizgiyle çizilir. MapLibre'nin worker dosyası
`npm install` sırasında `public/maplibre/` altına kopyalanır (`scripts/copy-maplibre-worker.mjs`);
Turbopack paketlediğinde worker kendi yolunu bulamadığı için bu gerekli.
