import { memo } from 'react';
import { View } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { createThemedStyles } from '@/theme/themedStyles';
import { hashToHue } from '@/utils/format';

type Props = {
  /** Seeds the gradient colour so the same name always gets the same avatar. */
  name?: string;
  size?: number;
};

/**
 * Generic placeholder avatar: a soft gradient disc with a person glyph, the same idea as the
 * default contact/voice avatars. Drawn with SVG rather than a bitmap so it stays crisp at any
 * size and needs no asset.
 */
function AvatarComponent({ name = '', size = 46 }: Props) {
  const styles = useStyles();
  const hue = hashToHue(name || 'kucoin');
  const fillId = `avatar-fill-${hue}`;
  const glowId = `avatar-glow-${hue}`;

  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2 }]}>
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Defs>
          <LinearGradient id={fillId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={`hsl(${hue}, 78%, 64%)`} />
            <Stop offset="0.55" stopColor={`hsl(${(hue + 24) % 360}, 74%, 52%)`} />
            <Stop offset="1" stopColor={`hsl(${(hue + 44) % 360}, 70%, 42%)`} />
          </LinearGradient>
          <RadialGradient id={glowId} cx="0.32" cy="0.26" r="0.6">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.35} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="24" cy="24" r="24" fill={`url(#${fillId})`} />
        <Circle cx="24" cy="24" r="24" fill={`url(#${glowId})`} />
        <Circle cx="24" cy="18.5" r="7.6" fill="#FFFFFF" fillOpacity={0.95} />
        <Path
          d="M7 48 C8.5 38 15 33 24 33 C33 33 39.5 38 41 48 Z"
          fill="#FFFFFF"
          fillOpacity={0.95}
        />
      </Svg>
    </View>
  );
}

export const Avatar = memo(AvatarComponent);

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    wrap: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
  }),
);
