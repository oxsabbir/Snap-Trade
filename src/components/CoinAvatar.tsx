import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '@/theme';
import { hashToHue } from '@/utils/format';

type Props = {
  symbol: string;
  size?: number;
};

function CoinAvatarComponent({ symbol, size = 36 }: Props) {
  const label = symbol.slice(0, symbol.length > 4 ? 3 : 2);
  const hue = hashToHue(symbol);

  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: `hsl(${hue}, 45%, 26%)`,
        },
      ]}
    >
      <Text style={[styles.label, { fontSize: size * 0.34 }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export const CoinAvatar = memo(CoinAvatarComponent);

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
  },
  label: {
    color: colors.text,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
