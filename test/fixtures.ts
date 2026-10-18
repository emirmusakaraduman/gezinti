/** Testler için küçük, elle kurulmuş mekan ve şehir verisi */
import type { City, Place, PriceRange, TripRequest } from "@/lib/types";

export const range = (min: number, max = min): PriceRange => ({
  min,
  max,
  confidence: "tahmini",
  lastVerified: null,
});

let seq = 0;

/** Varsayılanlarla bir mekan; enlem/boylam ve diğer alanlar ezilebilir */
export function place(overrides: Partial<Place> = {}): Place {
  seq++;
  return {
    id: `p${seq}`,
    name: `Mekan ${seq}`,
    category: "tarih",
    lat: 41.0,
    lng: 29.0,
    district: "",
    description: "",
    durationMin: 60,
    price: range(0),
    hours: null,
    tags: [],
    ...overrides,
  };
}

/** 09:00-18:00 açık, verilen günlerde kapalı (0 = Pazar) */
export const hoursFn = (closedDays: number[] = []) => ({ open: "09:00", close: "18:00", closedDays });

export function city(places: Place[], overrides: Partial<City> = {}): City {
  return {
    id: "test",
    name: "Test",
    center: { lat: 41.0, lng: 29.0 },
    hasGtfs: false,
    transitFare: range(30, 40),
    carCostPerKm: range(5),
    parkingPerDay: range(200, 400),
    places,
    ...overrides,
  };
}

export function request(overrides: Partial<TripRequest> = {}): TripRequest {
  return {
    cityId: "test",
    days: 1,
    // Salı
    startDate: "2026-10-20",
    travelers: 1,
    budget: 1000,
    transport: "toplu_tasima",
    interests: ["tarih", "muze", "yemek"],
    ...overrides,
  };
}
