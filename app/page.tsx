import { listCities } from "@/lib/data/cities";
import Planner from "./planner";

export default function Home() {
  return (
    <>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 pt-6 sm:px-6">
        <span className="font-display text-xl font-bold tracking-tight">Gezinti</span>
        <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
          İstanbul, İzmir ve Ankara
        </span>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 sm:px-6">
        <section className="relative pt-10 pb-8 sm:pt-14">
          <RouteMotif />
          <h1 className="rise font-display max-w-2xl text-4xl leading-[1.05] font-bold tracking-tight sm:text-6xl">
            Bütçene uygun şehir gezisi, saat saat.
          </h1>
          <p className="rise mt-4 max-w-xl text-lg text-muted" style={{ animationDelay: "150ms" }}>
            Şehrini, gün sayını ve bütçeni seç. Mekanları, yemekleri ve toplu taşıma rotasını
            gerçek sefer saatleriyle planlayalım.
          </p>
        </section>

        <Planner cities={listCities()} />
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-muted sm:px-6">
        Harita ve yer verileri © OpenStreetMap katkıcıları. Sefer saatleri belediyelerin ve
        işletmelerin yayımladığı verilerden gelir; yola çıkmadan kontrol et.
      </footer>
    </>
  );
}

/**
 * Dört istasyonlu bir güzergah hattı; planın görsel dilini hero'ya taşır. Hat kendini
 * çizer, istasyonlar sırayla belirir, sonra üzerinde bir araç gidip gelir.
 */
function RouteMotif() {
  const stations = [
    [12, 98],
    [110, 38],
    [200, 78],
    [306, 22],
  ];
  return (
    <svg
      viewBox="0 0 320 120"
      className="pointer-events-none absolute top-6 right-0 hidden h-28 w-80 text-accent lg:block"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="hero-line"
        pathLength={1}
        d="M12 98 C70 98 80 30 140 30 S220 94 306 22"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {stations.map(([x, y], i) => (
        <circle
          key={x}
          className="hero-station"
          style={{ animationDelay: `${0.5 + i * 0.45}s` }}
          cx={x}
          cy={y}
          r="9"
          fill="var(--bg)"
          stroke="currentColor"
          strokeWidth="5"
        />
      ))}
      <circle className="hero-vehicle" r="6" cx="0" cy="0" fill="var(--coral)" />
    </svg>
  );
}
