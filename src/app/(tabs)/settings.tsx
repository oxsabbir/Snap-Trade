import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from '@/components/AppLayout';
import { ActivityIndicator, StyleSheet, Switch } from 'react-native';
import { Text, TextInput } from '@/components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackIcon, CheckIcon } from '@/components/Icons';
import { SIGNAL_DETECTION_ENABLED } from '@/lib/featureFlags';
import { useSignalSource } from '@/hooks/useSignalSource';
import { useBalanceVisibility } from '@/state/balanceVisibility';
import { useQuickBuy } from '@/state/quickBuy';
import { FONT_SIZE_OPTIONS, useFontScale } from '@/theme/FontScaleProvider';
import { radius, spacing } from '@/theme';
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider';
import { createThemedStyles } from '@/theme/themedStyles';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const { colors, preference, setPreference } = useTheme();
  const { step: fontSizeStep, setStep: setFontSizeStep } = useFontScale();
  const { balancesVisible, setBalancesVisible } = useBalanceVisibility();
  const { enabled: quickBuyEnabled, setEnabled: setQuickBuyEnabled } = useQuickBuy();
  const signal = useSignalSource();
  const styles = useStyles();
  const [signalNameInput, setSignalNameInput] = useState(signal.displayName);
  const [previousSignalName, setPreviousSignalName] = useState(signal.displayName);
  const [signalSaveState, setSignalSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  if (signal.displayName !== previousSignalName) {
    setPreviousSignalName(signal.displayName);
    setSignalNameInput(signal.displayName);
  }

  useEffect(
    () => () => {
      saveTimers.current.forEach(clearTimeout);
      saveTimers.current = [];
    },
    [],
  );

  const signalInputEmpty = signalNameInput.trim() === '';
  const saveSignalDisabled = !signal.isEnabled || signalInputEmpty || signal.isLoading;

  const saveSignalName = () => {
    const trimmed = signalNameInput.trim().slice(0, 80);
    if (saveSignalDisabled || signalSaveState !== 'idle') return;
    setSignalNameInput(trimmed);
    setSignalSaveState('saving');
    saveTimers.current.push(
      setTimeout(() => {
        signal.setDisplayName(trimmed);
        setSignalSaveState('saved');
        saveTimers.current.push(setTimeout(() => setSignalSaveState('idle'), 1000));
      }, 350),
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back to account"
        >
          <BackIcon size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerBalance} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {SIGNAL_DETECTION_ENABLED ? (
          <View style={styles.section}>
            <Text style={styles.sectionEyebrow}>AUTOMATION</Text>
            <Text style={styles.sectionTitle}>Signal detection</Text>
            <Text style={styles.sectionDescription}>
              Detect supported trade signals from notifications on this device.
            </Text>

            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <Text style={styles.settingTitle}>Detect signals</Text>
                <Text style={styles.settingDescription}>
                  Read X notifications from your configured sources.
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

            <View style={styles.divider} />
            <Text style={styles.fieldLabel}>SOURCE NAMES</Text>
            <View style={styles.sourceInputRow}>
              <TextInput
                value={signalNameInput}
                onChangeText={setSignalNameInput}
                editable={signal.isEnabled && !signal.isLoading}
                style={[
                  styles.sourceInput,
                  !signal.isEnabled && styles.sourceInputDisabled,
                ]}
                maxLength={80}
                autoCapitalize="words"
                autoCorrect={false}
                autoComplete="off"
                placeholder={signal.isLoading ? 'Loading settings…' : 'e.g. Alpha Calls, Gem Hunter'}
                placeholderTextColor={colors.textFaint}
                accessibilityLabel="Signal source names, comma-separated"
              />
              <Pressable
                onPress={saveSignalName}
                disabled={saveSignalDisabled || signalSaveState !== 'idle'}
                style={[
                  styles.saveButton,
                  (saveSignalDisabled || signalSaveState !== 'idle') && styles.saveButtonDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Save signal source names"
                accessibilityState={{
                  busy: signalSaveState === 'saving',
                  disabled: saveSignalDisabled,
                }}
              >
                {signalSaveState === 'saving' ? (
                  <ActivityIndicator size="small" color={colors.onAccent} />
                ) : signalSaveState === 'saved' ? (
                  <View style={styles.savedContent}>
                    <CheckIcon size={14} color={colors.onAccent} />
                    <Text style={styles.saveButtonText}>Saved</Text>
                  </View>
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </Pressable>
            </View>
            <Text style={styles.helperText}>Separate each X display name with a comma.</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>PRIVACY</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>Hide account balances</Text>
              <Text style={styles.settingDescription}>
                Mask portfolio and asset values on the Account page.
              </Text>
            </View>
            <Switch
              value={!balancesVisible}
              onValueChange={(hidden) => setBalancesVisible(!hidden)}
              trackColor={{ false: colors.surfaceAlt, true: colors.accent }}
              thumbColor={!balancesVisible ? '#FFFFFF' : colors.text}
              accessibilityLabel="Hide account balances"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>TRADING</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>Enable Quick Buy</Text>
              <Text style={styles.settingDescription}>
                Replace ask rows with four live buy price and depth shortcuts.
              </Text>
            </View>
            <Switch
              value={quickBuyEnabled}
              onValueChange={setQuickBuyEnabled}
              trackColor={{ false: colors.surfaceAlt, true: colors.up }}
              thumbColor={quickBuyEnabled ? '#FFFFFF' : colors.text}
              accessibilityLabel="Enable Quick Buy"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>APPEARANCE</Text>
          <Text style={styles.sectionTitle}>Display</Text>
          <Text style={styles.sectionDescription}>Choose the app theme and interface scale.</Text>

          <Text style={styles.fieldLabel}>THEME</Text>
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

          <View style={styles.divider} />
          <View style={styles.fontHeader}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>Font & interface size</Text>
              <Text style={styles.settingDescription}>Scales text and app layout together.</Text>
            </View>
            <Text style={styles.currentSize}>{FONT_SIZE_OPTIONS[fontSizeStep]!.label}</Text>
          </View>
          <View style={styles.sizeOptions}>
            {FONT_SIZE_OPTIONS.map((option, index) => {
              const active = fontSizeStep === index;
              return (
                <Pressable
                  key={option.label}
                  onPress={() => setFontSizeStep(index)}
                  style={[styles.sizeOption, active && styles.sizeOptionActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${option.label} font and interface size`}
                >
                  <Text style={[styles.sizeOptionText, active && styles.sizeOptionTextActive]}>
                    {option.shortLabel}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((colors) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  headerBalance: {
    width: 36,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  section: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  sectionEyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  sectionDescription: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: spacing.xs,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  settingCopy: {
    flex: 1,
    gap: 3,
  },
  settingTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  settingDescription: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  fieldLabel: {
    color: colors.textFaint,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  sourceInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sourceInput: {
    flex: 1,
    minWidth: 0,
    height: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  sourceInputDisabled: {
    opacity: 0.5,
  },
  saveButton: {
    minWidth: 68,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.up,
  },
  saveButtonDisabled: {
    opacity: 0.45,
  },
  saveButtonText: {
    color: colors.onAccent,
    fontSize: 12,
    fontWeight: '700',
  },
  savedContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  helperText: {
    color: colors.textFaint,
    fontSize: 10,
    lineHeight: 14,
  },
  segment: {
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  segmentItem: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  segmentItemActive: {
    backgroundColor: colors.accent,
  },
  segmentText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: colors.onAccent,
  },
  fontHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  currentSize: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
  },
  sizeOptions: {
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  sizeOption: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  sizeOptionActive: {
    backgroundColor: colors.accent,
  },
  sizeOptionText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  sizeOptionTextActive: {
    color: colors.onAccent,
  },
}));
