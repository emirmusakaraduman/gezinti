/**
 * Keşif ajanı.
 *
 * Şehrin küratörlü mekan listesinden kullanıcıya uygun olanları seçer ve
 * günlere dağıtır. Claude yalnızca verilen aday listesinden seçim yapar;
 * dönen her ID veritabanına karşı doğrulanır (uydurma mekan olmasın diye).
 *
 * ANTHROPIC_API_KEY yoksa veya çağrı başarısız olursa sezgisel yönteme düşer.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { addDays, haversineKm, weekday } from "@/lib/geo";
import { ticketPrice } from "@/lib/pricing";
import type { City, Place, TripRequest } from "@/lib/types";

export const MODEL = "claude-opus-5-5";

export interface Selection {
  /** days[i] = i. gün için mekan ID'leri */
  days: string[][];
  summary: string;
  notes: Map<string, string>;
  plannedBy: "claude" | "sezgisel";
}

/** Önceki tur planından gelen geri bildirim (bütçe aşımı, kapalı mekanlar) */
export interface Feedback {
  messages: string[];
  /** Bu turda kesinlikle seçilmemesi gereken mekanlar */
  excludeIds: string[];
}

const SelectionSchema = z.strictObject({
  days: z.array(
    z.strictObject({
      day: z.number().int(),
      placeIds: z.array(z.string()),
    }),
  ),
  notes: z.array(
    z.strictObject({
      placeId: z.string(),
      note: z.string(),
    }),
  ),
  summary: z.string(),
});

const SYSTEM_PROMPT = `Sen Gezinti uygulamasının keşif ajanısın. Türkiye'de bir şehre giden gezgin için gezilecek yerleri ve yenecek yemekleri seçip günlere dağıtıyorsun.

Kurallar:
- Yalnızca sana verilen aday listesindeki ID'leri kullan. Listede olmayan bir mekan önerme.
- Her gün için 3-5 gezi noktası ve 1-2 yemek/kafe durağı seç. Günü 09:30'da başlayıp en geç 21:30'da bitecek şekilde süreleri (durationMin) ve yolları hesaba kat.
- Aynı gündeki yerler coğrafi olarak birbirine yakın olsun (district ve koordinatlara bak). Toplu taşımayla gezen biri için bu daha da önemli.
- Mekanın kapalı olduğu günü (closedDays, 0=Pazar) o güne koyma.
- Kullanıcının ilgi alanlarına öncelik ver, ama her gün en az bir yöresel lezzet olsun.
- Gerçekten tavsiye edilecek yerleri seç: popularity alanı (Wikipedia okunma ve dil sayısından hesaplanan puan; yüksek = daha bilinen) yüksek olanları ve source "kurator" olan (elle seçilmiş köklü mekanlar) yerleri tercih et. Az bilinen bir yeri ancak güzergaha çok iyi oturuyorsa seç.
- Yemek için michelin alanı olan yerleri öne çıkar: michelin-bib makul fiyata çok iyi yemektir ve çoğu bütçeye uyar; yıldızlı restoranlar pahalıdır, yalnızca bütçe rahatça elveriyorsa ve en fazla bir öğün için öner.
- Bütçe kişi başı değil toplamdır; fiyatlar kişi başıdır ve aralık olarak verilir. Tahmini üst sınır bütçeyi aşmasın; ücretsiz yerlerle dengele.
- Aynı mekanı iki kez seçme.
- notes alanında seçtiğin önemli yerler için kısa, pratik bir ipucu yaz (ör. "Sabah erken git, kuyruk olur").
- summary alanında planı 2-3 cümleyle, samimi bir Türkçeyle özetle.`;

function candidatePayload(city: City, req: TripRequest, exclude: Set<string>) {
  return city.places
    .filter((p) => !exclude.has(p.id))
    .map((p) => {
      const t = ticketPrice(p, req);
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        district: p.district,
        lat: p.lat,
        lng: p.lng,
        durationMin: p.durationMin,
        // Müzekart varsa geçen yerler 0 TL
        priceTL: { min: t.min, max: t.max, confidence: t.confidence },
        hours: p.hours,
        tags: p.tags,
        mustTry: p.mustTry,
        source: p.source,
        popularity: p.popularity?.score,
        michelin: p.distinction ? `${p.distinction.kind} (${p.distinction.year})` : undefined,
      };
    });
}

async function selectWithClaude(
  city: City,
  req: TripRequest,
  feedback?: Feedback,
): Promise<Selection> {
  const client = new Anthropic();
  const exclude = new Set(feedback?.excludeIds ?? []);

  const userContent = [
    `Şehir: ${city.name}`,
    `Gün sayısı: ${req.days}, başlangıç: ${req.startDate}`,
    `Kişi sayısı: ${req.travelers}`,
    `Toplam bütçe: ${req.budget} TL (konaklama hariç)`,
    `Ulaşım: ${req.transport === "araba" ? "araba" : "toplu taşıma"}`,
    `İlgi alanları: ${req.interests.join(", ")}`,
    req.notes ? `Kullanıcı notu: ${req.notes}` : null,
    `Müzekart: ${req.hasMuzekart ? "var (Müzekart geçen yerler ücretsiz)" : "yok"}. Fiyatlar T.C. vatandaşı tarifesidir.`,
    feedback?.messages.length
      ? `Önceki planla ilgili sorunlar, bunları düzelt:\n- ${feedback.messages.join("\n- ")}`
      : null,
    `Aday mekanlar (JSON):\n${JSON.stringify(candidatePayload(city, req, exclude))}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: z.toJSONSchema(SelectionSchema) },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude isteği reddetti");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Claude yanıtı yarıda kesildi");
  }
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = SelectionSchema.parse(JSON.parse(text));

  // Halüsinasyon koruması: yalnızca bilinen, hariç tutulmamış, tekrarsız ID'ler
  const known = new Set(city.places.map((p) => p.id));
  const used = new Set<string>();
  const days: string[][] = Array.from({ length: req.days }, () => []);
  for (const d of parsed.days) {
    const idx = d.day - 1;
    if (idx < 0 || idx >= req.days) continue;
    for (const id of d.placeIds) {
      if (known.has(id) && !exclude.has(id) && !used.has(id)) {
        used.add(id);
        days[idx].push(id);
      }
    }
  }
  if (days.every((d) => d.length === 0)) {
    throw new Error("Claude geçerli mekan seçmedi");
  }

  return {
    days,
    summary: parsed.summary,
    notes: new Map(parsed.notes.map((n) => [n.placeId, n.note])),
    plannedBy: "claude",
  };
}

// ---------- Sezgisel yedek ----------

/**
 * Popülerlik puanı (Wikipedia okunma + dil sayısı; ~3-8 arası). Elle seçilmiş
 * tavsiyelerin puanı yok; onlar bilinçli seçildiği için iyi bir varsayılan alır.
 */
const CURATED_POPULARITY = 6;
/** Michelin ödülleri yeme-içmede popülerlik puanının yerini tutar */
const DISTINCTION_SCORE: Record<NonNullable<Place["distinction"]>["kind"], number> = {
  "michelin-2-yildiz": 8.5,
  "michelin-yildiz": 8,
  "michelin-bib": 7.5,
  "michelin-tavsiye": 6.8,
};
export const popularity = (p: Place) =>
  p.popularity?.score ?? (p.distinction ? DISTINCTION_SCORE[p.distinction.kind] : CURATED_POPULARITY);

/** 1 popülerlik puanı (×60) ≈ 1,5 km */
const DISTANCE_PENALTY_PER_KM = 40;

const SIGHTS_PER_DAY = 4;
const MEALS_PER_DAY = 2;

function selectHeuristic(
  city: City,
  req: TripRequest,
  feedback?: Feedback,
): Selection {
  const exclude = new Set(feedback?.excludeIds ?? []);
  const isMeal = (p: Place) => p.category === "yemek" || p.category === "kafe";
  const interest = new Set(req.interests);
  const pool = city.places.filter((p) => !exclude.has(p.id));

  // İlgi alanı önce, sonra popülerlik; fiyat yalnızca küçük bir etken
  const score = (p: Place) =>
    (interest.has(p.category) ? 1000 : 0) + popularity(p) * 60 - p.price.max / 20;
  const sights = pool.filter((p) => !isMeal(p)).sort((a, b) => score(b) - score(a));
  // Yemekte de en çok tavsiye edilen önce; pahalı yerler bütçe payına
  // sığmazsa take() zaten atlar
  const mealScore = (p: Place) => popularity(p) * 60 - p.price.max / 20;
  const meals = pool.filter(isMeal).sort((a, b) => mealScore(b) - mealScore(a));

  // Ücretli kalemler için günlük pay (ulaşım ve otopark için %25 ayrılır)
  const dailyAllowance = (req.budget * 0.75) / req.days;
  // Seçimde aralığın ortası; üst ucu bütçe ajanı ayrıca kontrol edip uyarır.
  // Üst uçla seçim, ilk öğünden sonra günlük payı tüketiyordu.
  const cost = (p: Place) => {
    const t = ticketPrice(p, req);
    return ((t.min + t.max) / 2) * req.travelers;
  };

  /** Listeden o gün açık, bütçeye sığan (ve koşula uyan) ilk `count` mekanı çıkar */
  const take = (
    list: Place[],
    count: number,
    dow: number,
    spent: { v: number },
    accept: (p: Place) => boolean = () => true,
  ) => {
    const picked: Place[] = [];
    for (let i = 0; i < list.length && picked.length < count; ) {
      const p = list[i];
      const open = !p.hours?.closedDays.includes(dow);
      if (accept(p) && open && spent.v + cost(p) <= dailyAllowance) {
        spent.v += cost(p);
        picked.push(...list.splice(i, 1));
      } else {
        i++;
      }
    }
    return picked;
  };

  const days: string[][] = [];
  for (let d = 0; d < req.days; d++) {
    const dow = weekday(addDays(req.startDate, d));
    const spent = { v: 0 };
    // Yemek her gün olsun: önce bütçeye sığan en çok tavsiye edilen öğle
    // yemeğini ayır (kafe/tatlıcı değil; onlar ara öğün sayılır)
    const firstMeal = take(meals, 1, dow, spent, (p) => p.category === "yemek");
    const [seed] = take(sights, 1, dow, spent);
    if (!seed) {
      meals.push(...firstMeal);
      break;
    }
    const day = [seed];
    // Tohuma göre popülerlik ile yakınlığı dengele: biraz uzak ama çok bilinen
    // bir yer, hemen yandaki az bilinen yerin önüne geçebilsin
    const nearScore = (p: Place) => score(p) - DISTANCE_PENALTY_PER_KM * haversineKm(seed, p);
    sights.sort((a, b) => nearScore(b) - nearScore(a));
    day.push(...take(sights, SIGHTS_PER_DAY - 1, dow, spent));
    sights.sort((a, b) => score(b) - score(a));
    // Günün merkezine en yakın yemek durakları
    const centroid = {
      lat: day.reduce((s, p) => s + p.lat, 0) / day.length,
      lng: day.reduce((s, p) => s + p.lng, 0) / day.length,
    };
    const nearMeal = (p: Place) => mealScore(p) - DISTANCE_PENALTY_PER_KM * haversineKm(centroid, p);
    meals.sort((a, b) => nearMeal(b) - nearMeal(a));
    day.push(...firstMeal, ...take(meals, MEALS_PER_DAY - 1, dow, spent));
    meals.sort((a, b) => mealScore(b) - mealScore(a));
    days.push(day.map((p) => p.id));
  }

  return {
    days,
    summary: `${city.name} için ilgi alanlarına göre ${days.length} günlük bir plan hazırlandı. Aynı gündeki yerler birbirine yakın seçildi.`,
    notes: new Map(),
    plannedBy: "sezgisel",
  };
}

/** AI ajanları için kimlik bilgisi tanımlı mı (yoksa uygulama demo modunda çalışır) */
export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_AUTH_TOKEN;
}

export async function selectPlaces(
  city: City,
  req: TripRequest,
  feedback?: Feedback,
): Promise<Selection> {
  if (!aiConfigured()) return selectHeuristic(city, req, feedback);

  try {
    return await selectWithClaude(city, req, feedback);
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error(`Claude API hatası ${error.status}: ${error.message}`);
    } else {
      console.error("Keşif ajanı hatası:", error);
    }
    return selectHeuristic(city, req, feedback);
  }
}
