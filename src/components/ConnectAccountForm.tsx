import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { KuCoinCredentials } from '@/lib/kucoin/types';
import { colors, radius, spacing } from '@/theme';

type Props = {
  onSubmit: (credentials: KuCoinCredentials) => Promise<void>;
};

type Field = {
  key: keyof KuCoinCredentials;
  label: string;
  placeholder: string;
  secure: boolean;
};

const FIELDS: Field[] = [
  { key: 'apiKey', label: 'API Key', placeholder: 'Paste your API key', secure: false },
  { key: 'apiSecret', label: 'API Secret', placeholder: 'Paste your API secret', secure: true },
  { key: 'apiPassphrase', label: 'Passphrase', placeholder: 'The passphrase you set', secure: true },
];

export function ConnectAccountForm({ onSubmit }: Props) {
  const [values, setValues] = useState<KuCoinCredentials>({
    apiKey: '',
    apiSecret: '',
    apiPassphrase: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const canSubmit =
    values.apiKey.trim().length > 0 &&
    values.apiSecret.trim().length > 0 &&
    values.apiPassphrase.trim().length > 0 &&
    !isSubmitting;

  const submit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setLocalError(null);
    try {
      await onSubmit({
        apiKey: values.apiKey.trim(),
        apiSecret: values.apiSecret.trim(),
        apiPassphrase: values.apiPassphrase.trim(),
      });
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Could not save credentials');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Connect KuCoin</Text>
      <Text style={styles.body}>
        Create an API key at kucoin.com with only the <Text style={styles.emphasis}>General</Text>{' '}
        permission. Leave Trading and Withdrawal off — this app only reads balances.
      </Text>

      {FIELDS.map((field) => (
        <View key={field.key} style={styles.field}>
          <Text style={styles.label}>{field.label}</Text>
          <TextInput
            value={values[field.key]}
            onChangeText={(text) => setValues((current) => ({ ...current, [field.key]: text }))}
            placeholder={field.placeholder}
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            secureTextEntry={field.secure}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />
        </View>
      ))}

      {localError ? <Text style={styles.error}>{localError}</Text> : null}

      <Pressable
        onPress={submit}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityLabel="Save API credentials"
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#06231C" />
        ) : (
          <Text style={styles.buttonText}>Connect</Text>
        )}
      </Pressable>

      <Text style={styles.note}>
        Stored in this device&apos;s secure keystore, never sent anywhere except KuCoin.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  body: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  emphasis: {
    color: colors.text,
    fontWeight: '600',
  },
  field: {
    gap: 6,
    marginTop: spacing.sm,
  },
  label: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    height: 42,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 14,
  },
  error: {
    color: colors.down,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  button: {
    marginTop: spacing.md,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#06231C',
    fontSize: 14,
    fontWeight: '700',
  },
  note: {
    color: colors.textFaint,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
