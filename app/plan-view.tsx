"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { dayColor } from "@/lib/colors";
import { formatRange } from "@/lib/geo";
import type {
  BudgetSummary,
  DayPlan,
  Leg,
  MealKind,
  Place,
  PlanEdit,
  PlanWarning,
  Stop,
  TransitStep,
  TripPlan,
  Vehicle,
} from "@/lib/types";
import { CountRange, Reveal } from "./motion";
import {
  AlertIcon,
  CarIcon,
  ChevronIcon,
  ClockIcon,
  InfoIcon,
  SwapIcon,
  TrashIcon,
  VehicleIcon,
  WalkIcon,
} from "./icons";

// MapLibre tarayıcı API'leri ister; sunucuda render edilmesin
const PlanMap = dynamic(() => import("./plan-map"), {
  ssr: false,
  loading: () => <div className="skeleton h-[min(440px,55vh)] rounded-3xl" />,
});

const STATUS: Record<BudgetSummary["status"], { label: string; tone: string }> = {
  rahat: { label: "Bütçe rahat", tone: "bg-ok-soft text-ok" },
  yaklasiyor: { label: "Bütçe sınırına yaklaşıyor", tone: "bg-amber-soft text-amber" },
  asabilir: { label: "Bütçe aşılabilir", tone: "bg-amber-soft text-amber" },
  asiyor: { label: "Bütçe aşılıyor", tone: "bg-coral-soft text-coral" },
};

const DAY_NAMES = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

const MEAL_LABEL: Record<MealKind, string> = {
  kahvalti: "Kahvaltı",
  ogle: "Öğle yemeği",
  aksam: "Akşam yemeği",
  ara: "Ara öğün",
};

const VEHICLE_LABEL: Record<Vehicle, string> = {
  tramvay: "tramvayı",
  metro: "metrosu",
  tren: "treni",
  otobus: "otobüsü",
  vapur: "vapuru",
  teleferik: "teleferiği",
  funikuler: "füniküleri",
};

const DISTINCTION_LABEL: Record<NonNullable<Place["distinction"]>["kind"], string> = {
  "michelin-2-yildiz": "★★ Michelin",
  "michelin-yildiz": "★ Michelin",
  "michelin-bib": "Michelin Bib Gourmand",
  "michelin-tavsiye": "Michelin tavsiyesi",
};

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    weekday: "long",
    timeZone: "UTC",
  });

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} sa${m ? ` ${m} dk` : ""}` : `${m} dk`;
}

export default function PlanView({
  plan,
  onEdit,
  editing,
}: {
  plan: TripPlan;
  onEdit: (action: PlanEdit["action"], day: number, placeId: string) => void;
  editing: string | null;
}) {
  const modeLabel = plan.request.transport === "araba" ? "Araba" : "Toplu taşıma";
  const planner = plan.plannedBy === "claude" ? "Claude ile planlandı" : plan.demo ? "Demo modu, AI ajanları kapalı" : "Yedek yöntemle planlandı";

  return (
    <section className="space-y-8">
      <header>
        <h2 className="font-display text-4xl sm:text-5xl">{plan.cityName} planın</h2>
        <p className="mt-2 max-w-2xl text-muted">{plan.summary}</p>
        <ul className="mt-4 flex flex-wrap gap-2 text-sm">
          <Chip>{plan.days.length} gün</Chip>
          <Chip>{plan.request.travelers} kişi</Chip>
          <Chip>{modeLabel}</Chip>
          <Chip tone="accent">{planner}</Chip>
          {plan.revisions > 0 && <Chip>{plan.revisions} kez revize edildi</Chip>}
        </ul>
        {plan.editMessage && (
          <p className="mt-4 rounded-xl border-2 border-line bg-warm px-4 py-2.5 text-sm font-bold text-black">
            {plan.editMessage}
          </p>
        )}
      </header>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_25rem]">
        {/* Harita ve bütçe: geniş ekranda gezinirken sabit kalır */}
        <aside className="space-y-5 lg:sticky lg:top-4 lg:order-2">
          <BudgetCard budget={plan.budget} />
          <PlanMap days={plan.days} center={plan.cityCenter} />
        </aside>

        <div className="space-y-8 lg:order-1">
          <Reveal>
            <Warnings warnings={plan.warnings} />
          </Reveal>
          {plan.days.map((day) => (
            <DaySection key={day.day} day={day} plan={plan} onEdit={onEdit} editing={editing} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone?: "accent" }) {
  return (
    <li
      className={`rounded-full px-3 py-1 font-bold ${
        tone === "accent" ? "border-2 border-line bg-warm text-black" : "border-2 border-line bg-surface"
      }`}
    >
      {children}
    </li>
  );
}

// ---------- Bütçe ----------

function BudgetCard({ budget }: { budget: BudgetSummary }) {
  const status = STATUS[budget.status];
  const parts = [
    { label: "Aktiviteler", value: budget.breakdown.activities, color: "var(--g1)" },
    { label: "Yemek", value: budget.breakdown.food, color: "var(--g2)" },
    { label: "Ulaşım", value: budget.breakdown.transport, color: "var(--g3)" },
    { label: "Otopark", value: budget.breakdown.parking, color: "var(--warm)" },
  ];
  const sum = parts.reduce((s, p) => s + p.value.max, 0) || 1;
  // Çubuk bütçenin tamamını gösterir; dolu kısım üst tahminin bütçeye oranı
  const usage = Math.min(1, budget.usageRatio);

  return (
    <div className="rounded-3xl border-2 border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-muted">Tahmini harcama</p>
        <span className={`rounded-full border-2 border-current px-3 py-1 text-xs font-bold ${status.tone}`}>{status.label}</span>
      </div>
      <p className="font-display tnum mt-1 text-4xl leading-tight whitespace-nowrap">
        <CountRange min={budget.total.min} max={budget.total.max} />
      </p>

      <div
        className="mt-4 flex h-4 overflow-hidden rounded-full bg-surface-2 ring-2 ring-line"
        role="img"
        aria-label={`Bütçenin yüzde ${Math.round(budget.usageRatio * 100)} kadarı kullanılıyor`}
      >
        {parts.map((p, i) =>
          p.value.max > 0 ? (
            <div
              key={p.label}
              className="meter-seg h-full"
              style={{
                width: `${(p.value.max / sum) * usage * 100}%`,
                background: p.color,
                animationDelay: `${i * 90}ms`,
              }}
            />
          ) : null,
        )}
      </div>
      <p className="tnum mt-2 text-sm text-muted">
        Bütçen {budget.budget.toLocaleString("tr-TR")} TL, en kötü durumda %{Math.round(budget.usageRatio * 100)} kullanılır.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {parts.map((p) => (
          <div key={p.label}>
            <dt className="flex items-center gap-1.5 text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.label}
            </dt>
            <dd className="tnum font-medium">{formatRange(p.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---------- Uyarılar ----------

const WARNING_UI: Record<PlanWarning["level"], { icon: ReactNode; box: string }> = {
  bilgi: { icon: <InfoIcon />, box: "border-info text-ink [&>svg]:text-info" },
  uyari: { icon: <AlertIcon />, box: "border-amber text-ink [&>svg]:text-amber" },
  asim: { icon: <AlertIcon />, box: "border-coral text-ink [&>svg]:text-coral" },
};

function Warnings({ warnings }: { warnings: PlanWarning[] }) {
  if (warnings.length === 0) return null;
  // Uyarı ya da aşım varsa açık gelir; yalnızca bilgi notları katlı kalır
  const important = warnings.some((w) => w.level !== "bilgi");
  const attention = warnings.filter((w) => w.level !== "bilgi").length;
  return (
    <details open={important} className="group rounded-2xl border-2 border-line bg-surface shadow-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 font-medium">
        <span>
          Bilmen gerekenler
          <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{warnings.length}</span>
          {attention > 0 && (
            <span className="ml-1.5 rounded-full bg-amber-soft px-2 py-0.5 text-xs text-amber">{attention} dikkat</span>
          )}
        </span>
        <ChevronIcon className="text-lg text-muted transition-transform group-open:rotate-180" />
      </summary>
      <ul className="space-y-2 px-5 pb-5">
        {warnings.map((w, i) => (
          <li key={i} className={`flex gap-3 border-l-[3px] py-1 pl-3 text-sm ${WARNING_UI[w.level].box}`}>
            <span className="mt-0.5 shrink-0 text-base">{WARNING_UI[w.level].icon}</span>
            <span>{w.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------- Gün ve duraklar ----------

function DaySection({
  day,
  plan,
  onEdit,
  editing,
}: {
  day: DayPlan;
  plan: TripPlan;
  onEdit: (action: PlanEdit["action"], day: number, placeId: string) => void;
  editing: string | null;
}) {
  const color = dayColor(day.day);
  const weekday = DAY_NAMES[new Date(`${day.date}T12:00:00Z`).getUTCDay()];
  return (
    <article>
      {/* Reveal'a sarılmaz: sticky başlık kendi kapsayıcısında yapışmaz */}
      <header className="sticky top-0 z-10 -mx-2 mb-4 flex items-baseline justify-between gap-3 rounded-2xl bg-bg/90 px-2 py-3 backdrop-blur">
        <h3 className="font-display flex items-baseline gap-3 text-3xl">
          <span aria-hidden="true" className="inline-block h-3.5 w-3.5 self-center rounded-full ring-2 ring-line" style={{ background: color }} />
          {day.day}. gün
          <span className="text-base font-normal text-muted" title={weekday}>
            {fmtDate(day.date)}
          </span>
        </h3>
        <span className="tnum text-sm text-muted">{formatRange(day.cost)}</span>
        <span
          aria-hidden="true"
          className="underline-grow absolute right-2 -bottom-px left-2 h-1 rounded-full bg-ink"
        />
      </header>

      <ol>
        {day.stops.map((stop, i) => (
          <li key={stop.place.id}>
            {i > 0 && (
              <Reveal delay={0}>
                <LegRow leg={day.legs[i - 1]} index={i} />
              </Reveal>
            )}
            {stop.freeTimeMin ? (
              <Reveal>
                <FreeTimeRow minutes={stop.freeTimeMin} index={i} />
              </Reveal>
            ) : null}
            <Reveal delay={80}>
              <StopRow
                stop={stop}
                index={i}
                last={i === day.stops.length - 1}
                day={day.day}
                muzekart={!!plan.request.hasMuzekart}
                onEdit={onEdit}
                editing={editing}
              />
            </Reveal>
          </li>
        ))}
      </ol>
    </article>
  );
}

/** Zaman sütunu + hat + içerik; hat satırlar arasında kesintisiz uzanır */
const ROW = "grid grid-cols-[3.25rem_1.75rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[3.75rem_1.75rem_minmax(0,1fr)]";

function Rail({ color, index, from = "top" }: { color: string; index: number; from?: "top" | "mid" }) {
  return (
    <span
      aria-hidden="true"
      className={`rail absolute left-1/2 w-1 -translate-x-1/2 rounded-full ${from === "mid" ? "top-3" : "top-0"} bottom-0`}
      style={{ background: color, animationDelay: `${index * 80}ms` }}
    />
  );
}

function FreeTimeRow({ minutes, index }: { minutes: number; index: number }) {
  return (
    <div className={ROW}>
      <span />
      <span className="relative">
        <Rail color="var(--ink)" index={index} />
      </span>
      <p className="flex items-center gap-1.5 py-1.5 text-sm text-muted">
        <ClockIcon /> Serbest zaman, {formatDuration(minutes)}
      </p>
    </div>
  );
}

function StopRow({
  stop,
  index,
  last,
  day,
  muzekart,
  onEdit,
  editing,
}: {
  stop: Stop;
  index: number;
  last: boolean;
  day: number;
  muzekart: boolean;
  onEdit: (action: PlanEdit["action"], day: number, placeId: string) => void;
  editing: string | null;
}) {
  const { place } = stop;
  const free = muzekart && place.muzekart;
  return (
    <div className={ROW}>
      <p className="tnum pt-1 text-right text-sm font-medium text-muted">{stop.arrival}</p>
      <span className="relative flex justify-center">
        {!last && <Rail color="var(--ink)" index={index} from="mid" />}
        <span
          className="hero-station relative z-[1] mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-ink text-sm font-extrabold text-bg ring-4 ring-bg"
          style={{ animationDelay: `${index * 80 + 120}ms` }}
        >
          {index + 1}
        </span>
      </span>

      <div className={`${last ? "pb-1" : "pb-4"} min-w-0`}>
        <div className="lift rounded-2xl border-2 border-line bg-surface p-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {stop.meal && (
                <span className="mb-1 inline-block rounded-full border-2 border-line bg-warm px-2.5 py-0.5 text-xs font-bold text-black">
                  {MEAL_LABEL[stop.meal]}
                </span>
              )}
              <h4 className="font-display text-xl leading-tight">{place.name}</h4>
            </div>
            <p className="tnum shrink-0 text-right text-sm font-medium">
              {free ? (
                <span className="text-ok">Müzekart ile ücretsiz</span>
              ) : (
                <>
                  {formatRange(place.price)}
                  {place.price.confidence === "tahmini" && place.price.max > 0 && (
                    <span className="block text-xs font-normal text-muted">tahmini</span>
                  )}
                </>
              )}
            </p>
          </div>

          <PlaceBadges place={place} />

          <p className="mt-2 max-w-prose text-sm text-muted">{place.description}</p>
          {place.mustTry && (
            <p className="mt-2 border-l-[3px] border-coral pl-3 text-sm">
              <span className="font-medium">Mutlaka dene:</span> {place.mustTry}
            </p>
          )}
          {stop.note && (
            <p className="mt-2 border-l-[3px] border-accent pl-3 text-sm">
              <span className="font-medium">İpucu:</span> {stop.note}
            </p>
          )}

          <div className="mt-3 flex gap-1 border-t-2 border-line-soft pt-2.5 text-sm">
            <button
              type="button"
              disabled={editing !== null}
              onClick={() => onEdit("degistir", day, place.id)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-muted transition-colors hover:bg-accent-soft hover:text-accent-strong disabled:opacity-40"
            >
              <SwapIcon /> {editing === place.id ? "Güncelleniyor" : "Değiştir"}
            </button>
            <button
              type="button"
              disabled={editing !== null}
              onClick={() => onEdit("cikar", day, place.id)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-muted transition-colors hover:bg-coral-soft hover:text-coral disabled:opacity-40"
            >
              <TrashIcon /> Çıkar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Duraklar arası yol ----------

const LEG_LABEL = { yurume: "Yürüme", toplu_tasima: "Toplu taşıma", araba: "Araba" };

function LegRow({ leg, index }: { leg: Leg; index: number }) {
  const rides = leg.transit?.filter((s) => s.kind === "binis") ?? [];
  const icon =
    leg.mode === "yurume" ? <WalkIcon /> : leg.mode === "araba" ? <CarIcon /> : <VehicleIcon vehicle={rides[0]?.vehicle} />;
  const summary = (
    <span className="tnum flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-base">{icon}</span>
      <span>
        {LEG_LABEL[leg.mode]}, {leg.estimated ? "~" : ""}
        {leg.durationMin} dk, {leg.distanceKm.toFixed(1)} km
        {leg.cost.max > 0 && `, ${formatRange(leg.cost)}`}
      </span>
      {leg.estimated && <span className="rounded-full bg-amber-soft px-2 py-0.5 text-xs text-amber">tahmini</span>}
      {rides.map((s, i) => (
        <span key={i} className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink">
          {s.line}
        </span>
      ))}
    </span>
  );

  return (
    <div className={ROW}>
      <span />
      <span className="relative">
        <Rail color="var(--ink)" index={index} />
      </span>
      <div className="pb-3 text-sm text-muted">
        {leg.transit && leg.transit.length > 0 ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg py-1 hover:text-ink">
              {summary}
              <ChevronIcon className="shrink-0 text-base transition-transform group-open:rotate-180" />
            </summary>
            <TransitSteps steps={leg.transit} />
          </details>
        ) : (
          <p className="py-1">{summary}</p>
        )}
      </div>
    </div>
  );
}

function TransitSteps({ steps }: { steps: TransitStep[] }) {
  return (
    <ul className="details-body mt-1.5 space-y-1.5 rounded-xl bg-surface-2 p-3 text-ink">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="tnum w-11 shrink-0 text-muted">{s.depart}</span>
          <span className="mt-0.5 shrink-0 text-base text-muted">
            {s.kind === "binis" ? <VehicleIcon vehicle={s.vehicle} /> : <WalkIcon />}
          </span>
          <span>
            {s.kind === "binis" ? (
              <>
                <strong className="font-semibold">
                  {s.line} {s.vehicle && VEHICLE_LABEL[s.vehicle]}
                </strong>
                <span className="text-muted">
                  {" "}
                  {s.from} ile {s.to} arası, {s.durationMin} dk
                </span>
              </>
            ) : (
              <span className="text-muted">
                Yürü: {s.from} ile {s.to} arası, {s.durationMin} dk
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------- Mekan rozetleri ----------

/** Mekanın neden önerildiğini gösteren küçük rozetler */
function PlaceBadges({ place }: { place: Place }) {
  const badge = "rounded-full px-2.5 py-0.5 text-xs font-bold";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {place.distinction && (
        <span className={`${badge} bg-coral-soft text-coral`}>
          {DISTINCTION_LABEL[place.distinction.kind]} {place.distinction.year}
        </span>
      )}
      {place.popularity && (
        <span
          className={`${badge} bg-info-soft text-info`}
          title={`Son 12 ayda ${place.popularity.views.toLocaleString("tr-TR")} Wikipedia okunması, ${place.popularity.sitelinks} dilde maddesi var`}
        >
          {place.popularity.sitelinks} dilde Wikipedia
        </span>
      )}
      {place.muzekart && <span className={`${badge} bg-accent-soft text-accent-strong`}>Müzekart geçerli</span>}
      {place.source === "kurator" && !place.distinction && (
        <span className={`${badge} bg-amber-soft text-amber`}>Köklü mekan</span>
      )}
      {place.ticketNote && <span className="text-xs text-muted">{place.ticketNote}</span>}
      {place.hours && (
        <span className="tnum flex items-center gap-1 text-xs text-muted" title={place.hoursNote}>
          <ClockIcon />
          {place.hours.open}–{place.hours.close}
          {place.hours.closedDays.length > 0 &&
            `, ${place.hours.closedDays.map((d) => DAY_NAMES[d]).join(", ")} kapalı`}
          {place.hoursNote && " ⓘ"}
        </span>
      )}
    </div>
  );
}
