/** Gün renkleri (sırayla döner); harita ve liste aynı rengi kullanır */
export const DAY_COLORS = ["#059669", "#2563eb", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626"];

export const dayColor = (day: number) => DAY_COLORS[(day - 1) % DAY_COLORS.length];
