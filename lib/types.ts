import { z } from "zod";

// ---------- Şehir verisi ----------

/** TL cinsinden fiyat aralığı. Net fiyat biliniyorsa min === max. */
export const PriceRangeSchema = z.object({
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  /** "net": güncel ve doğrulanmış; "tahmini": eski veya ortalama veri */
  confidence: z.enum(["net", "tahmini"]),
  /** Son doğrulama tarihi (YYYY-AA-GG); bilinmiyorsa null */
  lastVerified: z.string().nullable(),
});
export type PriceRange = z.infer<typeof PriceRangeSchema>;

export const PlaceCategorySchema = z.enum([
  "tarih",
  "muze",
  "doga",
  "manzara",
  "carsi",
  "semt",
  "yemek",
  "kafe",
  "gece",
]);
export type PlaceCategory = z.infer<typeof PlaceCategorySchema>;

/** Haftanın günü: 0 = Pazar ... 6 = Cumartesi (JS Date.getDay ile aynı) */
export const OpeningHoursSchema = z.object({
  open: z.string().regex(/^\d{2}:\d{2}$/),
  close: z.string().regex(/^\d{2}:\d{2}$/),
  closedDays: z.array(z.number().int().min(0).max(6)),
});
export type OpeningHours = z.infer<typeof OpeningHoursSchema>;

export const PlaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: PlaceCategorySchema,
  lat: z.number(),
  lng: z.number(),
  district: z.string(),
  description: z.string(),
  /** Önerilen ziyaret süresi (dakika) */
  durationMin: z.number().int().positive(),
  /** Kişi başı maliyet */
  price: PriceRangeSchema,
  /** null: her zaman açık / bilinmiyor */
  hours: OpeningHoursSchema.nullable(),
  tags: z.array(z.string()),
  /** Yemek mekanları için öne çıkan lezzet */
  mustTry: z.string().optional(),
  osmId: z.string().optional(),
  wikidata: z.string().optional(),
  /**
   * "populer": OSM + Wikipedia popülerliğiyle seçildi;
   * "kurator": elle derlenmiş tavsiye (OSM'de doğrulanmış olabilir)
   */
  source: z.enum(["populer", "kurator"]).optional(),
  /** Popülerlik göstergeleri (yalnızca "populer" kaynaklı yerlerde) */
  popularity: z
    .object({
      /** Son 12 ay Wikipedia görüntülenmesi (tr + en) */
      views: z.number(),
      /** Kaç dilde Wikipedia maddesi var */
      sitelinks: z.number(),
      score: z.number(),
    })
    .optional(),
});
export type Place = z.infer<typeof PlaceSchema>;

export const CitySchema = z.object({
  id: z.string(),
  name: z.string(),
  center: z.object({ lat: z.number(), lng: z.number() }),
  /** Şehir için GTFS verisi var mı (yoksa yürüme + tahmini süre) */
  hasGtfs: z.boolean(),
  /** Toplu taşıma tek biniş ücreti (tam bilet) */
  transitFare: PriceRangeSchema,
  /** Araba için km başı yakıt + yıpranma tahmini */
  carCostPerKm: PriceRangeSchema,
  /** Günlük ortalama otopark maliyeti */
  parkingPerDay: PriceRangeSchema,
  places: z.array(PlaceSchema),
});
export type City = z.infer<typeof CitySchema>;

// ---------- Kullanıcı isteği ----------

export const TransportModeSchema = z.enum(["toplu_tasima", "araba"]);
export type TransportMode = z.infer<typeof TransportModeSchema>;

export const TripRequestSchema = z.object({
  cityId: z.string(),
  days: z.number().int().min(1).max(7),
  /** İlk günün tarihi (YYYY-AA-GG), açılış saatlerini kontrol etmek için */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  travelers: z.number().int().min(1).max(10),
  /** Toplam bütçe (TL), konaklama hariç */
  budget: z.number().positive(),
  transport: TransportModeSchema,
  interests: z.array(PlaceCategorySchema).min(1),
  notes: z.string().max(500).optional(),
});
export type TripRequest = z.infer<typeof TripRequestSchema>;

// ---------- Plan çıktısı ----------

export type LegMode = "yurume" | "toplu_tasima" | "araba";

export type Vehicle =
  | "tramvay"
  | "metro"
  | "tren"
  | "otobus"
  | "vapur"
  | "teleferik"
  | "funikuler";

/** Toplu taşıma yolculuğunun bir adımı (GTFS yönlendiricisinden) */
export interface TransitStep {
  kind: "yurume" | "binis";
  from: string;
  to: string;
  depart: string; // "HH:MM"
  arrive: string;
  durationMin: number;
  /** Binişlerde hat kodu/adı, ör. "T1" veya "KDK-EMN" */
  line?: string;
  lineName?: string;
  vehicle?: Vehicle;
  /** Adımın çizgisi ([lng, lat]) */
  geometry: [number, number][];
  /** Çizgi gerçek yol/hat geometrisi mi, yoksa duraklar arası düz çizgi mi */
  geometryExact: boolean;
}

export interface Leg {
  fromId: string;
  toId: string;
  mode: LegMode;
  distanceKm: number;
  durationMin: number;
  cost: PriceRange;
  /** Süre gerçek veriden mi geldi, yoksa tahmin mi */
  estimated: boolean;
  /** Gerçek yol çizgisi ([lng, lat]); tahminiyse null */
  geometry: [number, number][] | null;
  /** Toplu taşıma ayağı GTFS ile planlandıysa adım adım yolculuk */
  transit?: TransitStep[];
}

export interface Stop {
  place: Place;
  arrival: string; // "HH:MM"
  departure: string;
  note?: string;
}

export interface DayPlan {
  day: number;
  date: string;
  stops: Stop[];
  legs: Leg[];
  cost: PriceRange;
}

export type WarningLevel = "bilgi" | "uyari" | "asim";

export interface PlanWarning {
  level: WarningLevel;
  message: string;
}

export interface BudgetSummary {
  budget: number;
  total: PriceRange;
  breakdown: {
    activities: PriceRange;
    food: PriceRange;
    transport: PriceRange;
    parking: PriceRange;
  };
  /** Tahmini üst sınırın bütçeye oranı */
  usageRatio: number;
  status: "rahat" | "yaklasiyor" | "asabilir" | "asiyor";
  /** Aşım riski varsa tasarruf önerileri */
  savings: { placeId: string; placeName: string; saves: PriceRange }[];
}

export interface TripPlan {
  request: TripRequest;
  cityName: string;
  cityCenter: { lat: number; lng: number };
  days: DayPlan[];
  budget: BudgetSummary;
  warnings: PlanWarning[];
  /** Ajanın planı açıklayan özeti */
  summary: string;
  /** Plan Claude ile mi yoksa yedek sezgisel yöntemle mi seçildi */
  plannedBy: "claude" | "sezgisel";
  /** Bütçe için kaç tur revizyon yapıldı */
  revisions: number;
}
