// Veri betiklerinin (build-gtfs, fetch-places) metin ve ayrıştırma yardımcıları.
// Ayrı modülde: betikler içe aktarılınca çalışmaya başladığı için test
// edilebilmeleri gerekiyordu.

// ---------- Kod çözme ----------

// Windows-1252'de 0x80-0x9F aralığı Latin-1'den farklıdır
const CP1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";

/** "KADIKÃ–Y" gibi çift kodlanmış metni düzeltir */
export function fixMojibake(s) {
  if (!/[ÃÄÅ][\u0080-ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/.test(s)) return s;
  const bytes = [];
  for (const ch of s) {
    const code = ch.codePointAt(0);
    const hi = CP1252_HIGH.indexOf(ch);
    if (hi >= 0) bytes.push(0x80 + hi);
    else if (code <= 0xff) bytes.push(code);
    else return s; // 1252'ye geri çevrilemiyor, olduğu gibi bırak
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return s;
  }
}

/** UTF-8 değilse Windows-1254 (Türkçe) say */
export function decode(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1254").decode(buf);
  }
}

// ---------- GTFS alanları ----------

/** "41.0191" veya bozuk "410.191.700.005.564" → 41.0191700005564 */
export function parseCoord(raw) {
  if (!raw) return NaN;
  const s = raw.replace(",", ".");
  if ((s.match(/\./g) ?? []).length <= 1) return Number(s);
  // Türkiye'de hem enlem hem boylam iki basamaklı tam kısım taşır
  const digits = s.replace(/\./g, "");
  return Number(`${digits.slice(0, 2)}.${digits.slice(2)}`);
}

/** "HH:MM[:SS]" → gün başından saniye (24'ü aşabilir); geçersizse null */
export function parseTime(raw) {
  if (!raw) return null;
  const [h, m, s = "0"] = raw.split(":");
  const t = Number(h) * 3600 + Number(m) * 60 + Number(s);
  return Number.isFinite(t) ? t : null;
}

// ---------- Ad eşleştirme ----------

export const slug = (s) =>
  s
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c])
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/**
 * Arama ifadesini Türkçe karakter farklarına duyarsız yapar: OSM'de adlar
 * sıkça ASCII yazılıyor ("Haci Abdullah", "Cukuraga"). Overpass'ın büyük/
 * küçük harf duyarsızlığı Türkçe harfleri kapsamadığı için iki hal de eklenir.
 */
const TR_FOLD = { ı: "ıiIİ", i: "ıiIİ", ş: "şsŞS", s: "şsŞS", ç: "çcÇC", c: "çcÇC", ğ: "ğgĞG", g: "ğgĞG", ö: "öoÖO", o: "öoÖO", ü: "üuÜU", u: "üuÜU" };
export function foldTurkish(pattern) {
  let out = "";
  let inClass = false;
  for (const ch of pattern) {
    if (ch === "[") inClass = true;
    if (ch === "]") inClass = false;
    const lower = ch.toLocaleLowerCase("tr");
    out += !inClass && TR_FOLD[lower] ? `[${TR_FOLD[lower]}]` : ch;
  }
  return out;
}

// ---------- Açılış saatleri ----------

const DAY = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
const ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function expandDays(spec) {
  const days = new Set();
  for (const part of spec.split(",")) {
    const [a, b] = part.trim().split("-");
    if (!(a in DAY)) return null;
    if (!b) {
      days.add(DAY[a]);
      continue;
    }
    if (!(b in DAY)) return null;
    let i = ORDER.indexOf(a);
    for (let guard = 0; guard < 7; guard++) {
      days.add(DAY[ORDER[i]]);
      if (ORDER[i] === b) break;
      i = (i + 1) % 7;
    }
  }
  return days;
}

const TIME = String.raw`\d{1,2}:\d{2}`;
const RANGES = new RegExp(String.raw`^(${TIME}-${TIME}(?:\s*,\s*${TIME}-${TIME})*)$`);
const toMin = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/**
 * OSM opening_hours'ın sık görülen biçimlerini çevirir: "Mo-Su 09:00-19:00",
 * "Tu-Su 09:00-17:00; Mo off", tek haneli saat ("9:00"), bir günde birden çok
 * aralık ("08:30-12:15, 14:00-18:30": en erken açılış, en geç kapanış alınır)
 * ve gün listesinde resmi tatil ("Mo-Su,PH"). Mevsimlik ya da anlaşılmayan
 * biçimlerde null döner (yanlış kapalı gün üretmektense bilinmiyor demek).
 */
export function parseOpeningHours(raw) {
  if (!raw) return null;
  if (raw.trim() === "24/7") return null;
  const open = new Set();
  let start = Infinity;
  let end = -Infinity;
  for (const rule of raw.split(";").map((r) => r.trim()).filter(Boolean)) {
    if (/^PH\b/.test(rule) || /\boff$/.test(rule)) continue;
    const firstDigit = rule.search(/\d/);
    if (firstDigit < 0) return null; // saat yok ("Mo-Su")
    const dayPart = rule.slice(0, firstDigit).trim();
    const timePart = rule.slice(firstDigit).trim();
    if (!RANGES.test(timePart)) return null;
    // Resmi tatil gün listesinden çıkarılır; geriye gün kalmalı
    const daySpec = dayPart.replace(/\s/g, "").split(",").filter((d) => d && d !== "PH").join(",");
    if (dayPart && !daySpec) return null;
    const days = daySpec ? expandDays(daySpec) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days) return null;
    days.forEach((d) => open.add(d));
    for (const range of timePart.split(",")) {
      const [s, e] = range.trim().split("-").map(toMin);
      start = Math.min(start, s);
      end = Math.max(end, e === 0 ? 24 * 60 - 1 : e);
    }
  }
  if (!open.size) return null;
  const hhmm = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  return {
    open: hhmm(start),
    close: hhmm(Math.min(end, 23 * 60 + 59)),
    closedDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => !open.has(d)),
  };
}
