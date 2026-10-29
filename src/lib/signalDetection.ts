export type XNotification = {
  id: number;
  text: string;
  bigText: string;
  postTime: number;
  title: string;
  subText: string;
  packageName: string;
};

export type SignalFormat = 'tp' | 'gem' | 'cmp';

export type SignalCheckResult = {
  isSignal: boolean;
  format: SignalFormat | null;
  ticker: string | null;
  tp1: number | null;
  tpCount: number;
  /** Market price from a gem- or cmp-format post, as the plain decimal string it was posted as. */
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

export const IGNORED_WORDS = new Set([
  ...IGNORED_TAGS,
  'DEX',
  'CEX',
  'UNISWAP',
  'PANCAKESWAP',
  'CALL',
  'CALLS',
  'PREMIUM',
  'ALERT',
  'ALERTS',
  'UPDATE',
  'UPDATES',
  'NEWS',
  'TRADE',
  'TRADES',
  'TRADING',
  'SETUP',
  'SETUPS',
  'BUY',
  'BUYING',
  'BOUGHT',
  'SELL',
  'SELLING',
  'SOLD',
  'LONG',
  'SHORT',
  'SPOT',
  'FUTURES',
  'FUTURE',
  'HOLD',
  'HODL',
  'ENTRIES',
  'STOP',
  'LOSS',
  'TP',
  'SL',
  'PROFIT',
  'PROFITS',
  'LEVERAGE',
  'MARGIN',
  'RISK',
  'MARKET',
  'MARKETS',
  'MCAP',
  'MC',
  'CAP',
  'CAPITAL',
  'PRICE',
  'PRICES',
  'VOLUME',
  'VOL',
  'HIGH',
  'LOW',
  'ATH',
  'GEM',
  'GEMS',
  'COIN',
  'COINS',
  'TOKEN',
  'TOKENS',
  'PAIR',
  'PAIRS',
  'ALTCOIN',
  'ALTCOINS',
  'CRYPTO',
  'CRYPTOS',
  'PROJECT',
  'PROJECTS',
  'ALPHA',
  'BETA',
  'BULLISH',
  'BEARISH',
  'PUMP',
  'PUMPING',
  'DUMP',
  'MOON',
  'ROCKET',
  'BOMB',
  'LISTING',
  'LISTED',
  'LAUNCH',
  'PRESALE',
  'TODAY',
  'TONIGHT',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'NOW',
  'SOON',
  'HERE',
  'NEXT',
  'NEW',
  'FIRST',
  'LAST',
  'BEST',
  'TOP',
  'BIG',
  'HUGE',
  'MASSIVE',
  'EASY',
  'GOOD',
  'GREAT',
  'SUPER',
  'FREE',
  'ON',
  'IN',
  'AT',
  'TO',
  'FOR',
  'OF',
  'WITH',
  'FROM',
  'BY',
  'THE',
  'THIS',
  'THAT',
  'THESE',
  'THOSE',
  'A',
  'AN',
  'AND',
  'OR',
  'IS',
  'ARE',
  'WAS',
  'WERE',
  'HAVE',
  'HAS',
  'HAD',
  'WILL',
  'CAN',
  'COULD',
  'WOULD',
  'SHOULD',
  'ABOUT',
  'INTO',
  'OVER',
  'AFTER',
  'BEFORE',
  'UNDER',
  'ABOVE',
  'MORNING',
  'EVENING',
  'NIGHT',
  'TRADERS',
  'HELLO',
  'HEY',
  'CHECK',
  'WATCH',
  'LOOK',
  'READY',
]);

function normalizeNumber(str: string): number | null {
  if (!str) return null;
  const normalized = str.replace(',', '.');
  const match = normalized.match(/^-?(\d*\.\d+|\d+)$/);
  if (!match) return null;
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : null;
}

function extractFallbackTicker(text: string): string | null {
  // Cutoff before Market Cap (MC, MCAP, Market Cap)
  const mcMatch = text.search(/\b(?:MC|MCAP|MARKET\s*CAP)\b/i);
  const region = mcMatch !== -1 ? text.slice(0, mcMatch) : text;

  // Scan lines from top to bottom
  const lines = region.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Extract candidate words (letters + optional digits, starting with a letter)
    const words = line.match(/\b[A-Za-z][A-Za-z0-9]*\b/g);
    if (!words) continue;

    // Filter out ignored words
    const candidates = words
      .map((w) => w.toUpperCase())
      .filter((w) => w.length >= 2 && w.length <= 10 && !IGNORED_WORDS.has(w));

    // Must have at least 1 valid candidate and line must not be a long sentence (<= 4 words total)
    if (candidates.length >= 1 && words.length <= 4) {
      return candidates[0];
    }
  }

  return null;
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

  // Priority 3: Fallback plain-text ticker before MC/TP
  return extractFallbackTicker(text);
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
 * Cmp-format anchor, mirroring the native listener: a "buy" context marker (covers `Buying`,
 * `Buy`, … after letters/digits-only normalization) plus a literal `CMP <price>` — e.g.
 * `$CHO on Kucoin Buying CMP 0.000552 Keeping high targets SL manage`. The word `CMP` is the
 * anchor because it carries an exact closing price, unlike prose ("high targets", "SL manage").
 */
function hasBuyMarker(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.includes('buy');
}

function extractCmpEntry(text: string): { entry: string | null; priceIndex: number | null } {
  if (!hasBuyMarker(text)) return { entry: null, priceIndex: null };
  const match = text.match(/\bCMP\b\s*[-–:=]?\s*([\d.,]+)/i);
  if (!match || match.index === undefined) return { entry: null, priceIndex: null };
  const normalized = match[1].replace(',', '.');
  const valid = /^\d+(\.\d+)?$/.test(normalized) ? normalized : null;
  return { entry: valid, priceIndex: match.index };
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
  // Format 3: cashtag/hashtag + buy marker + a literal `CMP <price>`.
  // Trailing cashtag lists at the bottom of all formats are decoys and excluded by the cutoff.
  const isTpSignal = tpCount >= 3;
  const gemResult = isTpSignal ? { entry: null, priceIndex: null } : extractGemEntry(primaryText);
  const cmpResult =
    isTpSignal || gemResult.entry
      ? { entry: null, priceIndex: null }
      : extractCmpEntry(primaryText);
  const entry = gemResult.entry ?? cmpResult.entry;

  const cutoffIndex = gemResult.priceIndex ?? cmpResult.priceIndex;
  const searchRegion =
    isTpSignal && firstTpIndex !== null
      ? primaryText.slice(0, firstTpIndex)
      : !isTpSignal && cutoffIndex !== null
        ? primaryText.slice(0, cutoffIndex)
        : primaryText;

  const ticker = extractTicker(searchRegion);
  const format: SignalFormat | null =
    isTpSignal ? 'tp' : gemResult.entry !== null ? 'gem' : cmpResult.entry !== null ? 'cmp' : null;
  const isSignal = ticker !== null && format !== null;

  return { isSignal, format, ticker, tp1, tpCount, entry };
}