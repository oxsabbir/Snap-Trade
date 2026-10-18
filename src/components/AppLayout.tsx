import { forwardRef, type ElementRef } from 'react';
import {
  Image as NativeImage,
  Pressable as NativePressable,
  ScrollView as NativeScrollView,
  StyleSheet,
  View as NativeView,
  type ImageProps,
  type ImageStyle,
  type PressableProps,
  type PressableStateCallbackType,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useFontScale } from '@/theme/FontScaleProvider';

const SCALED_LAYOUT_KEYS: (keyof ViewStyle)[] = [
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'paddingHorizontal', 'paddingVertical', 'margin', 'marginTop', 'marginBottom',
  'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
  'gap', 'rowGap', 'columnGap', 'borderRadius', 'borderTopLeftRadius',
  'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'borderWidth', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth',
];

function scaleLayoutStyle(style: StyleProp<ViewStyle>, scale: number): StyleProp<ViewStyle> {
  const flattened = StyleSheet.flatten(style);
  if (!flattened || scale === 1) return style;

  const scaled = { ...flattened };
  for (const key of SCALED_LAYOUT_KEYS) {
    const value = scaled[key];
    // Percentages and 'auto' are layout instructions, not fixed dimensions.
    if (typeof value === 'number') {
      (scaled as Record<string, unknown>)[key] = value * scale;
    }
  }
  return scaled;
}

export const View = forwardRef<ElementRef<typeof NativeView>, React.ComponentProps<typeof NativeView>>(
  function AppView({ style, ...props }, ref) {
    const { scale } = useFontScale();
    return <NativeView ref={ref} {...props} style={scaleLayoutStyle(style, scale)} />;
  },
);

export const Pressable = forwardRef<ElementRef<typeof NativePressable>, PressableProps>(
  function AppPressable({ style, ...props }, ref) {
    const { scale } = useFontScale();
    const scaledStyle = typeof style === 'function'
      ? (state: PressableStateCallbackType) => scaleLayoutStyle(
          (style as (state: PressableStateCallbackType) => StyleProp<ViewStyle>)(state),
          scale,
        )
      : scaleLayoutStyle(style, scale);
    return <NativePressable ref={ref} {...props} style={scaledStyle} />;
  },
);

export const ScrollView = forwardRef<ElementRef<typeof NativeScrollView>, ScrollViewProps>(
  function AppScrollView({ style, contentContainerStyle, ...props }, ref) {
    const { scale } = useFontScale();
    return (
      <NativeScrollView
        ref={ref}
        {...props}
        style={scaleLayoutStyle(style, scale)}
        contentContainerStyle={scaleLayoutStyle(contentContainerStyle, scale)}
      />
    );
  },
);

export const Image = forwardRef<ElementRef<typeof NativeImage>, ImageProps>(
  function AppImage({ style, ...props }, ref) {
    const { scale } = useFontScale();
    return (
      <NativeImage
        ref={ref}
        {...props}
        style={scaleLayoutStyle(style as StyleProp<ViewStyle>, scale) as StyleProp<ImageStyle>}
      />
    );
  },
);
