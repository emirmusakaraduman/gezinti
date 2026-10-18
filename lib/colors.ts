/** Gün renkleri (sırayla döner); harita ve liste aynı rengi kullanır. İznik paletiyle uyumlu, birbirinden ayırt edilir. */
export const DAY_COLORS = ["#0a8f9c", "#2f5bea", "#e5483a", "#8a5cf6", "#d98e00", "#0f8b5f", "#c2365d"];

export const dayColor = (day: number) => DAY_COLORS[(day - 1) % DAY_COLORS.length];
