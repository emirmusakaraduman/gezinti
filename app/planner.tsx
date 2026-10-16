"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { dayColor } from "@/lib/colors";
import { formatRange } from "@/lib/geo";
import type {
  PlaceCategory,
  PlanWarning,
  TransportMode,
  TripPlan,
  TripRequest,
} from "@/lib/types";

const INTERESTS: { id: PlaceCategory; label: string }[] = [
  { id: "tarih", label: "Tarih" },
  { id: "muze", label: "Müze" },
  { id: "doga", label: "Doğa" },
  { id: "manzara", label: "Manzara" },
  { id: "carsi", label: "Çarşı" },
  { id: "semt", label: "Semt gezisi" },
  { id: "yemek", label: "Yemek" },
  { id: "gece", label: "Gece hayatı" },
];

// MapLibre tarayıcı API'leri ister; sunucuda render edilmesin
const PlanMap = dynamic(() => import("./plan-map"), {
  ssr: false,
  loading: () => <div className="h-[470px] animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />,
});

const LEG_LABEL ={ yurume: "Yürüme", toplu_tasima: "Toplu taşıma", araba: "Araba" };

const WARNING_STYLE: Record<PlanWarning["level"], string> = {
  bilgi: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100",
  uyari: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  asim: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
};

const STATUS_LABEL = {
  rahat: "Bütçe rahat",
  yaklasiyor: "Bütçe sınırına yaklaşıyor",
  asabilir: "Bütçe aşılabilir",
  asiyor: "Bütçe aşılıyor",
};

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
  });
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const update = <K extends keyof TripRequest>(key: K, value: TripRequest[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleInterest = (id: PlaceCategory) =>
    update(
      "interests",
      form.interests.includes(id)
        ? form.interests.filter((i) => i !== id)
        : [...form.interests, id],
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, startDate: form.startDate || today() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Bir hata oluştu");
      setPlan(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu");
    } finally {
      setLoading(false);
    }
  }

  const input =
    "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="space-y-8">
      <form
        onSubmit={submit}
        className="grid gap-4 rounded-2xl border border-zinc-200 p-5 sm:grid-cols-3 dark:border-zinc-800"
      >
        <label className="text-sm">
          Şehir
          <select className={input} value={form.cityId} onChange={(e) => update("cityId", e.target.value)}>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Başlangıç tarihi
          <input type="date" className={input} value={form.startDate} onChange={(e) => update("startDate", e.target.value)} />
        </label>
        <label className="text-sm">
          Gün sayısı
          <input type="number" min={1} max={7} className={input} value={form.days} onChange={(e) => update("days", Number(e.target.value))} />
        </label>
        <label className="text-sm">
          Kişi sayısı
          <input type="number" min={1} max={10} className={input} value={form.travelers} onChange={(e) => update("travelers", Number(e.target.value))} />
        </label>
        <label className="text-sm">
          Toplam bütçe (TL, konaklama hariç)
          <input type="number" min={100} step={100}className={input} value={form.budget} onChange={(e) => update("budget", Number(e.target.value))} />
        </label>
        <label className="text-sm">
          Ulaşım
          <select className={input} value={form.transport} onChange={(e) => update("transport", e.target.value as TransportMode)}>
            <option value="toplu_tasima">Toplu taşıma</option>
            <option value="araba">Araba</option>
          </select>
        </label>

        <fieldset className="sm:col-span-3">
          <legend className="text-sm">İlgi alanları</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {INTERESTS.map((i) => {
              const active = form.interests.includes(i.id);
              return (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => toggleInterest(i.id)}
                  aria-pressed={active}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    active
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  {i.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="text-sm sm:col-span-3">
          Not (isteğe bağlı)
          <input className={input} placeholder="Ör. vejetaryenim, yokuş istemiyorum" value={form.notes ?? ""} onChange={(e) => update("notes", e.target.value || undefined)} />
        </label>

        <button
          type="submit"
          disabled={loading || form.interests.length === 0}
          className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white disabled:opacity-50 sm:col-span-3"
        >
          {loading ? "Ajanlar planlıyor…" : "Planı oluştur"}
        </button>
      </form>

      {error && <p className="text-red-600">{error}</p>}
      {plan && <PlanView plan={plan} />}
    </div>
  );
}

function PlanView({ plan }: { plan: TripPlan }) {
  const { budget } = plan;
  const pct = Math.min(100, Math.round(budget.usageRatio * 100));
  const barColor =
    budget.status === "rahat" ? "bg-emerald-500" : budget.status === "yaklasiyor" ? "bg-amber-500" : "bg-red-500";

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">{plan.cityName} planın</h2>
        <p className="mt-1 text-zinc-700 dark:text-zinc-300">{plan.summary}</p>
        <p className="mt-1 text-xs text-zinc-500">
          Planlayan: {plan.plannedBy === "claude" ? "Claude" : "sezgisel yöntem"}
          {plan.revisions > 0 && ` · ${plan.revisions} kez revize edildi`}
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="flex items-baseline justify-between">
          <h3 className="font-medium">{STATUS_LABEL[budget.status]}</h3>
          <span className="text-sm">
            {formatRange(budget.total)} / {budget.budget.toLocaleString("tr-TR")} TL
          </span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Cost label="Aktiviteler" value={formatRange(budget.breakdown.activities)} />
          <Cost label="Yemek" value={formatRange(budget.breakdown.food)} />
          <Cost label="Ulaşım" value={formatRange(budget.breakdown.transport)} />
          <Cost label="Otopark" value={formatRange(budget.breakdown.parking)} />
        </dl>
      </div>

      <PlanMap days={plan.days} center={plan.cityCenter} />

      {plan.warnings.length > 0 && (
        <ul className="space-y-2">
          {plan.warnings.map((w, i) => (
            <li key={i} className={`rounded-lg border px-4 py-2 text-sm ${WARNING_STYLE[w.level]}`}>
              {w.message}
            </li>
          ))}
        </ul>
      )}

      {plan.days.map((day) => (
        <article key={day.day} className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
          <header className="mb-3 flex items-baseline justify-between">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: dayColor(day.day) }} />
              {day.day}. gün <span className="text-sm font-normal text-zinc-500">{day.date}</span>
            </h3>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">{formatRange(day.cost)}</span>
          </header>
          <ol className="space-y-3">
            {day.stops.map((stop, i) => {
              const leg = i > 0 ? day.legs[i - 1] : null;
              return (
                <li key={stop.place.id}>
                  {leg && (
                    <p className="mb-2 ml-[5.75rem] text-xs text-zinc-500">
                      ↓ {LEG_LABEL[leg.mode]} · {leg.estimated ? "~" : ""}{leg.durationMin} dk · {leg.distanceKm.toFixed(1)} km
                      {leg.cost.max > 0 && ` · ${formatRange(leg.cost)}`}
                      {leg.estimated && " (tahmini)"}
                    </p>
                  )}
                  <div className="flex gap-3">
                    <span
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                      style={{ background: dayColor(day.day) }}
                    >
                      {i + 1}
                    </span>
                    <span className="w-11 shrink-0 pt-0.5 font-mono text-sm text-zinc-500">{stop.arrival}</span>
                    <div>
                      <p className="font-medium">
                        {stop.place.name}{" "}
                        <span className="text-sm font-normal text-zinc-500">
                          · {formatRange(stop.place.price)}
                          {stop.place.price.confidence === "tahmini" && stop.place.price.max > 0 && " (tahmini)"}
                        </span>
                      </p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">{stop.place.description}</p>
                      {stop.place.mustTry && (
                        <p className="text-sm">Mutlaka dene: {stop.place.mustTry}</p>
                      )}
                      {stop.note && <p className="text-sm text-emerald-700 dark:text-emerald-400">İpucu: {stop.note}</p>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </article>
      ))}
    </section>
  );
}

function Cost({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
