import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { KuCoinCredentials } from './types';

const KEY = 'kucoin.credentials.v1';

/**
 * expo-secure-store has no web implementation, and the web build is only used for
 * bundle verification. Fail loudly on write, degrade to "not connected" on read.
 */
const isSupported = Platform.OS !== 'web';

let cache: KuCoinCredentials | null | undefined;

function parse(raw: string | null): KuCoinCredentials | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<KuCoinCredentials>;
    if (!candidate.apiKey || !candidate.apiSecret || !candidate.apiPassphrase) return null;
    return {
      apiKey: candidate.apiKey,
      apiSecret: candidate.apiSecret,
      apiPassphrase: candidate.apiPassphrase,
    };
  } catch {
    return null;
  }
}

export async function loadCredentials(): Promise<KuCoinCredentials | null> {
  if (cache !== undefined) return cache;
  cache = isSupported
    ? parse(await SecureStore.getItemAsync(KEY).catch(() => null))
    : null;
  return cache;
}

export async function saveCredentials(credentials: KuCoinCredentials): Promise<void> {
  if (!isSupported) {
    throw new Error('Secure storage is unavailable on web. Connect from the mobile app.');
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(credentials));
  cache = credentials;
}

export async function clearCredentials(): Promise<void> {
  if (isSupported) {
    await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
  }
  cache = null;
}
