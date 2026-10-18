/**
 * Gün renkleri (sırayla döner): yalnızca harita çizgileri ve gün noktalarında kullanılır.
 * Arayüz siyah-beyazdır; gün ayrımı için canlı, açık ve koyu zeminde okunan tonlar.
 */
export const DAY_COLORS = ["#e11d48", "#2563eb", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777"];

export const dayColor = (day: number) => DAY_COLORS[(day - 1) % DAY_COLORS.length];
