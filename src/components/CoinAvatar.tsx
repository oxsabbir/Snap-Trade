import { memo, useCallback, useState } from 'react';
import { View } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';
import { Image } from 'expo-image';

import { useCurrencyIconUrl } from '@/state/currencyIcons';
import { radius } from '@/theme';
import { createThemedStyles } from '@/theme/themedStyles';
import { hashToHue } from '@/utils/format';

type Props = {
  symbol: string;
  size?: number;
};

/** Global negative cache so any 404/broken icon URL is never retried while scrolling. */
const failedUrls = new Set<string>();
/** Tracks URLs already decoded into expo-image's memory/disk cache to skip fade-in flash on remount. */
const loadedUrls = new Set<string>();

function CoinAvatarComponent({ symbol, size = 36 }: Props) {
  const styles = useStyles();
  const label = symbol.slice(0, symbol.length > 4 ? 3 : 2);
  const hue = hashToHue(symbol);
  const kucoinIconUrl = useCurrencyIconUrl(symbol);

  const [, setAttempt] = useState(0);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  const activeUrl = kucoinIconUrl && !failedUrls.has(kucoinIconUrl) ? kucoinIconUrl : null;
  const cachedReady = activeUrl !== null && loadedUrls.has(activeUrl);
  const isLoaded = cachedReady || (activeUrl !== null && loadedUrl === activeUrl);

  const handleLoad = useCallback(() => {
    if (activeUrl) {
      loadedUrls.add(activeUrl);
      setLoadedUrl(activeUrl);
    }
  }, [activeUrl]);

  const handleError = useCallback(() => {
    if (activeUrl) failedUrls.add(activeUrl);
    setAttempt((n) => n + 1);
  }, [activeUrl]);

  return (
    <View
      style={[
        styles.avatar,
        isLoaded && styles.avatarLoaded,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: isLoaded ? 'transparent' : `hsl(${hue}, 45%, 26%)`,
        },
      ]}
    >
      {!isLoaded ? (
        <Text style={[styles.label, { fontSize: size * 0.34 }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      {activeUrl ? (
        <Image
          source={activeUrl}
          recyclingKey={activeUrl}
          cachePolicy="memory-disk"
          contentFit="cover"
          transition={0}
          priority="low"
          onLoad={handleLoad}
          onError={handleError}
          style={[styles.image, { borderRadius: size / 2 }]}
        />
      ) : null}
    </View>
  );
}

export const CoinAvatar = memo(CoinAvatarComponent);

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    avatar: {
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.pill,
    },
    avatarLoaded: {
      borderWidth: 0,
    },
    image: StyleSheet.absoluteFill,
    label: {
      color: colors.onAccent,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
  }),
);
