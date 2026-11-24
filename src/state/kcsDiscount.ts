import * as SecureStore from 'expo-secure-store';

const KEY = 'kcs.discount.enabled';
let cached: boolean | null = null;

export function getCachedKcsDiscountEnabled(): boolean | null {
  return cached;
}

export async function getKcsDiscountEnabled(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    const v = await SecureStore.getItemAsync(KEY);
    cached = v === 'true';
    return cached;
  } catch {
    return false;
  }
}

export async function setKcsDiscountEnabled(enabled: boolean): Promise<void> {
  cached = enabled;
  await SecureStore.setItemAsync(KEY, String(enabled));
}