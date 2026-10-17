import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AssetList } from '@/components/AssetList';
import { AccountIcon } from '@/components/Icons';
import { ProfileCard } from '@/components/ProfileCard';
import { useAccount } from '@/hooks/useAccount';
import { useProfile } from '@/hooks/useProfile';
import { useSignalSource } from '@/hooks/useSignalSource';
import { SIGNAL_DETECTION_ENABLED } from '@/lib/featureFlags';
import { useApiCredentials, type OnboardingEntry } from '@/state/apiCredentials';
import { getKcsDiscountEnabled, setKcsDiscountEnabled } from '@/state/kcsDiscount';
import { radius, spacing } from '@/theme';
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider';
import { createThemedStyles } from '@/theme/themedStyles';
import { useState, useEffect } from 'react';

function maskApiKey(apiKey: string | null): string {
  if (!apiKey || apiKey.length < 9) return '••••••';
  return `${apiKey.slice(0, 4)}••••••${apiKey.slice(-4)}`;
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function AccountScreen() {
  const { status, portfolio, accountInfo, lastUpdated, error, refresh } = useAccount();
  const profile = useProfile();
  // Always mounted so its hydration/mirroring logic stays Rules-of-Hooks-safe; with signal
  // detection stripped the native module is absent, so the mirror is a no-op.
  const signal = useSignalSource();
  const { apiKey, disconnect } = useApiCredentials();
  const { colors, preference, setPreference } = useTheme();
  const styles = useStyles();
  const [accountAction, setAccountAction] = useState<OnboardingEntry | null>(null);
  const [accountActionError, setAccountActionError] = useState<string | null>(null);
  const [kcsEnabled, setKcsEnabled] = useState(false);
  const [signalNameInput, setSignalNameInput] = useState(signal.displayName);
  // Re-sync the input when the hook finishes hydrating the stored name (or the user saves a
  // new one). Adjusted during render rather than in an effect: the derived-from-previous-state
  // guard is the pattern React recommends for keeping a controlled input in step with state
  // that changes underneath it.
  const [prevSignalName, setPrevSignalName] = useState(signal.displayName);
  if (signal.displayName !== prevSignalName) {
    setPrevSignalName(signal.displayName);
    setSignalNameInput(signal.displayName);
  }

  // With signal detection on, the display name is the signal source's (it mirrors into the
  // native listener's SharedPreferences); with it off, the local profile label is used.
  const displayName = SIGNAL_DETECTION_ENABLED ? signal.displayName : profile.displayName;
  const setDisplayName = SIGNAL_DETECTION_ENABLED ? signal.setDisplayName : profile.setDisplayName;

  useEffect(() => {
    getKcsDiscountEnabled().then(setKcsEnabled);
  }, []);

  const leaveAccount = async (entry: OnboardingEntry) => {
    setAccountActionError(null);
    setAccountAction(entry);
    try {
      await disconnect(entry);
    } catch {
      setAccountActionError('Could not clear the saved key securely. Try again.');
      setAccountAction(null);
    }
  };

  const isBusy = status === 'loading' && portfolio.assets.length > 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Account</Text>
        {isBusy ? <ActivityIndicator color={colors.accent} /> : null}
      </View>

      {status === 'loading' && portfolio.assets.length === 0 ? (
        <ActivityIndicator style={styles.centered} color={colors.accent} />
      ) : status === 'disconnected' ? (
        <ActivityIndicator style={styles.centered} color={colors.accent} />
      ) : status === 'error' && portfolio.assets.length === 0 ? (
        <View style={styles.card}>
          <View style={styles.cardIcon}>
            <AccountIcon size={26} color={colors.down} />
          </View>
          <Text style={styles.cardTitle}>Could not load balances</Text>
          <Text style={styles.cardBody}>{error}</Text>
          <View style={styles.actions}>
            <Pressable
              onPress={refresh}
              style={styles.primaryButton}
              accessibilityRole="button"
              accessibilityLabel="Retry loading balances"
            >
              <Text style={styles.primaryText}>Retry</Text>
            </Pressable>
            <Pressable
              onPress={() => void leaveAccount('setup')}
              disabled={accountAction !== null}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel="Switch account"
            >
              <Text style={styles.secondaryText}>Switch</Text>
            </Pressable>
            <Pressable
              onPress={() => void leaveAccount('welcome')}
              disabled={accountAction !== null}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel="Log out"
            >
              <Text style={styles.secondaryText}>Log out</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardAvoidingView}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
        >
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          <ProfileCard
            displayName={displayName}
            onRename={setDisplayName}
            accountInfo={accountInfo}
            portfolio={portfolio}
            lastUpdated={lastUpdated}
          />

          <View style={styles.connection}>
            <Text style={styles.connectionLabel}>CONNECTED API KEY</Text>
            <Text style={styles.apiKey} selectable={false}>
              {maskApiKey(apiKey)}
            </Text>
            <Pressable
              onPress={() => void leaveAccount('setup')}
              disabled={accountAction !== null}
              style={[styles.switchButton, accountAction !== null && styles.actionDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Switch account"
            >
              <Text style={styles.switchButtonText}>
                {accountAction === 'setup' ? 'Switching…' : 'Switch account'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void leaveAccount('welcome')}
              disabled={accountAction !== null}
              style={[styles.logoutButton, accountAction !== null && styles.actionDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Log out"
            >
              <Text style={styles.logoutText}>
                {accountAction === 'welcome' ? 'Logging out…' : 'Log out'}
              </Text>
            </Pressable>
{accountActionError ? (
              <Text style={styles.actionError} accessibilityRole="alert">
                {accountActionError}
              </Text>
            ) : null}
          </View>

          {SIGNAL_DETECTION_ENABLED ? (
            <View style={styles.signalSection}>
              <Text style={styles.signalTitle}>Signal Source</Text>
              <View style={styles.signalRow}>
                <View style={styles.signalInfo}>
                  <Text style={styles.signalTitle}>Detect Signals from Notifications</Text>
                  <Text style={styles.signalDesc}>
                    When on, the app reads notifications from the X app to detect trading signals from your configured source.
                  </Text>
                </View>
                <Switch
                  value={signal.isEnabled}
                  onValueChange={signal.setIsEnabled}
                  disabled={signal.isLoading}
                  trackColor={{ false: colors.surfaceAlt, true: colors.up }}
                  thumbColor={signal.isEnabled ? '#FFFFFF' : colors.text}
                />
              </View>
              <View style={styles.signalNameRow}>
                <Text style={styles.signalNameLabel}>Display Name</Text>
                <View style={styles.signalNameInputWrapper}>
                  <TextInput
                    value={signalNameInput}
                    onChangeText={setSignalNameInput}
                    editable={signal.isEnabled}
                    style={[styles.signalNameInput, styles.signalNameInputFlex, !signal.isEnabled && styles.signalNameInputDisabled]}
                    maxLength={24}
                    autoCapitalize="words"
                    autoCorrect={false}
                    autoComplete="off"
                    placeholder={signal.isLoading ? 'Loading...' : 'Enter display name'}
                    placeholderTextColor={colors.textFaint}
                    accessibilityLabel="Signal source display name"
                  />
                  <Pressable
                    onPress={() => {
                      const trimmed = signalNameInput.trim().slice(0, 24);
                      setSignalNameInput(trimmed);
                      signal.setDisplayName(trimmed);
                    }}
                    disabled={!signal.isEnabled || signalNameInput.trim() === ''}
                    style={[
                      styles.signalSaveButton,
                      (!signal.isEnabled || signalNameInput.trim() === '') && styles.signalSaveButtonDisabled,
                    ]}
                    accessibilityLabel="Save display name"
                  >
                    <Text style={styles.signalSaveButtonText}>Save</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}

          <View style={styles.kcsSection}>
            <View style={styles.kcsRow}>
              <View style={styles.kcsInfo}>
                <Text style={styles.kcsTitle}>Pay fees with KCS</Text>
                <Text style={styles.kcsDesc}>20% discount on trading fees</Text>
              </View>
              <Pressable
                onPress={async () => {
                  const next = !kcsEnabled;
                  await setKcsDiscountEnabled(next);
                  setKcsEnabled(next);
                }}
                style={[
                  styles.kcsToggle,
                  kcsEnabled && styles.kcsToggleOn,
                ]}
                accessibilityRole="switch"
                accessibilityState={{ checked: kcsEnabled }}
              >
                <View style={[
                  styles.kcsToggleThumb,
                  kcsEnabled && styles.kcsToggleThumbOn,
                ]} />
              </Pressable>
            </View>
          </View>

          <View style={styles.themeSection}>
            <Text style={styles.connectionLabel}>APPEARANCE</Text>
            <View style={styles.segment}>
              {THEME_OPTIONS.map((option) => {
                const active = preference === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setPreference(option.value)}
                    style={[styles.segmentItem, active && styles.segmentItemActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${option.label} theme`}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <AssetList holdings={portfolio.holdings} />
        </ScrollView>
      </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
    },
    title: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '700',
    },
    centered: {
      marginTop: spacing.xl,
    },
    card: {
      marginHorizontal: spacing.lg,
      padding: spacing.lg,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      alignItems: 'center',
      gap: spacing.sm,
    },
    cardIcon: {
      width: 52,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      marginBottom: spacing.xs,
    },
    cardTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    cardBody: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    primaryButton: {
      paddingHorizontal: spacing.lg,
      height: 38,
      justifyContent: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    primaryText: {
      color: colors.onAccent,
      fontSize: 13,
      fontWeight: '700',
    },
    secondaryButton: {
      paddingHorizontal: spacing.md,
      height: 38,
      justifyContent: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
    },
    secondaryText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    list: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
    },
    connection: {
      marginTop: spacing.lg,
      marginBottom: spacing.xl,
      paddingTop: spacing.md,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: spacing.sm,
    },
    connectionLabel: {
      color: colors.textFaint,
      fontSize: 10,
      fontWeight: '700',
    },
    apiKey: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    switchButton: {
      minHeight: 42,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      marginTop: spacing.xs,
    },
    switchButtonText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    logoutButton: {
      minHeight: 38,
      justifyContent: 'center',
      alignItems: 'center',
    },
    logoutText: {
      color: colors.downText,
      fontSize: 13,
      fontWeight: '600',
    },
    actionDisabled: {
      opacity: 0.45,
    },
    actionError: {
      color: colors.downText,
      fontSize: 12,
      lineHeight: 17,
    },
    signalSection: {
      marginTop: spacing.lg,
      marginBottom: spacing.xl,
      paddingTop: spacing.md,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    signalTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: spacing.sm,
    },
    signalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
    },
    signalInfo: {
      flex: 1,
    },
    signalDesc: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 2,
    },
    signalNameRow: {
      marginTop: spacing.sm,
      gap: spacing.sm,
    },
    signalNameLabel: {
      color: colors.textFaint,
      fontSize: 10,
      fontWeight: '700',
      marginBottom: 4,
    },
    signalNameInput: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    signalNameInputWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    signalNameInputFlex: {
      flex: 3,
    },
    signalSaveButton: {
      flex: 1,
      height: 36,
      borderRadius: radius.sm,
      backgroundColor: colors.up,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xs,
    },
    signalSaveButtonDisabled: {
      opacity: 0.4,
      backgroundColor: colors.surfaceAlt,
    },
    signalSaveButtonText: {
      color: colors.onAccent,
      fontSize: 12,
      fontWeight: '700',
    },
    signalNameInputDisabled: {
      opacity: 0.4,
      backgroundColor: colors.surfaceAlt,
    },
    kcsSection: {
      marginTop: spacing.lg,
      marginBottom: spacing.xl,
      paddingTop: spacing.md,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    kcsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
    },
    kcsInfo: {
      flex: 1,
    },
    kcsTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    kcsDesc: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 2,
    },
    kcsToggle: {
      width: 48,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.surfaceAlt,
      padding: 2,
      justifyContent: 'center',
    },
    kcsToggleOn: {
      backgroundColor: colors.up,
    },
    kcsToggleThumb: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.text,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.2,
      shadowRadius: 2,
      elevation: 2,
    },
    kcsToggleThumbOn: {
      marginLeft: 20,
      backgroundColor: colors.onAccent,
    },
    themeSection: {
      marginBottom: spacing.xl,
      paddingTop: spacing.md,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: spacing.sm,
    },
    segment: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      padding: 3,
      gap: 3,
    },
    segmentItem: {
      flex: 1,
      minHeight: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
    },
    segmentItemActive: {
      backgroundColor: colors.accent,
    },
    segmentText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    segmentTextActive: {
      color: colors.onAccent,
    },
    keyboardAvoidingView: {
      flex: 1,
    },
  }),
);
