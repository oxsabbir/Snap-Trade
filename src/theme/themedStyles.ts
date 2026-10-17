import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

import { darkColors, lightColors, type ThemeColors } from './index';
import { useTheme } from './ThemeProvider';

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Builds the dark and light stylesheets once each — lazily, on the first render that needs them —
 * and hands back a hook that returns the one for the current scheme. Because each scheme's sheet is
 * cached, its object identity is stable across renders, so a theme change is the only thing that
 * can invalidate it and memoized children never re-render just because a parent re-rendered.
 *
 *   const useStyles = createThemedStyles((colors) => StyleSheet.create({ root: { backgroundColor: colors.bg } }));
 *   const styles = useStyles();
 */
export function createThemedStyles<T extends NamedStyles<T>>(
  factory: (colors: ThemeColors) => T,
): () => T {
  let darkStyles: T | undefined;
  let lightStyles: T | undefined;

  return function useThemedStyles(): T {
    const { scheme } = useTheme();
    if (scheme === 'light') {
      lightStyles ??= factory(lightColors);
      return lightStyles;
    }
    darkStyles ??= factory(darkColors);
    return darkStyles;
  };
}
