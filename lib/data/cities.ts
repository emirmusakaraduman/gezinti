import { ankara } from "@/data/cities/ankara";
import { istanbul } from "@/data/cities/istanbul";
import { izmir } from "@/data/cities/izmir";
import { CitySchema, type City } from "@/lib/types";

// Veriyi yüklerken şemaya karşı doğrula; hatalı veri sessizce geçmesin.
const CITIES: Record<string, City> = Object.fromEntries(
  [istanbul, izmir, ankara].map((c) => {
    const parsed = CitySchema.parse(c);
    return [parsed.id, parsed];
  }),
);

export function getCity(id: string): City | undefined {
  return CITIES[id];
}

export function listCities(): { id: string; name: string }[] {
  return Object.values(CITIES).map(({ id, name }) => ({ id, name }));
}
