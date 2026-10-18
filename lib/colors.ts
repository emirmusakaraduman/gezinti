/**
 * Gün renkleri (sırayla döner); harita çizgileri ve gün noktalarında kullanılır. Elektrik
 * paletinden: kobalt, magenta, gök mavisi, sonra ayırt edilebilir tamamlayıcılar.
 */
export const DAY_COLORS = ["#1c13ff", "#ff1fa9", "#0fb8c6", "#8a2cff", "#f59e0b", "#0aa56f", "#ef4444"];

export const dayColor = (day: number) => DAY_COLORS[(day - 1) % DAY_COLORS.length];
