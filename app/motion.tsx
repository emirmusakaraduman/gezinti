"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Kullanıcı hareketi azaltmak istiyorsa true; animasyonlar atlanır */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(QUERY);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * Ekrana girince yumuşakça belirir (bir kez). delay, art arda gelen öğelerin
 * sırayla belirmesi içindir.
 */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${shown ? "in" : ""} ${className}`}
      style={shown ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/** 0'dan hedefe yumuşak yavaşlayan sayaç (hareket azaltılmışsa doğrudan hedef) */
export function useCountUp(target: number, ms = 1000): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setValue(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);

  return reduced ? target : value;
}

/** formatRange ile aynı biçimde, ama sayılar yukarı sayar */
export function CountRange({ min, max, className }: { min: number; max: number; className?: string }) {
  const a = useCountUp(min);
  const b = useCountUp(max);
  const fmt = (n: number) => Math.round(n).toLocaleString("tr-TR");
  const text = max === 0 ? "Ücretsiz" : min === max ? `${fmt(a)} TL` : `${fmt(a)}–${fmt(b)} TL`;
  return <span className={className}>{text}</span>;
}
