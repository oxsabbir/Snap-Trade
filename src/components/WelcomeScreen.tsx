import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeOutUp } from 'react-native-reanimated';

import { colors, radius, spacing } from '@/theme';

export function WelcomeScreen({ onSetup }: { onSetup: () => void }) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Animated.View exiting={FadeOutUp.duration(240)} style={styles.content}>
        <View style={styles.identity}>
          <Image
            source={require('../../assets/branding/app-icon.png')}
            style={styles.logo}
            resizeMode="cover"
            accessibilityLabel="SnapTrade logo"
          />
          <Text style={styles.wordmark}>SnapTrade</Text>
        </View>

        <View style={styles.copy}>
          <Text style={styles.title}>Trade at your pace.</Text>
          <Text style={styles.subtitle}>Welcome. Connect your KuCoin account to get started.</Text>
        </View>

        <Pressable
          onPress={onSetup}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          accessibilityRole="button"
          accessibilityLabel="Setup"
        >
          <Text style={styles.buttonText}>Setup</Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: 64,
    paddingBottom: spacing.lg,
  },
  identity: {
    alignItems: 'center',
    gap: spacing.md,
    marginTop: 40,
  },
  logo: {
    width: 116,
    height: 116,
    borderRadius: radius.lg,
  },
  wordmark: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  copy: {
    gap: spacing.sm,
    alignItems: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 300,
  },
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonText: {
    color: '#06231C',
    fontSize: 15,
    fontWeight: '700',
  },
});