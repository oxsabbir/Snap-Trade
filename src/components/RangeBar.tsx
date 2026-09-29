import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

type Props = {
  low: number;
  high: number;
  last: number;
  width?: number;
};

/** Shows where the last price sits inside the 24h low/high range. */
export function RangeBar({ low, high, last, width = 44 }: Props) {
  const span = high - low;
  const ratio = span > 0 ? (last - low) / span : 0.5;
  const position = Math.min(Math.max(Number.isFinite(ratio) ? ratio : 0.5, 0), 1);
  const isUp = last >= low;
  const tint = isUp ? colors.up : colors.down;

  return (
    <View style={[styles.container, { width }]}>
      <View style={styles.track} />
      <View style={[styles.fill, { width: `${position * 100}%`, backgroundColor: tint }]} />
      <View style={[styles.marker, { left: position * width - 1, backgroundColor: tint }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 10,
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  fill: {
    height: 3,
    borderRadius: 2,
  },
  marker: {
    position: 'absolute',
    width: 3,
    height: 9,
    borderRadius: 1.5,
  },
});
