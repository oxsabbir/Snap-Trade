export const darkColors = {
  bg: '#121212',
  surface: '#1A1A1A',
  surfaceAlt: '#242424',
  border: '#2E2E2E',
  text: '#FFFFFF',
  textMuted: '#838383',
  textFaint: '#5C5C5C', // decorative only (placeholders)
  accent: '#00B47D',
  accentSoft: 'rgba(0,180,125,0.42)',
  up: '#00B47D',
  down: '#EB4D5D',
  upText: '#00B47D',
  downText: '#EB4D5D',
  warning: '#F0B90B',
  upFill: 'rgba(0,180,125,0.08)',
  downFill: 'rgba(235,77,93,0.08)',
  gridLine: '#1F1F1F',
  gridBorder: '#2E2E2E',
  overlay: 'rgba(0,0,0,0.55)',
  shadow: '#000000',
  onAccent: '#FFFFFF',
};

export type ThemeColors = Record<keyof typeof darkColors, string>;

export const lightColors: ThemeColors = {
  bg: '#FFFFFF',
  surface: '#F7F7F7',
  surfaceAlt: '#F2F2F2',
  border: '#E6E6E6',
  text: '#121212',
  textMuted: '#767676',
  textFaint: '#B3B3B3',
  accent: '#00B47D',
  accentSoft: 'rgba(0,180,125,0.42)',
  up: '#00B47D',
  down: '#EB4D5D',
  upText: '#00805A',
  downText: '#CF2F44',
  warning: '#F0B90B',
  upFill: 'rgba(0,180,125,0.10)',
  downFill: 'rgba(235,77,93,0.10)',
  gridLine: '#F0F0F0',
  gridBorder: '#E6E6E6',
  overlay: 'rgba(0,0,0,0.4)',
  shadow: '#000000',
  onAccent: '#FFFFFF',
};

/** Alias so existing imports keep working during the migration. */
export const colors: ThemeColors = darkColors;

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
 * would stretch them past a standard reading height.
 *
 * The order view claims the space below the chart with two full-height columns — the depth
 * book and the order form — so the chart's share of the window came down 30% from its original
 * 38%, and `CHART_HEIGHT_REDUCTION` is cut from the result on top of that. A negative value adds
 * height instead, which is the same knob in the other direction.
 *
 * The reduction is a single constant precisely because the clamps are kept in step with it: the
 * floor and the cap are the reduced ones, so a device on the floor, in the middle of the range and
 * on the cap all move by the same amount. Lowering only the ratio would leave every capped device
 * untouched, and lowering only the clamps would leave every device inside the range untouched —
 * both look like the change did nothing on some screen.
 */
export const CHART_HEIGHT_RATIO = 0.266;
export const CHART_HEIGHT_REDUCTION = 20;
export const CHART_MIN_HEIGHT = 190;
export const CHART_MAX_HEIGHT = 218;

export function standardChartHeight(windowHeight: number): number {
  // Guard the degenerate cases rather than letting them through: Math.round(NaN) is NaN, and
  // both Math.min and Math.max propagate it, so an unusable number here would collapse the
  // chart instead of falling back to the smallest sensible height.
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return CHART_MIN_HEIGHT;
  return Math.min(
    CHART_MAX_HEIGHT,
    Math.max(
      CHART_MIN_HEIGHT,
      Math.round(windowHeight * CHART_HEIGHT_RATIO) - CHART_HEIGHT_REDUCTION
    )
  );
}

/**
 * Next chart height, holding steady through a soft-keyboard resize.
 *
 * On Android the window is resized when an input is focused, so `useWindowDimensions().height`
 * shrinks even though the device did not change. The chart is a share of the window, so a
 * height-only change would collapse it while the order form is open. Real device changes —
 * rotation, split screen — change the width too. So the height is only recomputed when the
 * width changes; otherwise the previous value is kept. Extracted so the decision is testable
 * without a renderer.
 */
export function stableChartHeight(
  current: number,
  previousWidth: number,
  width: number,
  windowHeight: number
): number {
  if (width === previousWidth) return current;
  return standardChartHeight(windowHeight);
}
