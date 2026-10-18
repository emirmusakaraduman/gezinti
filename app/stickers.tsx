"use client";

import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";

/**
 * Hero'daki sürüklenebilir çıkartma. Süslemedir: ekran okuyuculardan gizlenir, klavye ile
 * odaklanmaz. Tarayıcı kaydırmasını engellemez (yalnızca çıkartmanın üzerinde touch-action kapalı).
 */
export function Sticker({
  children,
  className = "",
  tilt = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Derece cinsinden eğim */
  tilt?: number;
}) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    setDragging(true);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (s) setPos({ x: s.ox + e.clientX - s.sx, y: s.oy + e.clientY - s.sy });
  };
  const onUp = () => {
    start.current = null;
    setDragging(false);
  };

  return (
    <div
      aria-hidden="true"
      className={`sticker absolute ${dragging ? "dragging" : ""} ${className}`}
      style={{ "--tilt": `${tilt}deg`, transform: `translate(${pos.x}px, ${pos.y}px)` } as CSSProperties}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {children}
    </div>
  );
}

const NAVY = "#0c0866";

/** Çıkartma gövdesi: beyaz kalın dış çizgi + renkli dolgu */
function Shape({ d, fill }: { d: string; fill: string }) {
  return (
    <>
      <path d={d} fill="#fff" stroke="#fff" strokeWidth="14" strokeLinejoin="round" />
      <path d={d} fill={fill} stroke={NAVY} strokeWidth="3" strokeLinejoin="round" />
    </>
  );
}

const svg = { viewBox: "0 0 120 120", fill: "none" } as const;

export function BusSticker({ className = "size-28" }: { className?: string }) {
  const body = "M20 34a12 12 0 0 1 12-12h56a12 12 0 0 1 12 12v44a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8z";
  return (
    <svg {...svg} className={className}>
      <circle cx="38" cy="90" r="11" fill="#fff" />
      <circle cx="82" cy="90" r="11" fill="#fff" />
      <Shape d={body} fill="#ff1fa9" />
      <rect x="30" y="34" width="60" height="26" rx="5" fill="#fff" stroke={NAVY} strokeWidth="3" />
      <path d="M60 34v26" stroke={NAVY} strokeWidth="3" />
      <circle cx="34" cy="74" r="4" fill="#ffe14a" stroke={NAVY} strokeWidth="2" />
      <circle cx="86" cy="74" r="4" fill="#ffe14a" stroke={NAVY} strokeWidth="2" />
      <circle cx="38" cy="90" r="8" fill={NAVY} />
      <circle cx="82" cy="90" r="8" fill={NAVY} />
    </svg>
  );
}

export function TicketSticker({ className = "size-28" }: { className?: string }) {
  const d = "M14 34h92v18a8 8 0 0 0 0 16v18H14V68a8 8 0 0 0 0-16z";
  return (
    <svg {...svg} className={className}>
      <Shape d={d} fill="#2de2e6" />
      <path d="M84 40v40" stroke={NAVY} strokeWidth="3" strokeDasharray="4 5" />
      <text x="26" y="66" fontSize="20" fontWeight="800" fontStyle="italic" fill={NAVY} style={{ fontFamily: "var(--font-display)" }}>
        GEZİ
      </text>
      <circle cx="95" cy="60" r="5" fill="#ff1fa9" stroke={NAVY} strokeWidth="2" />
    </svg>
  );
}

export function PinSticker({ className = "size-28" }: { className?: string }) {
  const d = "M60 108S27 77 27 50a33 33 0 0 1 66 0c0 27-33 58-33 58z";
  return (
    <svg {...svg} className={className}>
      <Shape d={d} fill="#ff1fa9" />
      <circle cx="60" cy="50" r="13" fill="#fff" stroke={NAVY} strokeWidth="3" />
    </svg>
  );
}

export function CompassSticker({ className = "size-28" }: { className?: string }) {
  return (
    <svg {...svg} className={className}>
      <circle cx="60" cy="60" r="44" fill="#fff" stroke="#fff" strokeWidth="14" />
      <circle cx="60" cy="60" r="44" fill="#fff" stroke={NAVY} strokeWidth="3" />
      <circle cx="60" cy="60" r="35" fill="#e9e7ff" stroke={NAVY} strokeWidth="2" />
      <path d="M60 26l12 34H48z" fill="#ff1fa9" stroke={NAVY} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M60 94L48 60h24z" fill="#1c13ff" stroke={NAVY} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="60" cy="60" r="4.5" fill="#fff" stroke={NAVY} strokeWidth="2" />
    </svg>
  );
}

/** Simit: yerel bir gönderme; susam taneleriyle */
export function SimitSticker({ className = "size-28" }: { className?: string }) {
  const seeds = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    return { x: 60 + Math.cos(a) * 33, y: 60 + Math.sin(a) * 33, r: (i * 37) % 60 };
  });
  return (
    <svg {...svg} className={className}>
      <circle cx="60" cy="60" r="33" stroke="#fff" strokeWidth="38" />
      <circle cx="60" cy="60" r="33" stroke="#ffb02e" strokeWidth="26" />
      <circle cx="60" cy="60" r="33" stroke={NAVY} strokeWidth="2.5" strokeDasharray="1 0" opacity="0" />
      {seeds.map((s, i) => (
        <ellipse key={i} cx={s.x} cy={s.y} rx="3.2" ry="1.7" transform={`rotate(${s.r} ${s.x} ${s.y})`} fill="#fff6d6" />
      ))}
    </svg>
  );
}
