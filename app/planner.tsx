"use client";

import { useRef, useState } from "react";
import type { PlaceCategory, PlanEdit, TripPlan, TripRequest } from "@/lib/types";
import { AlertIcon } from "./icons";
import PlanView from "./plan-view";
import TripForm from "./trip-form";

const today = () => new Date().toISOString().slice(0, 10);

export default function Planner({ cities }: { cities: { id: string; name: string }[] }) {
  const [form, setForm] = useState<TripRequest>({
    cityId: cities[0]?.id ?? "",
    days: 2,
    // Boşsa gönderirken bugünün tarihi kullanılır (render sırasında
    // new Date() çağırmak prerender'da dondurulur)
    startDate: "",
    travelers: 1,
    budget: 5000,
    transport: "toplu_tasima",
    interests: ["tarih", "yemek"],
    hasMuzekart: false,
  });
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Düzenlenmekte olan durağın kimliği */
  const [editing, setEditing] = useState<string | null>(null);
  const results = useRef<HTMLDivElement>(null);

  const update = <K extends keyof TripRequest>(key: K, value: TripRequest[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleInterest = (id: PlaceCategory) =>
    update(
      "interests",
      form.interests.includes(id) ? form.interests.filter((i) => i !== id) : [...form.interests, id],
    );

  async function postPlan(body: unknown): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Bir hata oluştu");
      setPlan(data);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu");
      return false;
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // Sonuç alanına in: plan yüklenirken iskelet, gelince plan görünür
    requestAnimationFrame(() => results.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    await postPlan({ ...form, startDate: form.startDate || today() });
    setLoading(false);
  }

  /** Mevcut planda tek bir durağı çıkar ya da benzeriyle değiştir */
  async function editStop(action: PlanEdit["action"], day: number, placeId: string) {
    if (!plan) return;
    setEditing(placeId);
    const notes = Object.fromEntries(
      plan.days.flatMap((d) => d.stops.filter((s) => s.note).map((s) => [s.place.id, s.note!])),
    );
    await postPlan({
      ...plan.request,
      edit: {
        days: plan.days.map((d) => d.stops.map((s) => s.place.id)),
        action,
        placeId,
        day,
        notes,
        summary: plan.summary,
        plannedBy: plan.plannedBy,
      },
    });
    setEditing(null);
  }

  return (
    <div className="space-y-10">
      <TripForm
        cities={cities}
        form={form}
        loading={loading}
        update={update}
        toggleInterest={toggleInterest}
        onSubmit={submit}
      />

      <div ref={results} className="scroll-mt-4" aria-live="polite">
        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-coral bg-coral-soft p-4 text-coral" role="alert">
            <AlertIcon className="mt-0.5 shrink-0 text-lg" />
            <div>
              <p className="font-medium">Plan oluşturulamadı</p>
              <p className="text-sm">{error}. Seçimlerini kontrol edip yeniden dene.</p>
            </div>
          </div>
        )}
        {loading && !plan && <PlanSkeleton />}
        {plan && (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <PlanView plan={plan} onEdit={editStop} editing={editing} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Plan hazırlanırken sonucun şeklini gösterir */
function PlanSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Plan hazırlanıyor">
      <div className="space-y-3">
        <div className="skeleton h-9 w-64 rounded-xl" />
        <div className="skeleton h-5 w-full max-w-xl rounded-lg" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-28 rounded-2xl" />
          ))}
        </div>
        <div className="space-y-5">
          <div className="skeleton h-44 rounded-3xl" />
          <div className="skeleton h-72 rounded-3xl" />
        </div>
      </div>
      <p className="text-sm text-muted">Mekanlar seçiliyor, rota çiziliyor ve bütçe hesaplanıyor.</p>
    </div>
  );
}
