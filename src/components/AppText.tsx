import {
  forwardRef,
  type ElementRef,
} from 'react';
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { useFontScale } from '@/theme/FontScaleProvider';

function scaleTextStyle(
  style: StyleProp<TextStyle>,
  scale: number,
  defaultFontSize?: number,
): StyleProp<TextStyle> {
  const flattened = StyleSheet.flatten(style);
  const fontSize = flattened?.fontSize ?? defaultFontSize;
  if (fontSize === undefined && flattened?.lineHeight === undefined) return style;

  return {
    ...flattened,
    ...(fontSize !== undefined ? { fontSize: fontSize * scale } : {}),
    ...(typeof flattened?.lineHeight === 'number'
      ? { lineHeight: flattened.lineHeight * scale }
      : {}),
  };
}

export const Text = forwardRef<ElementRef<typeof NativeText>, TextProps>(function AppText(
  { style, ...props },
  ref,
) {
  const { scale } = useFontScale();
  return <NativeText ref={ref} {...props} style={scaleTextStyle(style, scale)} />;
});

export const TextInput = forwardRef<
  ElementRef<typeof NativeTextInput>,
  TextInputProps
>(function AppTextInput({ style, ...props }, ref) {
  const { scale } = useFontScale();
  return <NativeTextInput ref={ref} {...props} style={scaleTextStyle(style, scale, 14)} />;
});
