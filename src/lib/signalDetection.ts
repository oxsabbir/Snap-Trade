export type XNotification = {
  id: number;
  text: string;
  bigText: string;
  postTime: number;
  title: string;
  subText: string;
  packageName: string;
};

export type SignalFormat = 'tp' | 'gem';

export type SignalCheckResult = {
  isSignal: boolean;
  format: SignalFormat | null;
  ticker: string | null;
  tp1: number | null;
  tpCount: number;
  /** Market price from a gem-format post, as the plain decimal string it was posted as. */
  entry: string | null;
};

function normalizeNumber(str: string): number | null {
  if (!str) return null;
  const normalized = str.replace(',', '.');
  const match = normalized.match(/^-?(\d*\.\d+|\d+)$/);
  if (!match) return null;
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : null;
}

function extractTicker(text: string): string | null {
  const match = text.match(/\$([A-Za-z0-9]+)/);
  return match ? match[1].toUpperCase() : null;
}

function extractTPs(text: string): number[] {
  const tps: number[] = [];
  const tpRegex = /(?:TP|tp|T\.P)\s*[.:]?\s*(\d+)\s*[=:]\s*([\d,.]+)/gi;
  let match;

  while ((match = tpRegex.exec(text)) !== null) {
    const tpNum = parseInt(match[1], 10);
    const tpValue = normalizeNumber(match[2]);
    if (tpNum >= 1 && tpNum <= 10 && tpValue !== null) {
      tps.push(tpValue);
    }
  }

  // Also catch formats like "TP 1 0.0160" or "Tp1:0.0160" without = 
  const tpRegexAlt = /(?:TP|tp|T\.P)\s*(\d+)\s+([\d,.]+)(?!\s*[=:])/gi;
  while ((match = tpRegexAlt.exec(text)) !== null) {
    const tpNum = parseInt(match[1], 10);
    const tpValue = normalizeNumber(match[2]);
    if (tpNum >= 1 && tpNum <= 10 && tpValue !== null) {
      // Avoid duplicates
      if (!tps.some((existing, i) => i + 1 === tpNum && Math.abs(existing - tpValue) < 0.0001)) {
        tps.push(tpValue);
      }
    }
  }

  // Sort by TP number (1, 2, 3...)
  return tps;
}

/**
 * Gem-format anchor, mirroring the native listener: the constant marker phrase plus a
 * `Current market price - X $` line. Returns the price as the plain posted decimal string.
 */
function extractGemEntry(text: string): string | null {
  if (!/buying\s+this\s+gem\s+on\s+#?kucoin/i.test(text)) return null;
  const match = text.match(/current\s+market\s+price\s*[-–:]?\s*([\d.,]+)/i);
  if (!match) return null;
  const normalized = match[1].replace(',', '.');
  return /^\d+(\.\d+)?$/.test(normalized) ? normalized : null;
}

export function checkForSignal(notification: XNotification): SignalCheckResult {
  const primaryText = notification.bigText?.trim() || notification.text?.trim() || '';

  if (!primaryText) {
    return { isSignal: false, format: null, ticker: null, tp1: null, tpCount: 0, entry: null };
  }

  const ticker = extractTicker(primaryText);
  const tps = extractTPs(primaryText);
  const tpCount = tps.length;
  const tp1 = tps[0] ?? null;

  // Format 1: cashtag + ≥3 numbered TPs. Format 2 (gem posts): cashtag + marker + market
  // price — the trailing cashtag list in gem posts is a decoy; only the first cashtag counts.
  const entry = tpCount >= 3 ? null : extractGemEntry(primaryText);
  const format: SignalFormat | null = tpCount >= 3 ? 'tp' : entry !== null ? 'gem' : null;
  const isSignal = ticker !== null && format !== null;

  return { isSignal, format, ticker, tp1, tpCount, entry };
}