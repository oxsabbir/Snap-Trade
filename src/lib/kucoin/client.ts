import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { loadCredentials } from './credentials';

const BASE_URL = 'https://api.kucoin.com';
const API_VERSION = '3';
const REQUEST_TIMEOUT_MS = 15_000;

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hmacBase64(secret: string, message: string): string {
  return toBase64(hmac(sha256, utf8(secret), utf8(message)));
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  /** Attach KC-API-* headers. Requires credentials. */
  signed?: boolean;
  /**
   * Overrides the default timeout. The reference payloads are the largest responses the app asks
   * for and need noticeably longer than a ticker or an order book.
   */
  timeoutMs?: number;
};

function buildQuery(query: RequestOptions['query']): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export class KuCoinApiError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  constructor(code: string, msg: string, status?: number) {
    super(msg);
    this.name = 'KuCoinApiError';
    this.code = code;
    this.status = status;
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, signed = false } = options;
  const requestPath = path.startsWith('/api') ? path : `/api/v1${path}`;
  const queryString = buildQuery(query);
  const bodyString = body ? JSON.stringify(body) : '';
  const url = `${BASE_URL}${requestPath}${queryString}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (signed) {
    const credentials = await loadCredentials();
    if (!credentials) {
      throw new KuCoinApiError('NO_CREDENTIALS', 'Connect a KuCoin API key to use this endpoint.');
    }
    const { apiKey, apiSecret, apiPassphrase } = credentials;
    const timestamp = Date.now().toString();

    // Sign the *unencoded* path, per KuCoin's spec.
    headers['KC-API-KEY'] = apiKey;
    headers['KC-API-TIMESTAMP'] = timestamp;
    headers['KC-API-SIGN'] = hmacBase64(
      apiSecret,
      `${timestamp}${method}${requestPath}${queryString}${bodyString}`
    );
    headers['KC-API-PASSPHRASE'] = hmacBase64(apiSecret, apiPassphrase);
    headers['KC-API-KEY-VERSION'] = API_VERSION;
  }

  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: bodyString || undefined,
      signal: controller.signal,
    });
  } catch (error) {
    // An aborted fetch surfaces as "Fetch request has been canceled", which says nothing useful
    // about what happened, so report the timeout in those terms instead.
    if (timedOut) {
      throw new KuCoinApiError(
        'TIMEOUT',
        `KuCoin did not respond within ${Math.round(timeoutMs / 1000)}s.`
      );
    }
    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new KuCoinApiError('NETWORK_ERROR', message);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload: { code?: string; msg?: string; data?: T };
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new KuCoinApiError('BAD_RESPONSE', `Unexpected response: ${text.slice(0, 120)}`, response.status);
  }

  if (!response.ok || (payload.code && payload.code !== '200000')) {
    throw new KuCoinApiError(
      payload.code ?? String(response.status),
      payload.msg ?? `Request failed with status ${response.status}`,
      response.status
    );
  }

  return payload.data as T;
}
