import type { City, Place } from "@/lib/types";
import { FREE, MONDAY, est, hours, mergePlaces } from "./helpers";
import generated from "./ankara.places.json";

/**
 * Açık veride karşılığı olmayan deneyimler. Asıl liste ankara.places.json'dan
 * gelir (scripts/fetch-places.mjs).
 */
const experiences: Place[] = [
  {
    id: "ank-hamamonu",
    name: "Hamamönü",
    category: "semt",
    lat: 39.9346,
    lng: 32.864,
    district: "Altındağ",
    description: "Restore edilmiş Ankara evleri, kafeler ve el sanatları.",
    durationMin: 75,
    price: FREE,
    hours: null,
    tags: ["yuruyus", "fotograf"],
    source: "kurator",
  },
  {
    id: "ank-rahmikoc",
    name: "Rahmi M. Koç Müzesi",
    category: "muze",
    lat: 39.93707,
    lng: 32.86343,
    district: "Altındağ",
    description: "Çengelhan'da ulaşım ve sanayi tarihi koleksiyonu.",
    durationMin: 75,
    price: est(100, 250),
    hours: hours("10:00", "17:00", [MONDAY]),
    tags: ["muze", "aile"],
    source: "kurator",
  },
  {
    id: "ank-atakule",
    name: "Atakule",
    category: "manzara",
    lat: 39.8858,
    lng: 32.8556,
    district: "Çankaya",
    description: "Şehre 360 derece bakan seyir terası.",
    durationMin: 45,
    price: est(100, 300),
    hours: hours("10:00", "22:00"),
    tags: ["manzara", "gece"],
    source: "kurator",
  },
  {
    id: "ank-ankaratava",
    name: "Ulus'ta Ankara Tava",
    category: "yemek",
    lat: 39.9419,
    lng: 32.8547,
    district: "Altındağ",
    description: "Ulus'un esnaf lokantalarında yöresel Ankara tavası.",
    durationMin: 45,
    price: est(400, 800),
    hours: hours("11:00", "21:00"),
    tags: ["yoresel", "esnaf-lokantasi"],
    mustTry: "Ankara tava ve aşure",
    source: "kurator",
  },
  {
    id: "ank-simit",
    name: "Ankara Simidi Kahvaltısı",
    category: "kafe",
    lat: 39.9208,
    lng: 32.8541,
    district: "Kızılay",
    description: "Kızılay'da gevrek Ankara simidiyle çay.",
    durationMin: 30,
    price: est(60, 150),
    hours: hours("07:00", "12:00"),
    tags: ["kahvalti", "ucuz"],
    mustTry: "Taze Ankara simidi",
    source: "kurator",
  },
];

export const ankara: City = {
  id: "ankara",
  name: "Ankara",
  center: { lat: 39.9334, lng: 32.8597 },
  hasGtfs: true,
  transitFare: est(20, 35),
  carCostPerKm: est(4, 7),
  parkingPerDay: est(150, 400),
  places: mergePlaces(generated.places, experiences),
};
