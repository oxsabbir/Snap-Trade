import { View } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';

import { useAccountBalance } from '@/hooks/useAccountBalance';
import { useCostBasis } from '@/hooks/useCostBasis';
import { derivePositionPnl } from '@/lib/quote';
import { useTicker } from '@/state/ticker';
import { createThemedStyles } from '@/theme/themedStyles';
import { useTheme } from '@/theme/ThemeProvider';
import { formatSignedUsd } from '@/utils/format';

type Props = {
  symbol: string;
  /** The last candle's close, used until the socket's first tick lands. */
  fallbackPrice?: number;
};

/**
 * Unrealised profit or loss on the position in the pair being viewed, as a chip beside the price.
 *
 * Distinct from the market-change pill in `LivePrice`: that one is the coin's move, this one is
 * the user's own money. The entry price comes from the persisted cost-basis ledger, but the size is
 * the *live balance* rather than the ledger's net quantity — so the chip appears the moment the
 * socket reports the buy and disappears the instant the balance reaches zero on a full exit, and
 * the figure always reflects what is actually held rather than what a fill history claims.
 */
export function PositionPnlChip({ symbol, fallbackPrice }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { update } = useTicker(symbol);
  const { available, holds } = useAccountBalance();
  const basis = useCostBasis(symbol);

  const [base] = symbol.split('-');
  const held = (Number(available[base ?? '']) || 0) + (Number(holds[base ?? '']) || 0);
  const pnl = held > 0 ? derivePositionPnl(update?.price ?? fallbackPrice, basis.avgCost, String(held)) : null;
  if (!pnl) return null;

  return (
    <View style={[styles.chip, { backgroundColor: pnl.isUp ? colors.upFill : colors.downFill }]}>
      <Text style={[styles.text, { color: pnl.isUp ? colors.upText : colors.downText }]}>
        {pnl.isUp ? '▲' : '▼'} {formatSignedUsd(pnl.amount)}
      </Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    chip: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    text: {
      fontSize: 12,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
  }),
);
