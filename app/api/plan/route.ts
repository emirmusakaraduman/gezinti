import { EditError } from "@/lib/agents/editor";
import { editPlan, planTrip } from "@/lib/agents/orchestrator";
import { getCity } from "@/lib/data/cities";
import { PlanRequestSchema } from "@/lib/types";

/** Yeni plan; gövdede "edit" varsa mevcut planda tek bir durağı düzenler */
export async function POST(request: Request) {
  const parsed = PlanRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Geçersiz istek", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  if (!getCity(parsed.data.cityId)) {
    return Response.json({ error: "Bu şehir henüz desteklenmiyor" }, { status: 404 });
  }

  const { edit, ...req } = parsed.data;
  try {
    return Response.json(edit ? await editPlan(req, edit) : await planTrip(req));
  } catch (error) {
    if (error instanceof EditError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("Plan oluşturulamadı:", error);
    return Response.json({ error: "Plan oluşturulamadı" }, { status: 500 });
  }
}
