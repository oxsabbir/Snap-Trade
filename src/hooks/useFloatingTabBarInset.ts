import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const FLOATING_TAB_BAR_HEIGHT = 66;
export const FLOATING_TAB_BAR_BOTTOM_MARGIN = 10;

/**
 * Bottom scroll clearance for screens inside `(tabs)` so the last item/button
 * scrolls cleanly above the floating pill tab bar.
 */
export function useFloatingTabBarInset(extra = 20): number {
  const insets = useSafeAreaInsets();
  return FLOATING_TAB_BAR_HEIGHT + FLOATING_TAB_BAR_BOTTOM_MARGIN + insets.bottom + extra;
}
