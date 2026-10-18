// Veri betiklerinin ortak yardımcıları: istemci kimliği, bekleme, Overpass isteği, mesafe.

export const USER_AGENT = "gezinti/0.1 (kisisel proje; https://github.com/emirmusakaraduman/gezinti)";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/**
 * Overpass sorgusu; 429/502/503/504'te artan beklemeyle yeniden dener
 * (genel sunucu sık dolar). Başarısızlıkta hata fırlatır.
 */
export async function overpass(query, { tries = 6, backoffMs = 8000 } = {}) {
  for (let i = 1; ; i++) {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (res.ok) return res.json();
    if (i >= tries || ![429, 502, 503, 504].includes(res.status)) throw new Error(`Overpass ${res.status}`);
    console.warn(`  Overpass ${res.status}, ${Math.round((backoffMs * i) / 1000)} sn sonra yeniden deneniyor`);
    await sleep(backoffMs * i);
  }
}

/** İki nokta arası kuş uçuşu mesafe (m); boylam `lng` ya da `lon` olabilir */
export function haversineM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const lngOf = (p) => p.lng ?? p.lon;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(lngOf(b) - lngOf(a)) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
