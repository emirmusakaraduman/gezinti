# Başka bir bilgisayarda kurulum

Bu proje başka bir bilgisayarda çalıştırılacaksa bilinmesi gereken tek şey: **toplu taşıma verisi
git'te yoktur.** Üç şehrin derlenmiş tarifesi yaklaşık 195 MB olduğu için `.gitignore`'dadır. Repo'yu
çekip `npm run dev` demek uygulamayı açar ve plan üretir, ama toplu taşıma ayakları kuş uçuşu
tahminle hesaplanır (gerçek hat numarası, saat ve harita çizgisi çıkmaz). Gerçek veriyle çalışması
için aşağıdaki iki yoldan birini izle.

## 1. Gereksinimler

- Node.js 24 ve npm
- Git
- İnternet (harita karoları OpenStreetMap'ten, yol rotaları herkese açık OSRM sunucusundan gelir)

## 2. Kodu kur

```bash
git clone https://github.com/emirmusakaraduman/gezinti.git
cd gezinti
npm install
```

`npm install`, MapLibre worker dosyasını `public/maplibre/` altına kendiliğinden kopyalar.

## 3. Toplu taşıma verisi

### Yol A (önerilen, dakikalar): hazır derlenmiş veriyi kopyala

Verinin bulunduğu bilgisayarda (`data/gtfs/build/` dolu olan) klasörü sıkıştır:

```powershell
Compress-Archive -Path data\gtfs\build -DestinationPath gezinti-gtfs-build.zip
```

Zip'i yeni bilgisayara taşı (USB, bulut, ağ paylaşımı) ve projenin içinde şuraya aç:

```powershell
Expand-Archive gezinti-gtfs-build.zip -DestinationPath data\gtfs
```

Sonuçta şu dosyalar bulunmalı (yaklaşık 195 MB):

```
data/gtfs/build/istanbul.bin   istanbul.meta.json
data/gtfs/build/izmir.bin      izmir.meta.json
data/gtfs/build/ankara.bin     ankara.meta.json
```

### Yol B (saatler sürer): veriyi sıfırdan üret

Ham veriler de git'te yoktur; kaynaklardan yeniden indirilip derlenir. İnternet gerekir.

| Şehir | Kaynak | Hazırlık |
|---|---|---|
| İstanbul | İBB Açık Veri Portalı: Toplu Ulaşım GTFS ve İETT GTFS | README'deki "Toplu taşıma (İstanbul, GTFS)" bölümüne göre elle indirilir |
| İstanbul metro | İBB Açık Veri: Metro İstanbul web servisi | `node scripts/fetch-metroistanbul.mjs` (~25 dk) |
| İzmir | `eshot.gov.tr`, `izmirmetro.com.tr`, `tramizmir.com`, `izban.com.tr` GTFS zip'leri | Aşağıya bak |
| Ankara | EGO "Hareket Saatleri" sayfası ve OpenStreetMap | `node scripts/fetch-ego.mjs` (~35 dk) |

İzmir zip'lerini şuraya aç: `data/gtfs/raw/izmir/eshot`, `.../metro`, `.../tram`, `.../izban`
(her klasörde `stops.txt`, `routes.txt` vb. doğrudan bulunmalı). Ardından sırayla:

```bash
# Ankara raylı (Başkentray) ve gerçek ray çizgileri için OSM
node scripts/build-osm-rail.mjs ankara
node scripts/fetch-rail-geometry.mjs istanbul izmir ankara

# Derle (ayrı ayrı da verilebilir: node scripts/build-gtfs.mjs istanbul)
node --max-old-space-size=6144 scripts/build-gtfs.mjs

# İsteğe bağlı: otobüs güzergahlarının gerçek çizgisi (Overpass yoğunsa 1+ saat)
node scripts/fetch-bus-geometry.mjs istanbul
node scripts/fetch-bus-geometry.mjs ankara
node --max-old-space-size=6144 scripts/build-gtfs.mjs
```

Ayrıntılar ve sınırlamalar README'dedir. Beslemelerin takvim geçerliliğini görmek için:
`node scripts/check-gtfs-validity.mjs`.

## 4. Ortam değişkenleri (`.env.local`)

Dosya git'te yoktur. Gerekli değildir; uygulama olmadan da çalışır.

```
# İsteğe bağlı: AI ajanları. Yoksa uygulama "demo modunda" çalışır ve planda belirtir.
ANTHROPIC_API_KEY=...

# İsteğe bağlı: yerel OSRM sunucusu. YOKSA TANIMLAMA: herkese açık sunucu kullanılır.
# OSRM_CAR_URL=http://localhost:5000
```

Önemli: Verinin üretildiği bilgisayardaki `.env.local` dosyasını olduğu gibi kopyalama.
İçindeki `OSRM_CAR_URL` o bilgisayardaki yerel bir Docker OSRM'e işaret edebilir; yeni
bilgisayarda böyle bir sunucu yoksa araba rotaları tahmine düşer.

## 5. Çalıştır ve doğrula

```bash
npm run dev
```

http://localhost:3000 adresini aç. Doğrulama:

1. İlk toplu taşıma planında sunucu çıktısında şunlar görünmeli (şehre göre):
   `[gtfs] istanbul yüklendi`, `[gtfs] izmir yüklendi`, `[gtfs] ankara yüklendi`.
   Görünmüyorsa o şehrin verisi `data/gtfs/build/` altında yoktur.
2. Bir Ankara planı oluştur: toplu taşıma adımlarında gerçek EGO hat numaraları (ör. `413-7`,
   `A1`) ve saatler görünmeli. Haritada güzergahlar düz çizgi, yürüme noktalı, tahmini
   güzergah kesikli çizilir.
3. Testler: `npm test` (veri olmasa da geçer; gerçek veri testleri veri yoksa atlanır).

## Sık karşılaşılan sorunlar

| Belirti | Sebep ve çözüm |
|---|---|
| Plan çıkıyor ama toplu taşıma hep kuş uçuşu | `data/gtfs/build/` yok ya da eksik. Üçüncü bölüme bak |
| `GTFS biçim sürümü uyumsuz` | Veri eski kod sürümüyle derlenmiş. `node scripts/build-gtfs.mjs` ile yeniden derle |
| Harita boş, işaretçiler var | Karolar yüklenmemiş: internet erişimini kontrol et |
| Araba rotaları hep tahmin | `.env.local` içindeki `OSRM_CAR_URL` ulaşılamayan bir adrese işaret ediyor; satırı sil |
| Derleme sırasında bellek hatası | `node --max-old-space-size=6144 scripts/build-gtfs.mjs` ile çalıştır |
| Planda "tarifesi ... tarihinde bitiyor" uyarısı | Beklenen: İstanbul Marmaray/vapur, İZBAN, ESHOT kaynakları güncel değil |
