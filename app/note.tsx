import type { ReactNode } from "react";

const TONE = {
  accent: "text-accent",
  magenta: "text-magenta",
  sky: "text-sky",
  white: "text-white",
  ink: "text-ink",
} as const;

/**
 * El yazısı kenar notu (Caveat). Kesinlikle süstür: ekran okuyucuya yararlı bilgi vermez,
 * bu yüzden gizlenir; önemli bilgi her zaman normal metinde de bulunur.
 *
 * arrow: okun yönü (derece; 0 sağa, 90 aşağı, 180 sola, -90 yukarı). Ok metnin yanına konur.
 * arrowFirst: ok metinden önce gelsin. underline: metnin altına dalgalı çizgi. big: daha büyük yazı.
 */
export function Note({
  children,
  tone = "accent",
  tilt = -2,
  arrow,
  arrowFirst = false,
  flip = false,
  underline = false,
  big = false,
  className = "",
}: {
  children: ReactNode;
  tone?: keyof typeof TONE;
  tilt?: number;
  arrow?: number;
  arrowFirst?: boolean;
  flip?: boolean;
  underline?: boolean;
  big?: boolean;
  className?: string;
}) {
  const arrowEl =
    arrow === undefined ? null : (
      <svg
        viewBox="0 0 60 40"
        className="inline-block h-8 w-12 shrink-0"
        style={{ transform: `rotate(${arrow}deg) ${flip ? "scaleY(-1)" : ""}` }}
        fill="none"
        aria-hidden="true"
      >
        <path d="M4 8c20 0 36 6 44 22M48 30l-10-4M48 30l2-11" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  return (
    <p
      aria-hidden="true"
      className={`font-hand pointer-events-none inline-flex items-center gap-1.5 leading-none select-none ${big ? "text-4xl sm:text-5xl" : "text-2xl sm:text-3xl"} ${TONE[tone]} ${className}`}
      style={{ rotate: `${tilt}deg` }}
    >
      {arrowFirst && arrowEl}
      <span className="relative">
        {children}
        {underline && (
          <svg viewBox="0 0 120 10" preserveAspectRatio="none" className="absolute right-0 -bottom-2 left-0 h-2 w-full" fill="none">
            <path d="M2 6c10-6 14 6 24 0s14 6 24 0 14 6 24 0 14 6 24 0 14 6 20 0" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
      </span>
      {!arrowFirst && arrowEl}
    </p>
  );
}
