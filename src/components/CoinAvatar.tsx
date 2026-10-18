import {
  memo } from 'react';
import { View } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';

import { radius } from '@/theme';
import { createThemedStyles } from '@/theme/themedStyles';
import { hashToHue } from '@/utils/format';

type Props = {
  symbol: string;
  size?: number;
};

function CoinAvatarComponent({ symbol, size = 36 }: Props) {
  const styles = useStyles();
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

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    avatar: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.pill,
    },
    label: {
      color: colors.onAccent,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
  }),
);
