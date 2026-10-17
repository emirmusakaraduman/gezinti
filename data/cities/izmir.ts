import type { City, Place } from "@/lib/types";
import { FREE, SUNDAY, est, hours, mergePlaces } from "./helpers";
import generated from "./izmir.places.json";

/**
 * Açık veride karşılığı olmayan deneyimler. Asıl liste izmir.places.json'dan
 * gelir (scripts/fetch-places.mjs).
 */
const experiences: Place[] = [
  {
    id: "izm-kordon",
    name: "Kordon Boyu",
    category: "semt",
    lat: 38.43,
    lng: 27.138,
    district: "Alsancak",
    description: "Körfez kıyısında yürüyüş ve gün batımı.",
    durationMin: 90,
    price: FREE,
    hours: null,
    tags: ["deniz", "yuruyus", "gece"],
    source: "kurator",
  },
  {
    id: "izm-kizlaragasi",
    name: "Kızlarağası Hanı'nda Kahve",
    category: "kafe",
    lat: 38.4199,
    lng: 27.1325,
    district: "Konak",
    description: "18. yüzyıl hanının avlusunda Türk kahvesi.",
    durationMin: 30,
    price: est(100, 250),
    hours: hours("09:00", "19:00", [SUNDAY]),
    tags: ["tarihi", "kahve"],
    mustTry: "Kumda pişmiş Türk kahvesi",
    source: "kurator",
  },
  {
    id: "izm-kumru",
    name: "Alsancak'ta Kumru",
    category: "yemek",
    lat: 38.4348,
    lng: 27.1452,
    district: "Alsancak",
    description: "Sucuklu, kaşarlı İzmir kumrusu; bölgedeki köklü kumrucular.",
    durationMin: 30,
    price: est(200, 400),
    hours: hours("10:00", "23:00"),
    tags: ["sokak-lezzeti", "yoresel"],
    mustTry: "Karışık kumru ve ayran",
    source: "kurator",
  },
];

export const izmir: City = {
  id: "izmir",
  name: "İzmir",
  center: { lat: 38.4237, lng: 27.1428 },
  hasGtfs: true,
  transitFare: est(20, 35),
  carCostPerKm: est(4, 7),
  parkingPerDay: est(200, 500),
  places: mergePlaces(generated.places, experiences),
};
