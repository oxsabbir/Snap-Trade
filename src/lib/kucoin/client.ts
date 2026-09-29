import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import Constants from 'expo-constants';

import type { KuCoinCredentials } from './types';

const BASE_URL = 'https://api.kucoin.com';
const API_VERSION = '2';
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

function readCredentials(): KuCoinCredentials {
  const extra = Constants.expoConfig?.extra as { kucoin?: Partial<KuCoinCredentials> } | undefined;
  const fromExtra: Partial<KuCoinCredentials> = extra?.kucoin ?? {};
  return {
    apiKey: fromExtra.apiKey || undefined,
    apiSecret: fromExtra.apiSecret || undefined,
    apiPassphrase: fromExtra.apiPassphrase || undefined,
  };
}

export const credentials: KuCoinCredentials = readCredentials();

export function hasCredentials(): boolean {
  return Boolean(credentials.apiKey && credentials.apiSecret && credentials.apiPassphrase);
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
    if (!hasCredentials()) {
      throw new KuCoinApiError(
        'NO_CREDENTIALS',
        'Signed request requires KUCOIN_API_KEY, KUCOIN_API_SECRET and KUCOIN_API_PASSPHRASE.'
      );
    }
    const { apiKey, apiSecret, apiPassphrase } = credentials;
    const timestamp = Date.now().toString();

    // Sign the *unencoded* path, per KuCoin's spec.
    headers['KC-API-KEY'] = apiKey!;
    headers['KC-API-TIMESTAMP'] = timestamp;
    headers['KC-API-SIGN'] = hmacBase64(
      apiSecret!,
      `${timestamp}${method}${requestPath}${queryString}${bodyString}`
    );
    headers['KC-API-PASSPHRASE'] = hmacBase64(apiSecret!, apiPassphrase!);
    headers['KC-API-KEY-VERSION'] = API_VERSION;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: bodyString || undefined,
      signal: controller.signal,
    });
  } catch (error) {
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
