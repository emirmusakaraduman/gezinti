"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { dayColor } from "@/lib/colors";
import { formatRange } from "@/lib/geo";
import type {
  MealKind,
  Place,
  PlanEdit,
  PlaceCategory,
  PlanWarning,
  TransitStep,
  TransportMode,
  TripPlan,
  TripRequest,
  Vehicle,
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
    hasMuzekart: false,
  });
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Düzenlenmekte olan durağın kimliği */
  const [editing, setEditing] = useState<string | null>(null);

  const update =<K extends keyof TripRequest>(key: K, value: TripRequest[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleInterest = (id: PlaceCategory) =>
    update(
      "interests",
      form.interests.includes(id)
        ? form.interests.filter((i) => i !== id)
        : [...form.interests, id],
    );

  async function postPlan(body: unknown) {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
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

        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input
            type="checkbox"
            checked={form.hasMuzekart ?? false}
            onChange={(e) => update("hasMuzekart", e.target.checked)}
            className="h-4 w-4 accent-emerald-600"
          />
          Müzekart&apos;ım var
          <span className="text-xs text-zinc-500">(Bakanlık müzeleri ücretsiz sayılır)</span>
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
      {plan && <PlanView plan={plan} onEdit={editStop} editing={editing} />}
    </div>
  );
}

function PlanView({
  plan,
  onEdit,
  editing,
}: {
  plan: TripPlan;
  onEdit: (action: PlanEdit["action"], day: number, placeId: string) => void;
  editing: string | null;
}) {
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
          Planlayan:{" "}
          {plan.plannedBy === "claude" ? "Claude" : plan.demo ? "demo modu (AI ajanları kapalı)" : "sezgisel yöntem"}
          {plan.revisions > 0 && ` · ${plan.revisions} kez revize edildi`}
          {" · Giriş ücretleri T.C. vatandaşı tarifesidir"}
        </p>
        {plan.editMessage && (
          <p className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
            {plan.editMessage}
          </p>
        )}
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
                  {stop.freeTimeMin && (
                    <p className="mb-2 ml-[5.75rem] text-xs italic text-zinc-500">
                      Serbest zaman · {formatDuration(stop.freeTimeMin)}
                    </p>
                  )}
                  {leg && (
                    <div className="mb-2 ml-[5.75rem] text-xs text-zinc-500">
                      <p>
                        ↓ {LEG_LABEL[leg.mode]} · {leg.estimated ? "~" : ""}{leg.durationMin} dk · {leg.distanceKm.toFixed(1)} km
                        {leg.cost.max > 0 && ` · ${formatRange(leg.cost)}`}
                        {leg.estimated && " (tahmini)"}
                      </p>
                      {leg.transit && <TransitSteps steps={leg.transit} />}
                    </div>
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
                        {stop.meal && (
                          <span className="mr-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                            {MEAL_LABEL[stop.meal]}
                          </span>
                        )}
                        {stop.place.name}{" "}
                        <span className="text-sm font-normal text-zinc-500">
                          {plan.request.hasMuzekart && stop.place.muzekart ? (
                            <> · Müzekart ile ücretsiz</>
                          ) : (
                            <>
                              · {formatRange(stop.place.price)}
                              {stop.place.price.confidence === "tahmini" && stop.place.price.max > 0 && " (tahmini)"}
                            </>
                          )}
                        </span>
                      </p>
                      <PlaceBadges place={stop.place} />
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">{stop.place.description}</p>
                      {stop.place.mustTry && (
                        <p className="text-sm">Mutlaka dene: {stop.place.mustTry}</p>
                      )}
                      {stop.note && <p className="text-sm text-emerald-700 dark:text-emerald-400">İpucu: {stop.note}</p>}
                      <div className="mt-1 flex gap-3 text-xs">
                        <button
                          type="button"
                          disabled={editing !== null}
                          onClick={() => onEdit("degistir", day.day, stop.place.id)}
                          className="text-sky-700 hover:underline disabled:opacity-40 dark:text-sky-400"
                        >
                          {editing === stop.place.id ? "Güncelleniyor…" : "Değiştir"}
                        </button>
                        <button
                          type="button"
                          disabled={editing !== null}
                          onClick={() => onEdit("cikar", day.day, stop.place.id)}
                          className="text-red-700 hover:underline disabled:opacity-40 dark:text-red-400"
                        >
                          Çıkar
                        </button>
                      </div>
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

const DAY_NAMES = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

const MEAL_LABEL: Record<MealKind, string> = {
  kahvalti: "Kahvaltı",
  ogle: "Öğle yemeği",
  aksam: "Akşam yemeği",
  ara: "Ara öğün",
};

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} sa${m ? ` ${m} dk` : ""}` : `${m} dk`;
}

const DISTINCTION_LABEL:Record<NonNullable<Place["distinction"]>["kind"], string> = {
  "michelin-2-yildiz": "★★ Michelin",
  "michelin-yildiz": "★ Michelin",
  "michelin-bib": "Michelin Bib Gourmand",
  "michelin-tavsiye": "Michelin tavsiyesi",
};

/** Mekanın neden önerildiğini gösteren küçük rozetler */
function PlaceBadges({ place }: { place: Place }) {
  const badge = "mt-0.5 mr-1.5 inline-block rounded-full px-2 py-0.5 text-xs";
  return (
    <div>
      {place.distinction && (
        <span className={`${badge} bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200`}>
          {DISTINCTION_LABEL[place.distinction.kind]} {place.distinction.year}
        </span>
      )}
      {place.popularity && (
        <span
          className={`${badge} bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200`}
          title={`Son 12 ayda ${place.popularity.views.toLocaleString("tr-TR")} Wikipedia okunması, ${place.popularity.sitelinks} dilde maddesi var`}
        >
          {place.popularity.sitelinks} dilde Wikipedia
        </span>
      )}
      {place.muzekart && (
        <span className={`${badge} bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200`}>
          Müzekart geçerli
        </span>
      )}
      {place.ticketNote && <span className="mr-1.5 text-xs text-zinc-500">{place.ticketNote}</span>}
      {place.hours && (
        <span className="mr-1.5 text-xs text-zinc-500" title={place.hoursNote}>
          {place.hours.open}–{place.hours.close}
          {place.hours.closedDays.length > 0 &&
            ` · ${place.hours.closedDays.map((d) => DAY_NAMES[d]).join(", ")} kapalı`}
          {place.hoursNote && " ⓘ"}
        </span>
      )}
      {place.source === "kurator" && !place.distinction && (
        <span className={`${badge} bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200`}>
          Köklü mekan
        </span>
      )}
    </div>
  );
}

const VEHICLE_LABEL: Record<Vehicle, string> = {
  tramvay: "tramvayı",
  metro: "metrosu",
  tren: "treni",
  otobus: "otobüsü",
  vapur: "vapuru",
  teleferik: "teleferiği",
  funikuler: "füniküleri",
};

function TransitSteps({ steps }: { steps: TransitStep[] }) {
  return (
    <ul className="mt-1 space-y-0.5 border-l-2 border-zinc-200 pl-2 dark:border-zinc-800">
      {steps.map((s, i) => (
        <li key={i}>
          <span className="font-mono">{s.depart}</span>{" "}
          {s.kind === "binis" ? (
            <>
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                {s.line} {s.vehicle && VEHICLE_LABEL[s.vehicle]}
              </span>{" "}
              · {s.from} → {s.to} ({s.durationMin} dk)
            </>
          ) : (
            <>
              Yürü · {s.from} → {s.to} ({s.durationMin} dk)
            </>
          )}
        </li>
      ))}
    </ul>
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
