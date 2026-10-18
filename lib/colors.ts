/**
 * Gün renkleri (sırayla döner); harita ve liste aynı rengi kullanır. "Akşam Boğazı"
 * paletinden: hepsi beyaz yazıyla okunur, birbirinden ayırt edilir.
 */
export const DAY_COLORS = ["#5646d9", "#d97706", "#e1456b", "#17895f", "#2c78c4", "#a24bd0", "#6b6a8f"];

export const dayColor = (day: number) => DAY_COLORS[(day - 1) % DAY_COLORS.length];
