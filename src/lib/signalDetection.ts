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

export const IGNORED_TAGS = new Set([
  'KUCOIN',
  'MEXC',
  'BINANCE',
  'BYBIT',
  'GATEIO',
  'OKX',
  'BITGET',
  'COINBASE',
  'KRAKEN',
  'HTX',
  'HUOBI',
  'SIGNAL',
  'SIGNALS',
  'VIP',
  'ENTRY',
  'TARGET',
  'TARGETS',
  'STOPLOSS',
]);

function normalizeNumber(str: string): number | null {
  if (!str) return null;
  const normalized = str.replace(',', '.');
  const match = normalized.match(/^-?(\d*\.\d+|\d+)$/);
  if (!match) return null;
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : null;
}

function extractTicker(text: string): string | null {
  // Priority 1: Cashtag $TICKER
  const cashMatch = text.match(/\$([A-Za-z0-9]+)/);
  if (cashMatch) {
    return cashMatch[1].toUpperCase();
  }

  // Priority 2: Hashtag #TICKER (excluding ignored exchange and system tags)
  const hashRegex = /#([A-Za-z0-9]+)/g;
  let hashMatch: RegExpExecArray | null;
  while ((hashMatch = hashRegex.exec(text)) !== null) {
    const tag = hashMatch[1].toUpperCase();
    if (!IGNORED_TAGS.has(tag) && tag.length >= 2 && tag.length <= 10) {
      return tag;
    }
  }

  return null;
}

type TPsResult = {
  tps: number[];
  firstTpIndex: number | null;
};

function extractTPs(text: string): TPsResult {
  const tps: number[] = [];
  let firstTpIndex: number | null = null;
  const tpRegex = /(?:TP|tp|T\.P)\s*[.:]?\s*(\d+)\s*[=:]\s*([\d,.]+)/gi;
  let match;

  while ((match = tpRegex.exec(text)) !== null) {
    const tpNum = parseInt(match[1], 10);
    const tpValue = normalizeNumber(match[2]);
    if (tpNum >= 1 && tpNum <= 10 && tpValue !== null) {
      tps.push(tpValue);
      if (firstTpIndex === null || match.index < firstTpIndex) {
        firstTpIndex = match.index;
      }
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
        if (firstTpIndex === null || match.index < firstTpIndex) {
          firstTpIndex = match.index;
        }
      }
    }
  }

  return { tps, firstTpIndex };
}

function hasGemMarker(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.includes('buyingthisgemonkucoin');
}

/**
 * Gem-format anchor, mirroring the native listener: the constant marker phrase plus a
 * `Current market price - X $` line. Returns the price as the plain posted decimal string
 * and the character index where the price line starts (used as a cutoff for decoys).
 */
function extractGemEntry(text: string): { entry: string | null; priceIndex: number | null } {
  if (!hasGemMarker(text)) return { entry: null, priceIndex: null };
  const match = text.match(/current\s+market\s+price\s*[-–:]?\s*([\d.,]+)/i);
  if (!match || match.index === undefined) return { entry: null, priceIndex: null };
  const normalized = match[1].replace(',', '.');
  const valid = /^\d+(\.\d+)?$/.test(normalized) ? normalized : null;
  return { entry: valid, priceIndex: match.index };
}

export function checkForSignal(notification: XNotification): SignalCheckResult {
  const primaryText = notification.bigText?.trim() || notification.text?.trim() || '';

  if (!primaryText) {
    return { isSignal: false, format: null, ticker: null, tp1: null, tpCount: 0, entry: null };
  }

  const { tps, firstTpIndex } = extractTPs(primaryText);
  const tpCount = tps.length;
  const tp1 = tps[0] ?? null;

  // Format 1: cashtag/hashtag + ≥3 numbered TPs (ticker searched before the first TP).
  // Format 2: cashtag/hashtag + gem marker + market price (ticker searched before market price).
  // Trailing cashtag lists at the bottom of both formats are decoys and excluded by the cutoff.
  const isTpSignal = tpCount >= 3;
  const gemResult = isTpSignal ? { entry: null, priceIndex: null } : extractGemEntry(primaryText);
  const entry = gemResult.entry;

  const searchRegion =
    isTpSignal && firstTpIndex !== null
      ? primaryText.slice(0, firstTpIndex)
      : !isTpSignal && gemResult.priceIndex !== null
        ? primaryText.slice(0, gemResult.priceIndex)
        : primaryText;

  const ticker = extractTicker(searchRegion);
  const format: SignalFormat | null = isTpSignal ? 'tp' : entry !== null ? 'gem' : null;
  const isSignal = ticker !== null && format !== null;

  return { isSignal, format, ticker, tp1, tpCount, entry };
}