# Toplu taşıma verisi ve veri hattı

Bu belge, Gezinti'nin toplu taşıma (GTFS) verisini nasıl ürettiğini, hangi kaynakları kullandığını ve bilinen sınırlarını anlatır. Hızlı özet için [README](../README.md); başka bir bilgisayarda kurulum için [KURULUM.md](../KURULUM.md).

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

- Ankara: EGO'nun durak adı eşleşmeyen birkaç istasyonu (Gar/YHT, Ankaragücü) ve OSM'de olmayan ~%31 otobüs durağı
- İstanbul: Marmaray, Şehir Hatları vapurları ve M7 (servis Mecidiyeköy-Çağlayan kesimini vermiyor) hâlâ süresi
  dolmuş İBB GTFS'inde; güncel kaynak bulunursa aynı yöntemle değiştirilebilir
- İzmir: İZBAN ve ESHOT GTFS'inin kaynağı da eski (kurumlar yeni sürüm yayımlamamış)

## İstanbul: Metro İstanbul güncel saatleri

İBB'nin Toplu Ulaşım GTFS'i 2024 sonunda bitmiş durumda. Metro İstanbul hatları (M1A-M9, F1, F4,
T1/T3/T4/T5, teleferikler) için İBB Açık Veri'deki resmî web servisten güncel saatler alınır:

```bash
node scripts/fetch-metroistanbul.mjs   # ~2000 çağrı, ~25 dk; önbellekli, kesilirse kaldığı yerden
node scripts/build-gtfs.mjs istanbul
```

`GetTimeTable` bir istasyon + yön + an için sonraki ~1 saatlik kalkışları verir; her yönün başlangıç
istasyonunda gün boyu zincirleme sorulur (hafta içi / cumartesi / pazar için gelecekteki birer örnek
tarih). İstasyon koordinatları servisten gelir; servisin vermediği 3 istasyon (M5 Sultanbeyli kolu) OSM'den
tamamlanır. Ara istasyon saatleri tahminidir (terminalden son istasyona süre, ilk seferin iki istasyondaki
saatinden ölçülüp mesafeyle dağıtılır); kalkış saatleri gerçektir. `GetDirections` zaman zaman 500 verdiğinden
yön kimlikleri gerekirse `GetTimeTable` ile aranır. Servis M7'nin Mecidiyeköy-Çağlayan kesimini vermediği
için eksik hatlar değiştirilmez, eski GTFS'teki hat kullanılır. Değiştirilen hatlar `replaces.json` ile
build-gtfs'e bildirilir.

## İzmir ve Ankara toplu taşıması

İzmir: ESHOT, Metro, Tramvay ve İZBAN GTFS'inden (`npm run gtfs:build`).

Ankara'nın açık GTFS'i yok; iki kaynaktan derlenir:

```bash
node scripts/fetch-ego.mjs                   # otobüs + metro + Ankaray: EGO Hareket Saatleri (~665 sayfa, ~35 dk)
node scripts/build-osm-rail.mjs ankara       # Başkentray (EGO'da yok) ve EGO çekilmediyse tüm raylı: OSM sentetik
node scripts/fetch-rail-geometry.mjs ankara  # ray çizgileri (OSM)
node scripts/build-gtfs.mjs ankara
```

- **Otobüs:** `scripts/fetch-ego.mjs`, EGO'nun herkese açık sayfasından (robots.txt HTML'e
  izin veriyor; istekler 1,2 sn arayla, yanıtlar `.cache/ego` altında saklanır) hat başına
  gerçek kalkış saatlerini (hafta içi / cumartesi / pazar) ve durak sırasını alır. Sayfada
  koordinat yok; OSM'deki EGO duraklarının `ref` alanı EGO durak numarasıdır, koordinatlar
  oradan gelir. OSM'de karşılığı olmayan durak (~%35) hattan çıkarılır. Duraklar arası süre
  gerçek değildir: sayfadaki toplam süre mesafeyle orantılı dağıtılır. Kalkış saatleri gerçek.
  Bu çekim yapılmadıysa derleme, `node scripts/build-osm-rail.mjs ankara bus` ile üretilen
  sentetik OSM otobüs tarifesine düşer (sıklık tahmini, 20 dk).
- **Metro ve Ankaray:** aynı sayfadan (M1-D/G, M4-D/G, A1-D/G) gerçek kalkış saatleri.
  EGO "M1" hattı Çayyolu/Koru'dan Törekent'e tek hat olarak işler (M2 ve M3 ayrı hat değil);
  ara istasyondan başlayan seferler ("… İSTASYONUNDAN BAŞLAYACAK") o istasyondan başlatılır.
  İstasyon koordinatları OSM'den (çoğunun `ref`'i EGO kodu, yoksa ada göre; %96 eşleşir).
  Çizgiler OSM ray ağından kurulur.
- **Başkentray:** EGO'da yok; OSM'den sentetik tarife (sıklık tahmini, 15 dk). EGO raylı
  verisi çekilmediyse tüm raylı hatlar OSM sentetik tarifesine düşer.

Ankara yolculukları planda "tahmini" olarak işaretlenir.

## Raylı hat geometrisi

Şeklı olmayan raylı hatların (İzmir Metro/Tramvay/İZBAN, İstanbul'daki yoğun olmayan
şekiller) çizgisi OSM ray ağından kurulur:

```bash
node scripts/fetch-rail-geometry.mjs istanbul izmir ankara   # data/gtfs/raw/<şehir>-osm-railways.json
npm run gtfs:build
```

`scripts/lib/rail-graph.mjs` ray yollarından ağ kurar, durakları en yakın ray düğümlerine
oturtur ve ardışık duraklar arasında A* ile en kısa yolu bulur. Bir kalıbın tüm durak
çiftleri bağlanmazsa o kalıp düz çizgi olarak kalır. İzmir'in 40, İstanbul'un 7 raylı
kalıbının hepsi çözüldü. Depo/yan hatlar (`service=yard|siding`) ağdan çıkarılır; çift hattı
birbirine bağlayan `crossover` yolları kalmalıdır, yoksa iki yön birbirinden kopuk çıkar.

## Otobüs güzergah çizgisi

İETT ve EGO verisinde hat şekli yok. Şekilsiz otobüs kalıpları için OSM otobüs hat
ilişkilerinden (`route=bus`, aynı hat numarası) durak dizisine en iyi oturan güzergah seçilir:

```bash
node scripts/build-gtfs.mjs istanbul          # hat numaraları meta'dan okunur
node scripts/fetch-bus-geometry.mjs istanbul  # ~1100 hat, Overpass yoğunsa 1+ saat; önbellekli
node scripts/build-gtfs.mjs istanbul          # çizgiler eklenir
```

Bir kalıp ancak tüm durakları çizgiye 120 m içinde ve sırayla oturuyorsa şekil alır; kopuk
(yol parçaları arası 250 m'den fazla boşluklu) ilişkiler atılır. İstanbul'da 2384 şekilsiz
kalıbın 1205'i oturdu (şekilli kalıp 178 → 1386). Kalanlar çalışma anında OSRM yol eşleştirmesine
düşer. Aynı betik Ankara için de çalışır (`ankara`).

