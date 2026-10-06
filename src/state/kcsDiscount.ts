import * as SecureStore from 'expo-secure-store';

const KEY = 'kcs.discount.enabled';

export async function getKcsDiscountEnabled(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(KEY);
    return v === 'true';
  } catch {
    return false;
  }
}

export async function setKcsDiscountEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY, String(enabled));
}