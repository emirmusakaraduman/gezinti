"use client";

import type { ReactNode } from "react";
import type { PlaceCategory, TransportMode, TripRequest } from "@/lib/types";
import { BusIcon, CarIcon, MinusIcon, PlusIcon } from "./icons";

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

/** Şehir kartlarındaki kısa tanıtım; veride olmadığı için burada */
const CITY_BLURB: Record<string, string> = {
  istanbul: "Tarihi Yarımada, Boğaz ve vapur hatları",
  izmir: "Kordon, Kemeraltı ve Ege sahili",
  ankara: "Anıtkabir, Hamamönü ve müzeler",
};

const BUDGET_PRESETS = [2000, 5000, 10000, 20000];

interface Props {
  cities: { id: string; name: string }[];
  form: TripRequest;
  loading: boolean;
  update: <K extends keyof TripRequest>(key: K, value: TripRequest[K]) => void;
  toggleInterest: (id: PlaceCategory) => void;
  onSubmit: (e: React.FormEvent) => void;
}

const fieldLabel = "text-sm font-medium text-ink";
const control =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-ink transition-colors hover:border-accent focus:border-accent";

export default function TripForm({ cities, form, loading, update, toggleInterest, onSubmit }: Props) {
  return (
    <form onSubmit={onSubmit} className="space-y-7 rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-7">
      {/* Şehir */}
      <fieldset>
        <legend className={fieldLabel}>Şehir</legend>
        <div role="radiogroup" aria-label="Şehir" className="mt-2.5 grid gap-3 sm:grid-cols-3">
          {cities.map((c) => {
            const active = form.cityId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update("cityId", c.id)}
                className={`rounded-2xl border p-4 text-left transition-all ${
                  active
                    ? "border-accent bg-accent-soft shadow-[inset_0_0_0_1px_var(--accent)]"
                    : "border-line bg-surface-2 hover:border-accent"
                }`}
              >
                <span className="font-display block text-lg font-semibold">{c.name}</span>
                <span className="mt-0.5 block text-sm text-muted">{CITY_BLURB[c.id]}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Tarih, gün, kişi, bütçe */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className={fieldLabel}>Başlangıç tarihi</span>
          <input
            type="date"
            className={`${control} mt-1.5`}
            value={form.startDate}
            onChange={(e) => update("startDate", e.target.value)}
          />
        </label>

        <Stepper
          label="Gün"
          value={form.days}
          min={1}
          max={7}
          unit="gün"
          onChange={(v) => update("days", v)}
        />
        <Stepper
          label="Kişi"
          value={form.travelers}
          min={1}
          max={10}
          unit="kişi"
          onChange={(v) => update("travelers", v)}
        />

        <div>
          <label htmlFor="budget" className={fieldLabel}>
            Toplam bütçe
          </label>
          <div className="relative mt-1.5">
            <input
              id="budget"
              type="number"
              min={100}
              step={100}
              className={`${control} tnum pr-12`}
              value={form.budget}
              onChange={(e) => update("budget", Number(e.target.value))}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-muted">TL</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {BUDGET_PRESETS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => update("budget", b)}
                aria-pressed={form.budget === b}
                className={`tnum rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                  form.budget === b ? "bg-ink text-bg" : "bg-surface-2 text-muted hover:text-ink"
                }`}
              >
                {b.toLocaleString("tr-TR")}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">Konaklama hariç</p>
        </div>
      </div>

      {/* Ulaşım */}
      <fieldset>
        <legend className={fieldLabel}>Ulaşım</legend>
        <div role="radiogroup" aria-label="Ulaşım" className="mt-2.5 inline-flex rounded-xl border border-line bg-surface-2 p-1">
          {(
            [
              ["toplu_tasima", "Toplu taşıma", <BusIcon key="b" />],
              ["araba", "Araba", <CarIcon key="c" />],
            ] as [TransportMode, string, ReactNode][]
          ).map(([id, label, icon]) => {
            const active = form.transport === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update("transport", id)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink"
                }`}
              >
                <span className="text-base">{icon}</span>
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* İlgi alanları */}
      <fieldset>
        <legend className={fieldLabel}>İlgi alanları</legend>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {INTERESTS.map((i) => {
            const active = form.interests.includes(i.id);
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => toggleInterest(i.id)}
                aria-pressed={active}
                className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-accent bg-accent text-white"
                    : "border-line bg-surface-2 text-ink hover:border-accent"
                }`}
              >
                {i.label}
              </button>
            );
          })}
        </div>
        {form.interests.length === 0 && (
          <p className="mt-2 text-sm text-coral">Plan için en az bir ilgi alanı seç.</p>
        )}
      </fieldset>

      {/* Müzekart ve not */}
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface-2 p-4">
          <Switch checked={form.hasMuzekart ?? false} onChange={(v) => update("hasMuzekart", v)} />
          <span>
            <span className="block text-sm font-medium">Müzekart&apos;ım var</span>
            <span className="block text-xs text-muted">Bakanlık müzeleri ücretsiz sayılır.</span>
          </span>
        </label>
        <label className="block">
          <span className={fieldLabel}>Not</span>
          <input
            className={`${control} mt-1.5`}
            placeholder="Ör. vejetaryenim, yokuş istemiyorum"
            value={form.notes ?? ""}
            onChange={(e) => update("notes", e.target.value || undefined)}
          />
        </label>
      </div>

      <div className="flex flex-col items-start gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">Giriş ücretleri T.C. vatandaşı tarifesidir.</p>
        <button
          type="submit"
          disabled={loading || form.interests.length === 0}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-6 py-3 font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Planlanıyor" : "Planı oluştur"}
        </button>
      </div>
    </form>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const btn =
    "flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-lg text-ink transition-colors hover:border-accent disabled:opacity-35 disabled:hover:border-line";
  return (
    <div role="group" aria-label={label}>
      <span className={fieldLabel}>{label}</span>
      <div className="mt-1.5 flex items-center gap-2">
        <button type="button" className={btn} onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`${label} azalt`}>
          <MinusIcon />
        </button>
        <span className="tnum min-w-16 text-center">
          <span className="font-display text-xl font-semibold">{value}</span>{" "}
          <span className="text-sm text-muted">{unit}</span>
        </span>
        <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`${label} artır`}>
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-line transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
      />
    </>
  );
}
