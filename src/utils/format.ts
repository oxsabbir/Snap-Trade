const groupSeparator = ',';

const MAX_TICK_DECIMALS = 12;

/** KuCoin publishes a price increment per symbol; its decimal count is the display precision. */
export function decimalsFromIncrement(increment: string): number {
  const dot = increment.indexOf('.');
  if (dot === -1) return 0;
  return Math.min(increment.length - dot - 1, MAX_TICK_DECIMALS);
}

/** KuCoin-style adaptive precision so cheap coins keep their small digits visible. */
export function formatPrice(value: number, decimals?: number): string {
  if (!Number.isFinite(value)) return '-';
  const abs = Math.abs(value);

  let precision: number;
  if (decimals !== undefined) {
    precision = decimals;
  } else if (abs >= 1_000) precision = 2;
  else if (abs >= 1) precision = 4;
  else if (abs >= 0.01) precision = 6;
  else if (abs >= 0.0001) precision = 6;
  else precision = 8;

  const [whole, fraction = ''] = abs.toFixed(precision).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator);
  const sign = value < 0 ? '-' : '';
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/** Fee rates arrive as fractions, e.g. 0.001. Rendered without a leading plus. */
export function formatRate(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(decimals)}%`;
}

/** Parses a KuCoin decimal string, returning null when absent or non-numeric. */
export function parseNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Balances: significant digits, trailing zeros trimmed, thousands grouped. */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  const abs = Math.abs(value);
  const precision = abs >= 1 ? 6 : abs >= 0.0001 ? 8 : 12;
  const trimmed = value.toFixed(precision).replace(/\.?0+$/, '');
  const [whole = '0', fraction] = trimmed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator);
  return fraction ? `${grouped}.${fraction}` : grouped;
}

const COMPACT_UNITS = [
  { threshold: 1_000_000_000, suffix: 'B' },
  { threshold: 1_000_000, suffix: 'M' },
  { threshold: 1_000, suffix: 'K' },
] as const;

export function formatCompact(value: number, maxDecimals = 2): string {
  if (!Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  for (const unit of COMPACT_UNITS) {
    if (abs >= unit.threshold) {
      const scaled = value / unit.threshold;
      return `${scaled.toFixed(maxDecimals)}${unit.suffix}`;
    }
  }
  return value.toFixed(abs >= 1 ? 0 : 2);
}

export function formatTime(timestamp: number | null): string {
  if (!timestamp) return '--:--:--';
  const date = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Deterministic hue so a coin keeps the same avatar colour across renders. */
export function hashToHue(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 360;
  }
  return hash;
}
