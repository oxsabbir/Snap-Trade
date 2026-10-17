export type XNotification = {
  id: number;
  text: string;
  bigText: string;
  postTime: number;
  title: string;
  subText: string;
  packageName: string;
};

export type SignalCheckResult = {
  isSignal: boolean;
  ticker: string | null;
  tp1: number | null;
  tpCount: number;
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

export function checkForSignal(notification: XNotification): SignalCheckResult {
  const primaryText = notification.bigText?.trim() || notification.text?.trim() || '';
  
  if (!primaryText) {
    return { isSignal: false, ticker: null, tp1: null, tpCount: 0 };
  }

  const ticker = extractTicker(primaryText);
  const tps = extractTPs(primaryText);
  const tpCount = tps.length;
  const tp1 = tps[0] ?? null;

  const isSignal = ticker !== null && tpCount >= 3;

  return { isSignal, ticker, tp1, tpCount };
}