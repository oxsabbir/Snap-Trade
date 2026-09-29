/**
 * Decimal-safe arithmetic for order prices and sizes.
 *
 * KuCoin takes order amounts as decimal strings and rejects a size that is not an exact
 * multiple of the symbol's increment. Doing that with doubles is unsafe: `0.1 * 3` is
 * `0.30000000000000004`, and the usual `Math.round(v / inc) * inc` snap drifts by a whole
 * tick for increments like `0.1`. This module does the arithmetic on scaled integers held as
 * strings, so no amount is ever routed through a double.
 *
 * It deliberately does not use `BigInt`: Hermes' BigInt support is not guaranteed across the
 * Expo SDKs this app can target, and it cannot be polyfilled. Everything here is plain string
 * and digit-array math. The test suite cross-checks every operation against native BigInt as
 * an oracle, so the implementation is verified exactly where BigInt is available even though
 * the app does not depend on it.
 */

export type ParsedDecimal = {
  /** `-1` or `1`. Zero is always positive; use `isZeroDecimal` rather than the sign. */
  sign: 1 | -1;
  /** Digits with no leading zeros. `'0'` for zero. */
  digits: string;
  /** Value = `sign * digits * 10^-scale`. */
  scale: number;
};

const DECIMAL_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** Strips leading zeros, keeping a single `'0'` for an all-zero string. */
function stripLeadingZeros(digits: string): string {
  const trimmed = digits.replace(/^0+/, '');
  return trimmed === '' ? '0' : trimmed;
}

/** Compares two non-negative integer digit strings. */
function compareDigits(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Adds two non-negative integer digit strings. */
function addDigits(a: string, b: string): string {
  let i = a.length - 1;
  let j = b.length - 1;
  let carry = 0;
  let out = '';
  while (i >= 0 || j >= 0 || carry > 0) {
    const da = i >= 0 ? a.charCodeAt(i) - 48 : 0;
    const db = j >= 0 ? b.charCodeAt(j) - 48 : 0;
    const sum = da + db + carry;
    out = String(sum % 10) + out;
    carry = sum >= 10 ? 1 : 0;
    i -= 1;
    j -= 1;
  }
  return stripLeadingZeros(out);
}

/** Subtracts `b` from `a`, both non-negative integer digit strings, assuming `a >= b`. */
function subtractDigits(a: string, b: string): string {
  let i = a.length - 1;
  let j = b.length - 1;
  let borrow = 0;
  let out = '';
  while (i >= 0) {
    let da = a.charCodeAt(i) - 48 - borrow;
    const db = j >= 0 ? b.charCodeAt(j) - 48 : 0;
    borrow = 0;
    if (da < db) {
      da += 10;
      borrow = 1;
    }
    out = String(da - db) + out;
    i -= 1;
    j -= 1;
  }
  return stripLeadingZeros(out);
}

/** Multiplies two non-negative integer digit strings. */
function multiplyDigits(a: string, b: string): string {
  if (a === '0' || b === '0') return '0';
  const result = new Array<number>(a.length + b.length).fill(0);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const da = a.charCodeAt(i) - 48;
    let carry = 0;
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const db = b.charCodeAt(j) - 48;
      const pos = i + j + 1;
      const sum = result[pos]! + da * db + carry;
      result[pos] = sum % 10;
      carry = Math.floor(sum / 10);
    }
    result[i] = result[i]! + carry;
  }
  return stripLeadingZeros(result.join(''));
}

/** Long division of two non-negative integer digit strings. `b` must be non-zero. */
function divideDigits(a: string, b: string): { quotient: string; remainder: string } {
  if (b === '0') return { quotient: '0', remainder: a };
  if (compareDigits(a, b) < 0) return { quotient: '0', remainder: a };

  let quotient = '';
  let remainder = '0';
  for (let i = 0; i < a.length; i += 1) {
    const current = stripLeadingZeros((remainder === '0' ? '' : remainder) + a[i]!);
    let digit = 0;
    while (digit < 9 && compareDigits(multiplyDigits(b, String(digit + 1)), current) <= 0) {
      digit += 1;
    }
    quotient += String(digit);
    remainder = subtractDigits(current, multiplyDigits(b, String(digit)));
  }
  return { quotient: stripLeadingZeros(quotient), remainder: stripLeadingZeros(remainder) };
}

/** Renders an integer digit string back as a decimal, trimming trailing fraction zeros. */
function formatDigits(sign: 1 | -1, digits: string, scale: number): string {
  if (digits === '0') return '0';
  const padded = digits.padStart(scale + 1, '0');
  const intPart = scale === 0 ? padded : padded.slice(0, padded.length - scale);
  const fraction = scale === 0 ? '' : padded.slice(padded.length - scale).replace(/0+$/, '');
  const body = fraction ? `${intPart}.${fraction}` : intPart;
  return sign < 0 ? `-${body}` : body;
}

/** Parses a decimal string, or returns `null` for anything malformed. */
export function parseDecimal(value: string): ParsedDecimal | null {
  const trimmed = value.trim();
  if (!DECIMAL_RE.test(trimmed)) return null;
  const sign: 1 | -1 = trimmed.startsWith('-') ? -1 : 1;
  const unsigned = trimmed.replace(/^[+-]/, '');
  const dot = unsigned.indexOf('.');
  if (dot === -1) {
    return { sign, digits: stripLeadingZeros(unsigned), scale: 0 };
  }
  const intPart = unsigned.slice(0, dot);
  const fraction = unsigned.slice(dot + 1);
  return { sign, digits: stripLeadingZeros(intPart + fraction), scale: fraction.length };
}

export function isZeroDecimal(value: ParsedDecimal): boolean {
  return value.digits === '0';
}

/** Rescales a parsed decimal's digits to a larger scale. Requires `scale >= value.scale`. */
function widenDigits(value: ParsedDecimal, scale: number): string {
  return stripLeadingZeros(value.digits + '0'.repeat(scale - value.scale));
}

/**
 * Compares two decimal strings numerically. Returns `-1`, `0` or `1`, or `null` if either
 * input is not a valid decimal.
 */
export function compareDecimal(a: string, b: string): number | null {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  if (!left || !right) return null;

  const leftZero = isZeroDecimal(left);
  const rightZero = isZeroDecimal(right);
  if (leftZero && rightZero) return 0;

  const leftSign = leftZero ? 0 : left.sign;
  const rightSign = rightZero ? 0 : right.sign;
  if (leftSign !== rightSign) return leftSign < rightSign ? -1 : 1;

  const scale = Math.max(left.scale, right.scale);
  const magnitude = compareDigits(widenDigits(left, scale), widenDigits(right, scale));
  return leftSign < 0 ? -magnitude : magnitude;
}

/**
 * Snaps a non-negative decimal to the nearest multiple of `increment`.
 *
 * `'nearest'` rounds half away from zero; `'floor'` truncates down. Returns `null` for
 * malformed, negative, or zero-increment inputs. The result is a decimal string, so it can be
 * sent to KuCoin unchanged.
 */
export function snapToIncrement(
  value: string,
  increment: string,
  mode: 'nearest' | 'floor' = 'nearest'
): string | null {
  const amount = parseDecimal(value);
  const step = parseDecimal(increment);
  if (!amount || !step) return null;
  if (amount.sign < 0 || step.sign < 0 || isZeroDecimal(step)) return null;

  const scale = Math.max(amount.scale, step.scale);
  const scaledAmount = widenDigits(amount, scale);
  const scaledStep = widenDigits(step, scale);
  const { remainder } = divideDigits(scaledAmount, scaledStep);

  if (remainder === '0') return formatDigits(1, scaledAmount, scale);

  const floored = subtractDigits(scaledAmount, remainder);
  if (mode === 'floor') return formatDigits(1, floored, scale);

  const twiceRemainder = multiplyDigits(remainder, '2');
  const rounded = compareDigits(twiceRemainder, scaledStep) >= 0 ? addDigits(floored, scaledStep) : floored;
  return formatDigits(1, rounded, scale);
}

/** True when `value` is an exact multiple of `increment`. `null` for malformed input. */
export function isMultipleOf(value: string, increment: string): boolean | null {
  const amount = parseDecimal(value);
  const step = parseDecimal(increment);
  if (!amount || !step) return null;
  if (amount.sign < 0 || step.sign < 0 || isZeroDecimal(step)) return null;

  const scale = Math.max(amount.scale, step.scale);
  const { remainder } = divideDigits(widenDigits(amount, scale), widenDigits(step, scale));
  return remainder === '0';
}

/** Exact product of two decimal strings, or `null` if either is malformed. */
export function multiplyDecimal(a: string, b: string): string | null {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  if (!left || !right) return null;
  const sign: 1 | -1 = left.sign === right.sign ? 1 : -1;
  return formatDigits(sign, multiplyDigits(left.digits, right.digits), left.scale + right.scale);
}

/** Exact sum of two decimal strings, or `null` if either is malformed. */
export function addDecimal(a: string, b: string): string | null {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  if (!left || !right) return null;
  if (isZeroDecimal(left)) return formatDigits(right.sign, right.digits, right.scale);
  if (isZeroDecimal(right)) return formatDigits(left.sign, left.digits, left.scale);

  const scale = Math.max(left.scale, right.scale);
  const leftDigits = widenDigits(left, scale);
  const rightDigits = widenDigits(right, scale);

  if (left.sign === right.sign) {
    return formatDigits(left.sign, addDigits(leftDigits, rightDigits), scale);
  }

  const magnitude = compareDigits(leftDigits, rightDigits);
  if (magnitude === 0) return '0';
  if (magnitude > 0) return formatDigits(left.sign, subtractDigits(leftDigits, rightDigits), scale);
  return formatDigits(right.sign, subtractDigits(rightDigits, leftDigits), scale);
}

/** Exact difference of two decimal strings, or `null` if either is malformed. */
export function subtractDecimal(a: string, b: string): string | null {
  const right = parseDecimal(b);
  if (!right) return null;
  const negated = isZeroDecimal(right)
    ? '0'
    : formatDigits(right.sign === 1 ? -1 : 1, right.digits, right.scale);
  return addDecimal(a, negated);
}

/**
 * Exact quotient of two decimal strings, rounded (or floored) to `scale` decimal places.
 *
 * Returns `null` for malformed input or a zero divisor. Used for derived amounts such as
 * `total / price`, where the result must be quantized to the base increment's scale before it
 * is snapped, not left to a float.
 */
export function divideDecimal(
  a: string,
  b: string,
  scale: number,
  mode: 'nearest' | 'floor' = 'nearest'
): string | null {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  if (!left || !right || isZeroDecimal(right) || scale < 0) return null;

  // a / b = (A / B) * 10^(b.scale - a.scale); scaling the numerator by 10^scale gives the
  // scaled quotient the caller asked for.
  const shift = scale + right.scale - left.scale;
  let numerator = left.digits;
  let denominator = right.digits;
  if (shift >= 0) numerator += '0'.repeat(shift);
  else denominator += '0'.repeat(-shift);

  const { quotient, remainder } = divideDigits(numerator, denominator);
  let rounded = quotient;
  if (mode === 'nearest' && remainder !== '0') {
    if (compareDigits(multiplyDigits(remainder, '2'), denominator) >= 0) {
      rounded = addDigits(quotient, '1');
    }
  }
  const sign: 1 | -1 = left.sign === right.sign ? 1 : -1;
  return formatDigits(sign, rounded, scale);
}
