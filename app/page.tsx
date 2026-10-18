import { listCities } from "@/lib/data/cities";
import Planner from "./planner";
import { BusSticker, CompassSticker, PinSticker, SimitSticker, Sticker, TicketSticker } from "./stickers";

export default function Home() {
  return (
    <>
      {/* Kobalt hero: ızgara zemin, etiket kutularında başlık, sürüklenebilir çıkartmalar */}
      <header className="grid-bg relative overflow-hidden pb-36 text-white sm:pb-44">
        <Curves />

        <nav className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-4 pt-6 sm:px-6">
          <span className="font-display -rotate-2 bg-white px-3.5 py-1 text-2xl text-accent uppercase">Gezinti</span>
          <span className="rounded-full border-2 border-white px-3.5 py-1 text-xs font-bold">İstanbul, İzmir ve Ankara</span>
        </nav>

        <div className="relative z-10 mx-auto mt-12 w-full max-w-6xl px-4 sm:mt-16 sm:px-6">
          <p className="rise font-display mb-5 inline-block -rotate-3 bg-magenta px-4 py-1.5 text-sm tracking-wide uppercase sm:text-base">
            Şehri seç, bütçeni yaz, gerisini bize bırak
          </p>

          <h1 className="rise font-display max-w-3xl text-[2.05rem] leading-[1.1] sm:text-6xl lg:text-7xl" style={{ animationDelay: "100ms" }}>
            <span className="mb-2 inline-block -rotate-1 bg-sky px-4 py-1 text-ink uppercase">Gezinti bir</span>
            <br />
            <span className="mb-2 inline-block bg-white px-4 py-1 text-accent uppercase">bütçene uygun</span>
            <br />
            <span className="inline-block rotate-1 bg-white px-4 py-1 text-accent uppercase">şehir gezisi</span>
          </h1>

          <p className="rise mt-7 max-w-lg text-lg leading-snug font-semibold text-white/90" style={{ animationDelay: "250ms" }}>
            Mekanları, yemekleri ve toplu taşıma rotasını gerçek sefer saatleriyle saat saat planlayalım.
          </p>

          <p className="rise mt-5 flex items-center gap-2 text-sm font-bold" style={{ animationDelay: "350ms" }}>
            <FlagIcon /> İstanbul, İzmir ve Ankara için hazır
          </p>

          <p className="font-hand mt-8 -rotate-2 text-3xl text-sky sm:text-4xl">
            formu doldur, plan gelsin
            <svg viewBox="0 0 60 40" className="ml-2 inline-block h-9 w-14 translate-y-3" fill="none" aria-hidden="true">
              <path d="M4 6c20 0 36 6 44 26M48 32l-10-4M48 32l2-11" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </p>
        </div>

        {/* Sürüklenebilir çıkartmalar: geniş ekranda sağda; dar ekranda metni kapatmasın diye gizli */}
        <Sticker className="top-20 right-[8%] float-slow hidden sm:block" tilt={-10}>
          <BusSticker className="size-36" />
        </Sticker>
        <Sticker className="top-[48%] right-[24%] hidden sm:block" tilt={8}>
          <TicketSticker className="size-32" />
        </Sticker>
        <Sticker className="right-[6%] bottom-28 hidden sm:block" tilt={12}>
          <PinSticker className="size-32" />
        </Sticker>
        <Sticker className="right-[30%] bottom-14 hidden lg:block" tilt={-6}>
          <CompassSticker className="size-28" />
        </Sticker>
        <Sticker className="top-12 right-[34%] hidden lg:block" tilt={14}>
          <SimitSticker className="size-24" />
        </Sticker>
      </header>

      {/* Beyaz "boşluk" bölümü: form hero'nun üzerine biner */}
      <main className="relative z-10 mx-auto -mt-28 w-full max-w-6xl flex-1 px-4 pb-24 sm:-mt-36 sm:px-6">
        <Planner cities={listCities()} />
      </main>

      <footer className="bg-accent text-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 text-sm font-semibold sm:px-6">
          <p className="font-display text-2xl uppercase">Gezinti</p>
          <p className="mt-2 max-w-2xl text-white/80">
            Harita ve yer verileri © OpenStreetMap katkıcıları. Sefer saatleri belediyelerin ve işletmelerin yayımladığı
            verilerden gelir; yola çıkmadan kontrol et.
          </p>
        </div>
      </footer>
    </>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 17V3M5 4h9l-2 3.2L14 10H5" />
    </svg>
  );
}

/** Arka plandaki ince eğriler ve istasyonlar; referanstaki çizgi süslerinin karşılığı */
function Curves() {
  return (
    <svg viewBox="0 0 1200 520" className="pointer-events-none absolute inset-0 h-full w-full text-white/35" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
      <path className="hero-line" pathLength={1} d="M-20 440C180 440 220 260 420 260S640 420 820 360 1040 140 1240 120" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M-20 120C140 120 200 40 360 60" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {[
        [420, 260],
        [820, 360],
        [1040, 190],
      ].map(([x, y], i) => (
        <circle key={x} className="hero-station" style={{ animationDelay: `${0.8 + i * 0.4}s` }} cx={x} cy={y} r="11" fill="var(--accent)" stroke="var(--sky)" strokeWidth="5" />
      ))}
    </svg>
  );
}
