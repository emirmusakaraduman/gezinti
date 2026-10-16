import { z } from "zod";
import { getTransitRouter } from "@/lib/transit/router";

const QuerySchema = z.object({
  city: z.string(),
  fromLat: z.coerce.number(),
  fromLng: z.coerce.number(),
  toLat: z.coerce.number(),
  toLng: z.coerce.number(),
  /** "HH:MM" */
  time: z.string().regex(/^\d{2}:\d{2}$/),
  /** 0 = Pazar … 6 = Cumartesi */
  weekday: z.coerce.number().int().min(0).max(6),
});

/** Yönlendiriciyi tek başına denemek için: /api/transit?city=istanbul&... */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = QuerySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: "Geçersiz sorgu", issues: parsed.error.issues }, { status: 400 });
  }
  const q = parsed.data;
  const router = getTransitRouter(q.city);
  if (!router) {
    return Response.json({ error: "Bu şehir için GTFS verisi yok" }, { status: 404 });
  }
  const [h, m] = q.time.split(":").map(Number);
  const t0 = performance.now();
  const journey = router.plan(
    { lat: q.fromLat, lng: q.fromLng },
    { lat: q.toLat, lng: q.toLng },
    h * 3600 + m * 60,
    q.weekday,
  );
  return Response.json({ ms: Math.round(performance.now() - t0), journey });
}
