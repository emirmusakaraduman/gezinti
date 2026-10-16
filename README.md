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
Toplu taşıma şimdilik tahminidir.

## Sıradaki adımlar

- OSM (Overpass) içe aktarma ile koordinatları doğrulama
- Toplu taşıma için GTFS + OpenTripPlanner (vapur hatları dahil)

## Harita

`app/plan-map.tsx` MapLibre GL ve OSM karolarını kullanır. Gerçek güzergahlar düz,
tahmini olanlar kesikli çizgiyle çizilir. MapLibre'nin worker dosyası
`npm install` sırasında `public/maplibre/` altına kopyalanır (`scripts/copy-maplibre-worker.mjs`);
Turbopack paketlediğinde worker kendi yolunu bulamadığı için bu gerekli.
