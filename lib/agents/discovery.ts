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
- Bütçe kişi başı değil toplamdır; fiyatlar kişi başıdır ve aralık olarak verilir. Tahmini üst sınır bütçeyi aşmasın; ücretsiz yerlerle dengele.
- Aynı mekanı iki kez seçme.
- notes alanında seçtiğin önemli yerler için kısa, pratik bir ipucu yaz (ör. "Sabah erken git, kuyruk olur").
- summary alanında planı 2-3 cümleyle, samimi bir Türkçeyle özetle.`;

function candidatePayload(city: City, exclude: Set<string>) {
  return city.places
    .filter((p) => !exclude.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      district: p.district,
      lat: p.lat,
      lng: p.lng,
      durationMin: p.durationMin,
      priceTL: { min: p.price.min, max: p.price.max, confidence: p.price.confidence },
      hours: p.hours,
      tags: p.tags,
      mustTry: p.mustTry,
    }));
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
    feedback?.messages.length
      ? `Önceki planla ilgili sorunlar, bunları düzelt:\n- ${feedback.messages.join("\n- ")}`
      : null,
    `Aday mekanlar (JSON):\n${JSON.stringify(candidatePayload(city, exclude))}`,
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

  // İlgi alanına uyan önce, sonra ucuz olan önce
  const score = (p: Place) => (interest.has(p.category) ? 1000 : 0) - p.price.max / 10;
  const sights = pool.filter((p) => !isMeal(p)).sort((a, b) => score(b) - score(a));
  const meals = pool.filter(isMeal).sort((a, b) => a.price.max - b.price.max);

  // Ücretli kalemler için günlük pay (ulaşım ve otopark için %25 ayrılır)
  const dailyAllowance = (req.budget * 0.75) / req.days;
  const cost = (p: Place) => p.price.max * req.travelers;

  /** Listeden o gün açık ve bütçeye sığan ilk `count` mekanı çıkar */
  const take = (list: Place[], count: number, dow: number, spent: { v: number }) => {
    const picked: Place[] = [];
    for (let i = 0; i < list.length && picked.length < count; ) {
      const p = list[i];
      const open = !p.hours?.closedDays.includes(dow);
      if (open && spent.v + cost(p) <= dailyAllowance) {
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
    // Yemek her gün olsun: önce en ucuz bir öğünü ayır
    const firstMeal = take(meals, 1, dow, spent);
    const [seed] = take(sights, 1, dow, spent);
    if (!seed) {
      meals.push(...firstMeal);
      break;
    }
    const day = [seed];
    // Tohuma en yakın gezi noktalarını ekle
    sights.sort((a, b) => haversineKm(seed, a) - haversineKm(seed, b));
    day.push(...take(sights, SIGHTS_PER_DAY - 1, dow, spent));
    // Günün merkezine en yakın yemek durakları
    const centroid = {
      lat: day.reduce((s, p) => s + p.lat, 0) / day.length,
      lng: day.reduce((s, p) => s + p.lng, 0) / day.length,
    };
    meals.sort((a, b) => haversineKm(centroid, a) - haversineKm(centroid, b));
    day.push(...firstMeal, ...take(meals, MEALS_PER_DAY - 1, dow, spent));
    days.push(day.map((p) => p.id));
  }

  return {
    days,
    summary: `${city.name} için ilgi alanlarına göre ${days.length} günlük bir plan hazırlandı. Aynı gündeki yerler birbirine yakın seçildi.`,
    notes: new Map(),
    plannedBy: "sezgisel",
  };
}

export async function selectPlaces(
  city: City,
  req: TripRequest,
  feedback?: Feedback,
): Promise<Selection> {
  const hasCredentials =
    !!process.env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_AUTH_TOKEN;
  if (!hasCredentials) return selectHeuristic(city, req, feedback);

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
