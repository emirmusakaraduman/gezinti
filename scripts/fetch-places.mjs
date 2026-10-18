// Şehirlerin mekan listesini açık verilerden üretir.
//
//   node scripts/fetch-places.mjs            # tüm şehirler
//   node scripts/fetch-places.mjs istanbul   # tek şehir
//
// Gezilecek yerler: OpenStreetMap'te Wikidata bağlantısı olan yerler (Overpass),
// Wikipedia popülerliğiyle sıralanır: kaç dilde maddesi olduğu (Wikidata) ve
// son 12 aylık tr + en görüntülenmesi (Wikimedia Pageviews).
//
// Yeme-içme: açık veride puan yok. Köklü ve yaygın tavsiye edilen mekanlar
// elle derlenir (FOOD) ve OSM'de aranır; bulunamayan listeye girmez.
//
// Çıktı: data/cities/<şehir>.places.json (git'e girer).
// Ham yanıtlar .cache/places altında saklanır; yeniden çalıştırmada kullanılır.
//
// Lisans: OSM verisi ODbL (atıf gerekir), Wikidata ve Pageviews CC0.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { foldTurkish, parseOpeningHours, slug } from "./lib/text.mjs";

const USER_AGENT = "gezinti/0.1 (kisisel proje; https://github.com/emirmusakaraduman/gezinti)";
const CACHE = ".cache/places";
const OVERPASS = "https://overpass-api.de/api/interpreter";

// ---------- Şehirler ----------

/** bbox: güney, batı, kuzey, doğu (turistik merkez; il geneli değil) */
/** foodBbox: yeme-içme için daha geniş alan (ödüllü mekanlar merkez dışında da olabilir) */
const CITIES = {
  istanbul: { prefix: "ist", bbox: [40.96, 28.85, 41.2, 29.12], foodBbox: [40.85, 28.6, 41.25, 29.35], take: 70 },
  izmir: { prefix: "izm", bbox: [38.36, 27.03, 38.48, 27.25], foodBbox: [38.3, 26.95, 38.55, 27.3], take: 45 },
  ankara: { prefix: "ank", bbox: [39.86, 32.75, 39.97, 32.92], foodBbox: [39.8, 32.6, 40.05, 33.0], take: 45 },
};

/**
 * Elle hariç tutulanlar (Wikidata kimliği → gerekçe). Popüler ama gezgin
 * için anlamlı olmayan yerler.
 */
const EXCLUDE = {
  Q48898: "Levent: iş ve ofis bölgesi",
};

/** Wikidata adı belirsiz kalanlara anlaşılır ad */
const RENAME = {
  Q1379299: "Eski Smyrna Ören Yeri (Bayraklı Tepekule)",
};

/** Semtler konut bölgesi de olabildiği için daha yüksek popülerlik istenir */
const SEMT_MIN_SCORE = 4.5;

/** Görüntülenmesi sorulacak en fazla aday (dil sayısına göre en bilinenler) */
const PAGEVIEW_CANDIDATES = 250;
const PAGEVIEW_DELAY_MS = 150;

/** Bir kategoriden en fazla bu kadar yer seçilir (çeşitlilik için) */
const CATEGORY_CAP = { tarih: 22, muze: 16, doga: 10, manzara: 8, semt: 12, carsi: 6 };

// ---------- Küratörlü yeme-içme ----------
// pattern: OSM adında aranacak ifade (büyük/küçük harf duyarsız)
// near: yaklaşık konum; aynı adlı şubeler arasından buna en yakını seçilir.
//   Yoksa (konumu bilinmeyen Michelin mekanları) adı eşleşen yerler birbirine
//   yakınsa en iyi eşleşme alınır; uzak şubeler varsa belirsiz sayılıp atlanır.
// distinction: Michelin Rehberi Türkiye ödülü. Kaynaklar: İzmir BB turizm
//   sitesi (visitizmir.org, 2025), Michelin 2025 basın haberleri ve 2026
//   seçkisini derleyen yayınlar. Michelin'in kendi sitesi taranmadı.

const yemek = (min, max) => ({ min, max });

/** Ödül türüne göre kişi başı tahmini fiyat (TL, 2026) */
const MICHELIN_PRICE = {
  "michelin-2-yildiz": yemek(7000, 12000),
  "michelin-yildiz": yemek(4500, 9000),
  "michelin-bib": yemek(700, 1600),
  "michelin-tavsiye": yemek(1500, 4000),
};
const MICHELIN_LABEL = {
  "michelin-2-yildiz": "iki Michelin yıldızı",
  "michelin-yildiz": "Michelin yıldızı",
  "michelin-bib": "Michelin Bib Gourmand (makul fiyata çok iyi yemek)",
  "michelin-tavsiye": "Michelin Rehberi tavsiyesi",
};

/** Michelin ödüllü mekan kaydı; açıklama ve fiyat ödülden türetilir */
const michelin = (kind, year, pattern, extra = {}) => ({
  pattern,
  category: "yemek",
  price: MICHELIN_PRICE[kind],
  description: `${year} Michelin Rehberi Türkiye: ${MICHELIN_LABEL[kind]}.`,
  distinction: { kind, year },
  ...extra,
});

const FOOD = {
  istanbul: [
    { pattern: "Karaköy Güllüoğlu", near: [41.0236, 28.9774], category: "kafe", price: yemek(250, 500), mustTry: "Fıstıklı baklava ve su böreği", description: "1949'dan beri İstanbul'un en bilinen baklavacılarından." },
    { pattern: "^Hafız Mustafa( 1864)?$", name: "Hafız Mustafa 1864", near: [41.0146, 28.9763], category: "kafe", price: yemek(250, 500), mustTry: "Baklava, lokum ve sütlaç", description: "1864'ten beri tatlı ve lokum; Sirkeci'deki tarihi şube." },
    { pattern: "Çiya Sofrası", near: [40.9905, 29.0261], category: "yemek", price: yemek(600, 1200), mustTry: "Günün tencere yemekleri ve kebaplar", description: "Anadolu mutfağının unutulmuş yemeklerini yaşatan lokanta." },
    // "Meşhur Sultanahmet Köftecisi" ayrı bir işletme; asıl tarihi mekan bu
    { pattern: "Tarihi Sultanahmet Köftecisi|Selim Usta", near: [41.008, 28.9771], category: "yemek", price: yemek(450, 800), mustTry: "Izgara köfte ve piyaz", description: "1920'den beri tarihi yarımadanın köfte lokantası." },
    { pattern: "Pandeli", near: [41.0166, 28.9706], category: "yemek", price: yemek(900, 1800), mustTry: "Patlıcan böreği ve kuzu", description: "Mısır Çarşısı'nın üstünde, çinili salonlu tarihi restoran." },
    { pattern: "^Hamdi", near: [41.0172, 28.9717], category: "yemek", price: yemek(900, 1800), mustTry: "Fıstıklı kebap ve lahmacun", description: "Haliç manzaralı, Güneydoğu mutfağıyla ünlü kebapçı." },
    { pattern: "Vefa Bozacısı", near: [41.0156, 28.9575], category: "kafe", price: yemek(80, 200), mustTry: "Leblebili boza", description: "1876'dan beri boza yapan tarihi dükkan." },
    { pattern: "Karaköy Lokantası", near: [41.0245, 28.977], category: "yemek", price: yemek(700, 1400), mustTry: "Öğlen esnaf yemekleri, akşam meze", description: "Turkuaz çinili salonuyla Karaköy'ün sevilen lokantası." },
    { pattern: "Kurukahveci Mehmet Efendi", near: [41.0168, 28.9709], category: "kafe", price: yemek(100, 300), mustTry: "Taze çekilmiş Türk kahvesi", description: "1871'den beri Türk kahvesi kavuran tarihi dükkan." },
    { pattern: "Mandabatmaz", near: [41.0333, 28.9767], category: "kafe", price: yemek(80, 200), mustTry: "Yoğun köpüklü Türk kahvesi", description: "İstiklal'in arka sokağında efsanevi küçük kahveci." },
    { pattern: "Kızılkayalar", near: [41.0365, 28.9862], category: "yemek", price: yemek(80, 200), mustTry: "Islak hamburger", description: "Taksim'in gece yarısı klasiği ıslak hamburger." },
    { pattern: "Asmalı Cavit", near: [41.0302, 28.9752], category: "yemek", price: yemek(1200, 2500), mustTry: "Meze ve balık", description: "Asmalımescit'in köklü meyhanesi." },
    { pattern: "Baylan", near: [40.9893, 29.0255], category: "kafe", price: yemek(200, 450), mustTry: "Kup Griye", description: "1923'ten beri Kadıköy'ün tarihi pastanesi." },
    { pattern: "Lades", near: [41.0346, 28.9785], category: "yemek", price: yemek(250, 500), mustTry: "Menemen ve sulu yemekler", description: "Beyoğlu'nun esnaf lokantası klasiği." },

    // Köklü esnaf lokantaları ve kebapçılar
    { pattern: "Hacı Abdullah", near: [41.0352, 28.9805], category: "yemek", price: yemek(700, 1400), mustTry: "Hünkar beğendi ve komposto", description: "19. yüzyıldan beri Osmanlı mutfağı; Beyoğlu'nun en eski lokantalarından." },
    { pattern: "^Kanaat", near: [41.0258, 29.015], category: "yemek", price: yemek(500, 1000), mustTry: "Zeytinyağlılar ve sütlü tatlılar", description: "1933'ten beri Üsküdar'ın esnaf lokantası." },
    { pattern: "^Hünkar", near: [41.051, 28.9925], category: "yemek", price: yemek(900, 1800), mustTry: "Ev usulü Osmanlı yemekleri", description: "1950'den beri ev yemeğinin şık hali." },
    { pattern: "^Konyalı", near: [41.013, 28.979], category: "yemek", price: yemek(700, 1500), mustTry: "Kuzu ve börekler", description: "Tarihi yarımadanın köklü lokantası." },
    { pattern: "Filibe Köftecisi", near: [41.015, 28.977], category: "yemek", price: yemek(400, 800), mustTry: "Filibe köfte", description: "1893'ten beri Sirkeci'de köfte." },
    { pattern: "^Develi", near: [40.999, 28.931], category: "yemek", price: yemek(1000, 2000), mustTry: "Fıstıklı kebap ve çiğ köfte", description: "1912'den beri Antep mutfağı; Samatya'daki ilk şube." },

    // Michelin 2026 yıldızlı (şehir merkezindekiler)
    // OSM'de "Turk Fatik Tutak" olarak (yazım hatasıyla) kayıtlı
    michelin("michelin-2-yildiz", 2026, "^TURK|Fatih Tutak|Fatik Tutak", { name: "TURK Fatih Tutak", near: [41.0585, 28.9785], mustTry: "Tadım menüsü" }),
    michelin("michelin-yildiz", 2026, "^Araka", { near: [41.121, 29.071] }),
    michelin("michelin-yildiz", 2026, "^Arkestra", { near: [41.08, 29.033] }),
    michelin("michelin-yildiz", 2026, "^Mikla", { name: "Mikla", near: [41.032, 28.974] }),
    michelin("michelin-yildiz", 2026, "^Neolokal", { near: [41.0236, 28.9745] }),
    michelin("michelin-yildiz", 2026, "^Nicole", { near: [41.031, 28.9765] }),
    michelin("michelin-yildiz", 2026, "^Sankai", { near: [41.077, 29.044] }),
    michelin("michelin-yildiz", 2026, "^Araf", { near: [40.99, 29.03] }),
    // Michelin Bib Gourmand (2025 ve 2026'da eklenenler)
    michelin("michelin-bib", 2025, "Ali Ocakbaşı"),
    michelin("michelin-bib", 2025, "^Tatbak"),
    michelin("michelin-bib", 2025, "Nazende"),
    michelin("michelin-bib", 2026, "Casius"),
    michelin("michelin-bib", 2026, "Yanyalı Fehmi", { near: [40.9905, 29.0255], mustTry: "Tencere yemekleri ve tatlılar" }),
    michelin("michelin-bib", 2026, "Mahir Lokantası"),
    michelin("michelin-bib", 2026, "Mutfakkoz"),
    michelin("michelin-bib", 2026, "^Parvus", { near: [40.979, 29.045] }),
    michelin("michelin-bib", 2026, "Ahmet Ustam"),
    // Michelin 2026 tavsiye (lokanta ve kebapçılar)
    michelin("michelin-tavsiye", 2026, "Gün Lokantası"),
    michelin("michelin-tavsiye", 2026, "Havuş"),
    michelin("michelin-tavsiye", 2026, "Sıralı Kebap"),
    michelin("michelin-tavsiye", 2026, "Lokanta Limu"),
  ],
  izmir: [
    // OSM'de "dostlar firini" olarak kayıtlı (ı/i)
    { pattern: "Dostlar F[ıi]r[ıi]n[ıi]", name: "Dostlar Fırını", near: [38.4369, 27.143], tags: ["kahvalti"], category: "kafe", price: yemek(80, 200), mustTry: "Boyoz ve haşlanmış yumurta", description: "Alsancak'ın en bilinen boyozcusu." },
    { pattern: "Reyhan", near: [38.4352, 27.1446], category: "kafe", price: yemek(200, 450), mustTry: "Pasta ve şam tatlısı", description: "İzmir'in köklü pastanesi." },
    { pattern: "Sevinç", near: [38.4355, 27.1428], category: "kafe", price: yemek(150, 400), mustTry: "Pasta ve kurabiye", description: "Alsancak'ta 1945'ten beri pastane." },
    { pattern: "Tavacı Recep", near: [38.4362, 27.1438], category: "yemek", price: yemek(500, 1000), mustTry: "Tavada et ve kuzu", description: "Tava kebabıyla bilinen köklü lokanta; 2025 Michelin Bib Gourmand.", distinction: { kind: "michelin-bib", year: 2025 } },
    { pattern: "Deniz Restaurant", near: [38.4367, 27.1405], category: "yemek", price: yemek(1000, 2000), mustTry: "Balık ve deniz mahsulleri", description: "Kordon'da körfez manzaralı balık restoranı." },
    { pattern: "^Topçu$", near: [38.4261, 27.1331], category: "yemek", price: yemek(300, 600), mustTry: "Çöp şiş", description: "İzmir usulü çöp şişin bilinen adresi." },
    { pattern: "Şevkiye", near: [38.4195, 27.1335], category: "kafe", price: yemek(60, 180), mustTry: "Boyoz", description: "Kemeraltı'nın eski boyoz fırını." },

    // Michelin 2025 (İzmir BB turizm sitesi). Urla, Çeşme ve Alaçatı'dakiler
    // şehir merkezi dışında olduğundan arama alanına girmez.
    michelin("michelin-yildiz", 2025, "Narımor"),
    michelin("michelin-bib", 2025, "Ayşa"),
    michelin("michelin-bib", 2025, "Beğendik Abi", { name: "Beğendik Abi" }),
    michelin("michelin-bib", 2025, "Adil Müftüoğlu", { mustTry: "Kemeraltı köftesi" }),
    michelin("michelin-bib", 2025, "La Mahzen"),
    michelin("michelin-bib", 2025, "Aslında Meyhane"),
    michelin("michelin-tavsiye", 2025, "Emektar Kebap"),
    michelin("michelin-tavsiye", 2025, "Balmumu"),
    michelin("michelin-tavsiye", 2025, "Seyhan Et"),
    michelin("michelin-tavsiye", 2025, "^Rituel"),
    michelin("michelin-tavsiye", 2025, "^Terakki"),
    michelin("michelin-tavsiye", 2025, "Roka Bahçe"),
    michelin("michelin-tavsiye", 2025, "Kasap Fuat", { near: [38.437, 27.143] }),
    michelin("michelin-tavsiye", 2025, "^Levan"),
    michelin("michelin-tavsiye", 2025, "Birinci Kordon", { name: "Birinci Kordon Balık" }),
    michelin("michelin-tavsiye", 2025, "^Scappi", { name: "Scappi" }),
  ],
  ankara: [
    { pattern: "Uludağ", near: [39.9419, 32.8547], category: "yemek", price: yemek(600, 1200), mustTry: "İskender kebap", description: "Ulus'ta 1956'dan beri İskender kebap." },
    { pattern: "Masabaşı", near: [39.9192, 32.8593], category: "yemek", price: yemek(600, 1200), mustTry: "Kebap ve lahmacun", description: "Ankara'nın en bilinen kebapçılarından." },
    { pattern: "Washington", near: [39.9405, 32.8645], category: "yemek", price: yemek(800, 1600), mustTry: "Ankara tava ve kuzu", description: "Ankara Kalesi'nde tarihi konakta restoran." },
    { pattern: "Zenger Paşa", near: [39.9402, 32.8641], category: "yemek", price: yemek(600, 1200), mustTry: "Gözleme ve kuzu tandır", description: "Kale içinde şehir manzaralı tarihi konak." },
    { pattern: "Hacı Arif Bey", near: [39.9086, 32.8551], category: "yemek", price: yemek(600, 1200), mustTry: "Kebap ve künefe", description: "Ankara'nın bilinen kebapçılarından." },
    { pattern: "Çengelhan", near: [39.9402, 32.8639], category: "yemek", price: yemek(800, 1600), mustTry: "Akşam yemeği", description: "Tarihi Çengelhan'da restoran." },
    { pattern: "Akman Boza", near: [39.9404, 32.8547], category: "kafe", price: yemek(80, 250), mustTry: "Boza ve tavuk göğsü", description: "Ulus'ta tarihi boza ve pasta salonu." },
    // Ankara Michelin rehberinde yok; köklü ve yaygın tavsiye edilenler
    { pattern: "Kebap 49", near: [39.905, 32.86], category: "yemek", price: yemek(600, 1200), mustTry: "Taş fırın kebap ve pide", description: "1949'dan beri taş fırın ustalığı; geniş bahçeli." },
    // OSM'de ASCII yazılmış: "Bogazici Lokantasi"
    { pattern: "Boğaziçi Lokantası", name: "Boğaziçi Lokantası", near: [39.9415, 32.855], category: "yemek", price: yemek(400, 900), mustTry: "Ankara tava", description: "1956'dan beri Ulus'ta Ankara tavasıyla bilinen esnaf lokantası." },
    { pattern: "Hacı Bayram.*Kebap|Nazım Usta", near: [39.944, 32.858], category: "yemek", price: yemek(300, 700), mustTry: "Döner", description: "Ulus'ta dönerin ilk akla gelen adreslerinden." },
    { pattern: "Canbolat", near: [39.94, 32.86], category: "yemek", price: yemek(300, 700), mustTry: "Döner", description: "Dönerseverlerin yıllardır uğradığı kebapçı." },
    { pattern: "Çukurağa", near: [39.92, 32.855], category: "yemek", price: yemek(500, 1000), mustTry: "Ocakbaşı ve tandır", description: "Kızılay'da ocakbaşıyla bilinen sofra." },
    { pattern: "^Trilye", near: [39.89, 32.86], category: "yemek", price: yemek(1500, 3500), mustTry: "Balık ve deniz mahsulleri", description: "Ankara'nın en bilinen balık restoranlarından." },
  ],
};

// ---------- Yardımcılar ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(CACHE, { recursive: true });

/** Yanıtı önbellekten ver ya da indirip önbelleğe yaz */
async function cachedJson(key, fetcher) {
  const file = `${CACHE}/${createHash("sha1").update(key).digest("hex")}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const data = await fetcher();
  writeFileSync(file, JSON.stringify(data));
  return data;
}

async function getJson(url, init = {}, tries = 6) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, ...(init.headers ?? {}) } });
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if (i >= tries || ![429, 500, 502, 503, 504].includes(res.status)) {
      throw new Error(`${res.status} ${url.slice(0, 120)}`);
    }
    // Sunucu ne kadar bekleneceğini söylüyorsa ona uy
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * i);
  }
}

function overpass(query) {
  return cachedJson(`overpass|${query}`, () =>
    getJson(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    }),
  );
}

/** Basit eşzamanlılık sınırıyla map */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

function haversineM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b[0] - a[0]) / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const center = (el) => (el.type === "node" ? [el.lat, el.lon] : el.center ? [el.center.lat, el.center.lon] : null);

// ---------- Kategori, süre, fiyat ----------

function categorize(tags) {
  const name = tags.name ?? "";
  // Saray ve kasırlar çoğunlukla müze; bahçe etiketiyle "doğa" sayılmasınlar
  if (/^(museum|gallery)$/.test(tags.tourism ?? "") || /Saray(ı)?\b|Kasr(ı)?\b|Köşk(ü)?\b/.test(name)) return "muze";
  if (tags.tourism === "viewpoint" || tags.man_made === "tower" || /Kule(si)?\b/.test(name)) return "manzara";
  // Çarşılar tarihi etiket taşısa da "çarşı" ("Kapalıçarşı" gibi bitişik yazılanlar dahil)
  if (tags.amenity === "marketplace" || /[Çç]arşı(sı)?\b|Bedesten/.test(name)) return "carsi";
  // Park olmayan tarihi yapılar (ör. çeşmeler su etiketiyle "doğa" sayılıyordu)
  if (tags.historic && !tags.leisure) return "tarih";
  if (/^(park|garden|nature_reserve)$/.test(tags.leisure ?? "") || tags.natural || /^(zoo|aquarium)$/.test(tags.tourism ?? "")) return "doga";
  if (/^(quarter|neighbourhood|suburb)$/.test(tags.place ?? "")) return "semt";
  if (tags.historic || tags.amenity === "place_of_worship" || tags.tourism === "attraction") return "tarih";
  return null;
}

const DURATION = { muze: 90, tarih: 45, doga: 60, manzara: 45, semt: 90, carsi: 60 };

/**
 * OSM'de ücret bilgisi olmayan ama ücretli olduğu bilinen yerler için
 * kişi başı tahmini aralık (TL, 2026; yerli/yabancı tarifesi farklı olabilir)
 */
const PRICE_OVERRIDE = {
  Q216511: [300, 1300], // Yerebatan Sarnıcı
  Q848397: [300, 1200], // Kız Kulesi (tekne dahil)
  Q28657490: [200, 600], // Çamlıca Kulesi seyir terası
};

/** Ücret etiketi yoksa genellikle ücretsiz gezilen tarihi yapı türleri */
const FREE_HISTORIC = /^(monument|memorial|citywalls|city_gate|square|aqueduct|bridge|castle|tomb|caravanserai|fountain|column|district|yes)$/;

function price(category, tags, qid) {
  const est = (min, max) => ({ min, max, confidence: "tahmini", lastVerified: null });
  if (PRICE_OVERRIDE[qid]) return est(...PRICE_OVERRIDE[qid]);
  if (tags.fee === "no" || tags.amenity === "place_of_worship") return est(0, 0);
  if (tags.fee !== "yes" && (FREE_HISTORIC.test(tags.historic ?? "") || /Meydanı$/.test(tags.name ?? ""))) {
    return est(0, 0);
  }
  if (category === "semt" || category === "carsi") return est(0, 0);
  if (category === "doga") return tags.fee === "yes" ? est(50, 300) : est(0, 0);
  if (category === "muze") return est(150, 700);
  if (tags.fee === "yes") return est(100, 500);
  // Ücret bilgisi yok: çoğu tarihi yapı ücretsiz, bazıları değil
  return est(0, 300);
}

// ---------- Gezilecek yerler ----------

/**
 * İnsan ve olay türleri. Alt sınıf zinciri (P279*) sorgusu zaman aşımına
 * uğradığı için yaygın türler doğrudan listelenir.
 */
const NOT_PLACE_CLASSES = [
  "Q5", // insan
  "Q1190554", // olay (occurrence)
  "Q1656682", // olay (event)
  "Q13418847", // tarihi olay
  "Q273120", // protesto
  "Q175331", // gösteri
  "Q178561", // muharebe
  "Q188055", // kuşatma
  "Q124734", // isyan
  "Q3917681", // büyükelçilik (bahçesi park olarak etiketlenmiş olabiliyor)
  "Q7843791", // diplomatik misyon
];

/** Verilen Wikidata öğelerinden insan ya da olay olanlar */
async function humansAndEvents(qids) {
  const out = new Set();
  const classes = NOT_PLACE_CLASSES.map((c) => `wd:${c}`).join(" ");
  for (let i = 0; i < qids.length; i += 150) {
    const values = qids.slice(i, i + 150).map((q) => `wd:${q}`).join(" ");
    const sparql = `SELECT ?item WHERE { VALUES ?item { ${values} } VALUES ?cls { ${classes} } ?item wdt:P31 ?cls }`;
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
    const d = await cachedJson(`sparql|${sparql}`, () => getJson(url, { headers: { Accept: "application/sparql-results+json" } }));
    for (const b of d.results.bindings) out.add(b.item.value.split("/").pop());
  }
  return out;
}

async function attractions(cityId, cfg) {
  const [s, w, n, e] = cfg.bbox;
  const bb = `(${s},${w},${n},${e})`;
  const query = `[out:json][timeout:180];
(
  nwr["wikidata"]["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium)$"]${bb};
  nwr["wikidata"]["historic"]${bb};
  nwr["wikidata"]["leisure"~"^(park|garden|nature_reserve)$"]${bb};
  nwr["wikidata"]["amenity"~"^(place_of_worship|marketplace)$"]${bb};
  nwr["wikidata"]["place"~"^(quarter|neighbourhood|suburb)$"]${bb};
);
out center tags;`;
  const data = await overpass(query);
  console.log(`  OSM: ${data.elements.length} öğe`);

  // Aynı Wikidata öğesine bağlı birden çok OSM nesnesi olabilir; birini al
  const byQid = new Map();
  for (const el of data.elements) {
    const tags = el.tags ?? {};
    const qid = tags.wikidata;
    const pos = center(el);
    const category = categorize(tags);
    if (!/^Q\d+$/.test(qid ?? "") || !pos || !category || !tags.name) continue;
    if (!byQid.has(qid)) byQid.set(qid, { qid, tags, pos, category, osmId: `${el.type}/${el.id}` });
  }
  // OSM'de bazı türbeler gömülü kişinin, bazı parklar bir olayın Wikidata
  // kaydına bağlanmış; o zaman popülerlik yere değil kişiye/olaya ait olur.
  const notPlaces = await humansAndEvents([...byQid.keys()]);
  const items = [...byQid.values()].filter((x) => !notPlaces.has(x.qid) && !(x.qid in EXCLUDE));
  console.log(`  Wikidata'lı aday: ${items.length} (kişi/olay olduğu için ${notPlaces.size} elendi)`);

  // Wikidata: dil sayısı, Türkçe ad/açıklama, tr/en Wikipedia başlıkları
  const entities = {};
  for (let i = 0; i < items.length; i += 50) {
    const ids = items.slice(i, i + 50).map((x) => x.qid).join("|");
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks|labels|descriptions&languages=tr|en&ids=${ids}`;
    const d = await cachedJson(`wd|${ids}`, () => getJson(url));
    Object.assign(entities, d.entities);
  }

  // Wikimedia Pageviews: son 12 tam ay, tr + en
  const now = new Date();
  const endMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const startMonth = new Date(Date.UTC(endMonth.getUTCFullYear() - 1, endMonth.getUTCMonth() + 1, 1));
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const range = `${ymd(startMonth)}00/${ymd(endMonth)}00`;

  async function views(project, title) {
    if (!title) return 0;
    const t = encodeURIComponent(title.replace(/ /g, "_"));
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${project}/all-access/user/${t}/monthly/${range}`;
    const d = await cachedJson(`pv|${url}`, async () => {
      await sleep(PAGEVIEW_DELAY_MS); // nazik ol: önbellekte olmayan her istekten önce
      return getJson(url);
    });
    return (d?.items ?? []).reduce((sum, it) => sum + it.views, 0);
  }

  // Görüntülenme sorgusu pahalı (madde başına 2 istek); önce ucuz olan dil
  // sayısıyla en bilinen adayları ayır, yalnızca onları sor
  const withLinks = items
    .map((it) => {
      const ent = entities[it.qid] ?? {};
      const sitelinks = Object.keys(ent.sitelinks ?? {}).filter((k) => k.endsWith("wiki") && k !== "commonswiki").length;
      return { ...it, ent, sitelinks };
    })
    .filter((it) => it.sitelinks >= 2)
    .sort((a, b) => b.sitelinks - a.sitelinks)
    .slice(0, PAGEVIEW_CANDIDATES);
  console.log(`  görüntülenmesi sorulacak: ${withLinks.length}`);

  const scored = await pool(withLinks, 2, async (it) => {
    const { ent, sitelinks } = it;
    const tr = await views("tr.wikipedia", ent.sitelinks?.trwiki?.title);
    const en = await views("en.wikipedia", ent.sitelinks?.enwiki?.title);
    const total = tr + en;
    // Görüntülenme ağırlıklı; dil sayısı uluslararası bilinirliği yansıtır
    const score = Math.round((Math.log10(total + 10) + 0.8 * Math.log10(sitelinks + 1)) * 100) / 100;
    return { ...it, views: total, score };
  });

  // Asgari bilinirlik: birkaç dilde maddesi ya da kayda değer okunması olsun
  const ranked = scored
    .filter((x) => x.sitelinks >= 3 || x.views >= 5000)
    .filter((x) => x.category !== "semt" || x.score >= SEMT_MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  const counts = {};
  const chosen = [];
  for (const x of ranked) {
    if (chosen.length >= cfg.take) break;
    if ((counts[x.category] ?? 0) >= CATEGORY_CAP[x.category]) continue;
    // Çok yakın iki öğeden (ör. cami ve avlusu) daha popüler olanı yeter
    if (chosen.some((c) => haversineM(c.pos, x.pos) < 60)) continue;
    counts[x.category] = (counts[x.category] ?? 0) + 1;
    chosen.push(x);
  }
  console.log(`  seçilen: ${chosen.length}`, counts);

  return chosen.map((x, rank) => {
    const name = RENAME[x.qid] ?? x.ent.labels?.tr?.value ?? x.tags["name:tr"] ?? x.tags.name;
    const desc = x.ent.descriptions?.tr?.value ?? x.ent.descriptions?.en?.value ?? "";
    return {
      id: `${cfg.prefix}-${slug(name)}`,
      name,
      category: x.category,
      lat: Math.round(x.pos[0] * 1e6) / 1e6,
      lng: Math.round(x.pos[1] * 1e6) / 1e6,
      district: x.tags["addr:district"] ?? x.tags["addr:suburb"] ?? "",
      description: desc ? desc[0].toLocaleUpperCase("tr") + desc.slice(1) + "." : "",
      // En popüler müzelere ve çok bilinen tarihi yerlere daha uzun süre ayır
      durationMin:
        x.category === "muze" && rank < 10
          ? 120
          : x.category === "tarih" && x.score >= 6.5
            ? 90
            : DURATION[x.category],
      price: price(x.category, x.tags, x.qid),
      hours: parseOpeningHours(x.tags.opening_hours),
      tags: [x.tags.historic, x.tags.tourism, x.tags.leisure, x.tags.amenity].filter(Boolean),
      osmId: x.osmId,
      wikidata: x.qid,
      source: "populer",
      popularity: { views: x.views, sitelinks: x.sitelinks, score: x.score },
    };
  });
}

// ---------- Yeme-içme ----------

async function food(cityId, cfg) {
  const list = FOOD[cityId] ?? [];
  if (!list.length) return [];
  const [s, w, n, e] = cfg.foodBbox;
  const bb = `(${s},${w},${n},${e})`;
  const names = list.map((f) => foldTurkish(f.pattern)).join("|");
  const query = `[out:json][timeout:180];
(
  nwr["name"~"${names}",i]["amenity"~"^(restaurant|cafe|fast_food|ice_cream|pub|bar)$"]${bb};
  nwr["name"~"${names}",i]["shop"~"^(pastry|confectionery|bakery|coffee|deli)$"]${bb};
);
out center tags;`;
  const data = await overpass(query);

  const candidates = (elements, f) => {
    const re = new RegExp(foldTurkish(f.pattern), "i");
    return elements.filter((el) => re.test(el.tags?.name ?? "") && center(el));
  };

  /**
   * Konum ipucu varsa ona en yakın aday. Yoksa adaylar birbirine yakınsa
   * (tek mekan) en kısa adlı olan; uzak şubeler varsa hangisinin ödüllü
   * olduğu bilinemez, "belirsiz" döner.
   */
  const best = (elements, f, maxM) => {
    const found = candidates(elements, f);
    if (!found.length) return null;
    if (f.near) {
      return (
        found
          .map((el) => ({ el, d: haversineM(center(el), f.near) }))
          .filter((m) => m.d < maxM)
          .sort((a, b) => a.d - b.d)[0] ?? null
      );
    }
    const spread = Math.max(...found.map((el) => haversineM(center(el), center(found[0]))));
    if (spread > 1500) return { ambiguous: found.length };
    const el = [...found].sort((a, b) => a.tags.name.length - b.tags.name.length)[0];
    return { el, d: 0 };
  };

  // Etiketle bulunamayanlar için etiketsiz arama (ör. Masabaşı'nda restoran
  // etiketi yok). Yanlış eşleşmeyi önlemek için yalnızca konumu bilinenler,
  // daha dar mesafeyle.
  const missing = list.filter((f) => f.near && !best(data.elements, f, 3000));
  let untagged = [];
  if (missing.length) {
    const q2 = `[out:json][timeout:120];
nwr["name"~"${missing.map((f) => foldTurkish(f.pattern)).join("|")}",i][!"highway"][!"landuse"][!"military"]${bb};
out center tags;`;
    untagged = (await overpass(q2)).elements;
  }

  const out = [];
  for (const f of list) {
    const match = best(data.elements, f, 3000) ?? (f.near ? best(untagged, f, 1500) : null);
    if (!match) {
      console.log(`  ✗ OSM'de bulunamadı, atlandı: ${f.pattern}`);
      continue;
    }
    if (match.ambiguous) {
      console.log(`  ? belirsiz (${match.ambiguous} uzak şube), atlandı: ${f.pattern}`);
      continue;
    }
    const { el } = match;
    const pos = center(el);
    console.log(`  ✓ ${f.pattern} → ${el.tags.name}${f.near ? ` (${Math.round(match.d)} m)` : ""}`);
    // OSM adı bozuk yazılmışsa (ör. küçük harf) küratörlü adı kullan
    const name = f.name ?? el.tags.name;
    out.push({
      id: `${cfg.prefix}-${slug(name)}`,
      name,
      category: f.category,
      lat: Math.round(pos[0] * 1e6) / 1e6,
      lng: Math.round(pos[1] * 1e6) / 1e6,
      district: el.tags["addr:district"] ?? el.tags["addr:suburb"] ?? "",
      description: f.description,
      durationMin: f.category === "kafe" ? 30 : 60,
      price: { ...f.price, confidence: "tahmini", lastVerified: null },
      hours: parseOpeningHours(el.tags.opening_hours),
      // "kahvalti" etiketi planlayıcıda güne başta yerleştirir
      tags: [...(f.tags ?? []), el.tags.cuisine, el.tags.amenity ?? el.tags.shop].filter(Boolean),
      mustTry: f.mustTry,
      osmId: `${el.type}/${el.id}`,
      source: "kurator",
      ...(f.distinction ? { distinction: f.distinction } : {}),
    });
  }
  return out;
}

// ---------- Çalıştır ----------

const selected = process.argv[2] ? [process.argv[2]] : Object.keys(CITIES);
for (const cityId of selected) {
  const cfg = CITIES[cityId];
  if (!cfg) throw new Error(`Bilinmeyen şehir: ${cityId}`);
  console.log(`\n========== ${cityId} ==========`);
  const places = [...(await attractions(cityId, cfg)), ...(await food(cityId, cfg))];

  // Kimlikler benzersiz olsun
  const seen = new Map();
  for (const p of places) {
    const k = seen.get(p.id) ?? 0;
    seen.set(p.id, k + 1);
    if (k) p.id = `${p.id}-${k + 1}`;
  }

  const file = `data/cities/${cityId}.places.json`;
  writeFileSync(
    file,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sources: "© OpenStreetMap katkıcıları (ODbL); Wikidata (CC0); Wikimedia Pageviews (CC0)",
        places,
      },
      null,
      1,
    ) + "\n",
  );
  console.log(`Yazıldı: ${file} (${places.length} mekan)`);
}
