import { planTrip } from "@/lib/agents/orchestrator";
import { getCity } from "@/lib/data/cities";
import { TripRequestSchema } from "@/lib/types";

export async function POST(request: Request) {
  const parsed = TripRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Geçersiz istek", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  if (!getCity(parsed.data.cityId)) {
    return Response.json({ error: "Bu şehir henüz desteklenmiyor" }, { status: 404 });
  }

  try {
    return Response.json(await planTrip(parsed.data));
  } catch (error) {
    console.error("Plan oluşturulamadı:", error);
    return Response.json({ error: "Plan oluşturulamadı" }, { status: 500 });
  }
}
