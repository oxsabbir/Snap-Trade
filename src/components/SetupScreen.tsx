import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { CheckIcon, EyeIcon, EyeOffIcon } from '@/components/Icons';
import { KuCoinApiError } from '@/lib/kucoin/client';
import type { KuCoinCredentials } from '@/lib/kucoin/types';
import { colors, radius, spacing } from '@/theme';

type Props = {
  onConnect: (credentials: KuCoinCredentials) => Promise<void>;
  onConnected: () => void;
};

type CredentialField = {
  key: keyof KuCoinCredentials;
  label: string;
  placeholder: string;
  secure: boolean;
};

const FIELDS: CredentialField[] = [
  { key: 'apiKey', label: 'API Key', placeholder: 'Paste API key', secure: false },
  { key: 'apiSecret', label: 'API Secret', placeholder: 'Paste API secret', secure: true },
  { key: 'apiPassphrase', label: 'Passphrase', placeholder: 'Enter API passphrase', secure: true },
];

const EMPTY_CREDENTIALS: KuCoinCredentials = {
  apiKey: '',
  apiSecret: '',
  apiPassphrase: '',
};

function connectionError(error: unknown): string {
  if (error instanceof KuCoinApiError) {
    if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') {
      return 'Could not reach KuCoin. Check your connection and try again.';
    }
    if (error.code === '400006') {
      return 'This key uses an IP restriction. Check KuCoin API Management and try again.';
    }
    if (['400003', '400004', '401000'].includes(error.code)) {
      return 'KuCoin could not verify these credentials. Check the key, secret, passphrase, and permissions.';
    }
  }
  return 'Could not verify or securely save this key. Check its permissions and try again.';
}

export function SetupScreen({ onConnect, onConnected }: Props) {
  const [values, setValues] = useState<KuCoinCredentials>(EMPTY_CREDENTIALS);
  const [showSecret, setShowSecret] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    },
    [],
  );

  const canSubmit =
    values.apiKey.trim().length > 0 &&
    values.apiSecret.trim().length > 0 &&
    values.apiPassphrase.trim().length > 0 &&
    !isSubmitting &&
    !isConnected;

  const submit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onConnect({
        apiKey: values.apiKey.trim(),
        apiSecret: values.apiSecret.trim(),
        apiPassphrase: values.apiPassphrase.trim(),
      });
      setValues(EMPTY_CREDENTIALS);
      setIsConnected(true);
      successTimer.current = setTimeout(onConnected, 850);
    } catch (caught) {
      setError(connectionError(caught));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(360)} style={styles.content}>
            <View style={styles.brandRow}>
              <Image
                source={require('../../assets/branding/app-icon.png')}
                style={styles.logo}
                resizeMode="cover"
                accessibilityLabel="SnapTrade logo"
              />
              <View style={styles.heading}>
                <Text style={styles.eyebrow}>SNAPTRADE</Text>
                <Text style={styles.title}>Connect KuCoin</Text>
              </View>
            </View>

            {isConnected ? (
              <Animated.View entering={FadeInDown.duration(300)} style={styles.success}>
                <View style={styles.successIcon}>
                  <CheckIcon size={26} color={colors.accent} />
                </View>
                <Text style={styles.successTitle}>Connected</Text>
                <Text style={styles.successBody}>Your account is ready.</Text>
              </Animated.View>
            ) : (
              <>
                <View style={styles.fields}>
                  {FIELDS.map((field, index) => {
                    const isSecret = field.key === 'apiSecret';
                    const isPassphrase = field.key === 'apiPassphrase';
                    const isVisible = isSecret ? showSecret : isPassphrase ? showPassphrase : false;
                    const toggleVisibility = isSecret
                      ? () => setShowSecret((current) => !current)
                      : () => setShowPassphrase((current) => !current);

                    return (
                      <Animated.View
                        key={field.key}
                        entering={FadeInDown.delay(index * 70).duration(360)}
                        style={styles.field}
                      >
                        <Text style={styles.label}>{field.label}</Text>
                        <View style={styles.inputRow}>
                          <TextInput
                            value={values[field.key]}
                            onChangeText={(text) =>
                              setValues((current) => ({ ...current, [field.key]: text }))
                            }
                            placeholder={field.placeholder}
                            placeholderTextColor={colors.textFaint}
                            style={styles.input}
                            secureTextEntry={field.secure && !isVisible}
                            autoCapitalize="none"
                            autoCorrect={false}
                            spellCheck={false}
                            textContentType="none"
                            editable={!isSubmitting}
                            accessibilityLabel={field.label}
                          />
                          {field.secure ? (
                            <Pressable
                              onPress={toggleVisibility}
                              hitSlop={8}
                              style={styles.visibilityButton}
                              accessibilityRole="button"
                              accessibilityLabel={`${isVisible ? 'Hide' : 'Show'} ${field.label}`}
                              accessibilityState={{ selected: isVisible }}
                            >
                              {isVisible ? <EyeOffIcon /> : <EyeIcon />}
                            </Pressable>
                          ) : null}
                        </View>
                      </Animated.View>
                    );
                  })}
                </View>

                <Text style={styles.helper}>
                  Create a key in KuCoin API Management with General (read) and Spot Trading access.
                  Keep Transfer and Withdrawal disabled.
                </Text>

                {error ? (
                  <Text style={styles.error} accessibilityRole="alert">
                    {error}
                  </Text>
                ) : null}

                <Animated.View entering={FadeInDown.delay(210).duration(360)}>
                  <Pressable
                    onPress={() => void submit()}
                    disabled={!canSubmit}
                    style={[styles.button, !canSubmit && styles.buttonDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel={isSubmitting ? 'Connecting to KuCoin' : 'Connect'}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color="#06231C" />
                    ) : (
                      <Text style={styles.buttonText}>Connect</Text>
                    )}
                  </Pressable>
                </Animated.View>
              </>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  content: {
    gap: spacing.xl,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  logo: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
  },
  heading: {
    gap: 3,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
  },
  title: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '700',
  },
  fields: {
    gap: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  inputRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    color: colors.text,
    fontSize: 14,
  },
  visibilityButton: {
    width: 36,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helper: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    color: colors.down,
    fontSize: 12,
    lineHeight: 17,
  },
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  buttonDisabled: {
    opacity: 0.42,
  },
  buttonText: {
    color: '#06231C',
    fontSize: 14,
    fontWeight: '700',
  },
  success: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  successIcon: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(35,175,137,0.14)',
  },
  successTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  successBody: {
    color: colors.textMuted,
    fontSize: 13,
  },
});