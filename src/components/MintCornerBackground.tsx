import { memo, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * Fixed vector corner decoration behind screens.
 * Uses smooth overlapping Bézier ribbons with low-opacity mint gradients and
 * `xMidYMid slice` (BoxFit.cover equivalent) so the center stays uncluttered white.
 */
function MintCornerBackgroundComponent() {
  const { scheme } = useTheme();
  const isDark = scheme === 'dark';
  const scale = isDark ? 0.55 : 1;
  const uid = useId().replace(/:/g, '');
  const idTopOuter = `mintTopOuter_${uid}`;
  const idTopRibbon = `mintTopRibbon_${uid}`;
  const idTopInner = `mintTopInner_${uid}`;
  const idBottomLeftOuter = `mintBottomLeftOuter_${uid}`;
  const idBottomLeftInner = `mintBottomLeftInner_${uid}`;
  const idBottomRight = `mintBottomRight_${uid}`;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 390 844"
        preserveAspectRatio="xMidYMid slice"
      >
        <Defs>
          <RadialGradient id={idTopOuter} cx="84%" cy="8%" r="48%">
            <Stop offset="0%" stopColor="#6EE7C8" stopOpacity={0.22 * scale} />
            <Stop offset="55%" stopColor="#A7F3D0" stopOpacity={0.14 * scale} />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>

          <LinearGradient id={idTopRibbon} x1="0.2" y1="0" x2="1" y2="0.9">
            <Stop offset="0%" stopColor="#9CF0D7" stopOpacity={0.22 * scale} />
            <Stop offset="65%" stopColor="#D1FAE5" stopOpacity={0.16 * scale} />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>

          <LinearGradient id={idTopInner} x1="0.1" y1="0" x2="0.9" y2="1">
            <Stop offset="0%" stopColor="#5EEAD4" stopOpacity={0.18 * scale} />
            <Stop offset="70%" stopColor="#A7F3D0" stopOpacity={0.1 * scale} />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>

          <LinearGradient id={idBottomLeftOuter} x1="0" y1="1" x2="0.9" y2="0.1">
            <Stop offset="0%" stopColor="#5EEAD4" stopOpacity={0.22 * scale} />
            <Stop offset="55%" stopColor="#A7F3D0" stopOpacity={0.14 * scale} />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>

          <LinearGradient id={idBottomLeftInner} x1="0" y1="1" x2="1" y2="0.2">
            <Stop offset="0%" stopColor="#34D399" stopOpacity={0.18 * scale} />
            <Stop offset="65%" stopColor="#A7F3D0" stopOpacity={0.08 * scale} />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>

          <RadialGradient id={idBottomRight} cx="92%" cy="95%" r="36%">
            <Stop offset="0%" stopColor="#6EE7B7" stopOpacity={0.18 * scale} />
            <Stop offset="60%" stopColor="#D1FAE5" stopOpacity={0.09 * scale} />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {/* Top-right broad radial halo */}
        <Path
          d="M 155 0 L 390 0 L 390 250 C 315 245, 225 190, 190 115 C 165 62, 160 25, 155 0 Z"
          fill={`url(#${idTopOuter})`}
        />

        {/* Top-right sweeping curved ribbon */}
        <Path
          d="M 195 0 L 390 0 L 390 198 C 332 194, 266 154, 232 95 C 210 56, 200 24, 195 0 Z"
          fill={`url(#${idTopRibbon})`}
        />

        {/* Top-right inner overlapping crescent */}
        <Path
          d="M 248 0 L 390 0 L 390 142 C 344 138, 294 106, 268 58 C 256 36, 250 16, 248 0 Z"
          fill={`url(#${idTopInner})`}
        />

        {/* Bottom-left outer layered mint wave */}
        <Path
          d="M 0 650 C 58 660, 118 692, 166 742 C 204 782, 232 816, 252 844 L 0 844 Z"
          fill={`url(#${idBottomLeftOuter})`}
        />

        {/* Bottom-left inner overlapping wave */}
        <Path
          d="M 0 710 C 48 718, 96 746, 134 786 C 160 812, 178 830, 190 844 L 0 844 Z"
          fill={`url(#${idBottomLeftInner})`}
        />

        {/* Bottom-right subtle curve */}
        <Path
          d="M 220 844 C 248 806, 294 764, 348 746 C 364 740, 378 738, 390 738 L 390 844 Z"
          fill={`url(#${idBottomRight})`}
        />
      </Svg>
    </View>
  );
}

export const MintCornerBackground = memo(MintCornerBackgroundComponent);
