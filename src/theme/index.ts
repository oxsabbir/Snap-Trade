export const colors = {
  bg: '#0E0E0E',
  surface: '#17181A',
  surfaceAlt: '#1F2023',
  border: '#242629',
  text: '#E8E9EA',
  textMuted: '#8A8D91',
  textFaint: '#5C6066',
  accent: '#23AF89',
  /** Same hue, de-emphasised. Second segment of the wallet split bar. */
  accentSoft: 'rgba(35,175,137,0.42)',
  up: '#23AF89',
  down: '#F6465D',
  warning: '#F0B90B',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

/**
 * The chart holds a standard share of the screen instead of consuming all the leftover
 * space, which is what the other trading apps do and what leaves room for the ordering UI
 * below it. It is derived from the window so it scales with the device, then clamped at both
 * ends: a short device would otherwise squeeze the candles into a sliver, and a tall one
 * would stretch them past the point where the volume panel is worth showing.
 */
export const CHART_HEIGHT_RATIO = 0.38;
export const CHART_MIN_HEIGHT = 260;
export const CHART_MAX_HEIGHT = 340;

export function standardChartHeight(windowHeight: number): number {
  // Guard the degenerate cases rather than letting them through: Math.round(NaN) is NaN, and
  // both Math.min and Math.max propagate it, so an unusable number here would collapse the
  // chart instead of falling back to the smallest sensible height.
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return CHART_MIN_HEIGHT;
  return Math.min(
    CHART_MAX_HEIGHT,
    Math.max(CHART_MIN_HEIGHT, Math.round(windowHeight * CHART_HEIGHT_RATIO))
  );
}
