# Gezinti

AI ajanlarıyla bütçeye uygun şehir gezisi planlayıcı. Kullanıcı şehir, gün sayısı, bütçe,
ulaşım tercihi (toplu taşıma / araba) ve ilgi alanlarını seçer; ajanlar gezilecek yerleri ve
yemekleri seçip günlere böler, rotayı sıralar, bütçeyi hesaplar ve aşım riskinde uyarır.

İlk şehirler: İstanbul, İzmir, Ankara.

## Çalıştırma

```bash
npm install
npm run dev
```

Tarayıcıda http://localhost:3000 adresini aç.

Claude ile planlama için `.env.local` dosyasına `ANTHROPIC_API_KEY=...` ekle. Anahtar yoksa
uygulama yedek sezgisel yöntemle çalışır ve bunu planda belirtir.

## Mimari

| Ajan | Dosya | Görev |
|---|---|---|
| Orkestratör | `lib/agents/orchestrator.ts` | Döngüyü yönetir; bütçe aşımı veya kapalı mekan varsa keşif ajanını geri bildirimle yeniden çalıştırır (en fazla 2 tur) |
| Keşif | `lib/agents/discovery.ts` | Claude ile aday listesinden mekan seçer ve günlere dağıtır; dönen ID'leri doğrular |
| Rota | `lib/agents/route.ts` | En yakın komşu + 2-opt ile sıralar, yolları ve saatleri hesaplar |
| Doğrulayıcı | `lib/agents/validator.ts` | Kapalı gün, kapanış saati ve aşırı yoğun günleri kontrol eder |
| Bütçe | `lib/agents/budget.ts` | Maliyetleri aralık olarak toplar, durum ve tasarruf önerisi üretir |

Sayısal işler (mesafe, süre, maliyet) deterministik koddadır. Claude yalnızca seçim yapar
ve açıklama yazar.

## Veri

Şehir verileri `data/cities/*.ts` içinde, `lib/types.ts` şemasıyla doğrulanır.
Net fiyatı olmayan yerler `est(min, max)` ile tahmini aralık olarak girilir.
Koordinatlar ve fiyatlar şimdilik yaklaşıktır.

## Rotalama

Yürüme ve araba ayakları `lib/routing/osrm.ts` ile OSRM'den gelir (varsayılan:
FOSSGIS'in açık sunucusu routing.openstreetmap.de, demo amaçlıdır). Kendi sunucun için
`OSRM_CAR_URL` ve `OSRM_FOOT_URL` ortam değişkenlerini ver. OSRM trafiksiz süre verdiği için
araba sürelerine ×1,5 trafik çarpanı uygulanır. OSRM'e ulaşılamazsa kuş uçuşu tahmine düşülür.

## Toplu taşıma (İstanbul, GTFS)

`lib/transit/router.ts` Connection Scan Algorithm ile, o saatteki gerçek seferlere göre
yürüme + biniş + aktarma adımlarından oluşan yolculuk bulur (metro, tramvay, Marmaray,
füniküler, teleferik, vapur, İETT otobüsü ve Metrobüs). Ek sunucu gerektirmez.

Veri git'e eklenmez; kurmak için İBB Açık Veri Portalı'ndan (data.ibb.gov.tr) şunları indir:

- **Toplu Ulaşım GTFS Verisi** → `data/gtfs/raw/transit/*.csv` (agency, calendar, frequencies, routes, stops, stop_times, trips)
- **İETT GTFS Verisi** → `data/gtfs/raw/iett/*.csv` (agency, calendar, routes, stops, trips)
  ve tam durak saatleri için `stop_times.zip` içindeki `stop_times.txt` → `data/gtfs/raw/iett-zip/`
  (portaldaki `stop_times.csv` seferlerin yalnızca ~%14'ünü içeriyor)

Ardından:

```bash
npm run gtfs:build
```

Bu, `data/gtfs/build/istanbul.{bin,meta.json}` dosyalarını üretir (~110 MB, ~8 sn).
Veri yoksa uygulama toplu taşımayı tahminle hesaplar.

Notlar ve sınırlamalar:
- Ham veri standart dışıdır (noktalı virgül ayraç, Windows-1254 ve çift UTF-8 kodlama,
  bozuk koordinatlar, boş ara durak saatleri); dönüştürme betiği bunları düzeltir.
- Metro/vapur verisi 2024, otobüs verisi 2026 tarihli; takvim tarihi yerine haftanın günü kullanılır.
- Minibüs ve taksi-dolmuş hariç tutulur.
- Her biniş karşılaştırmada 5 dk ceza alır (az aktarmalı rota tercih edilir); her biniş tam
  bilet sayılır, İstanbulkart aktarma indirimi hesaba katılmaz.
- Gece yarısını aşan yolculuklar desteklenmez.

## Sıradaki adımlar

- OSM (Overpass) içe aktarma ile koordinatları doğrulama
- İzmir ve Ankara için GTFS (İzmir'in verisi Mobility Database'de mevcut)
- Toplu taşıma güzergahlarında gerçek hat geometrisi (`shapes.csv`)

## Harita

`app/plan-map.tsx` MapLibre GL ve OSM karolarını kullanır. Gerçek güzergahlar düz,
tahmini olanlar kesikli çizgiyle çizilir. MapLibre'nin worker dosyası
`npm install` sırasında `public/maplibre/` altına kopyalanır (`scripts/copy-maplibre-worker.mjs`);
Turbopack paketlediğinde worker kendi yolunu bulamadığı için bu gerekli.
