import { useState } from 'react';
import { StyleSheet, Switch } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable, ScrollView, View } from '@/components/AppLayout';
import { Text, TextInput } from '@/components/AppText';
import { BackIcon, CheckIcon } from '@/components/Icons';
import { useSignalSource } from '@/hooks/useSignalSource';
import { SIGNAL_DETECTION_ENABLED } from '@/lib/featureFlags';
import { useBalanceVisibility } from '@/state/balanceVisibility';
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
  const { step, setStep } = useFontScale();
  const { balancesVisible, setBalancesVisible } = useBalanceVisibility();
  const signal = useSignalSource();
  const styles = useStyles();
  const [sourceName, setSourceName] = useState(signal.displayName);
  const [saved, setSaved] = useState(false);

  // Keep the draft in sync when the stored signal sources finish hydrating.
  const [previousSignalName, setPreviousSignalName] = useState(signal.displayName);
  if (signal.displayName !== previousSignalName) {
    setPreviousSignalName(signal.displayName);
    setSourceName(signal.displayName);
  }

  const saveSources = () => {
    signal.setDisplayName(sourceName.trim().slice(0, 80));
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back">
          <BackIcon size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>PRIVACY</Text>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <Text style={styles.settingTitle}>Show account balances</Text>
                <Text style={styles.description}>When off, amounts on the Account screen are masked.</Text>
              </View>
              <Switch
                value={balancesVisible}
                onValueChange={setBalancesVisible}
                trackColor={{ false: colors.surfaceAlt, true: colors.up }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Show account balances"
              />
            </View>
          </View>
        </View>

        {SIGNAL_DETECTION_ENABLED ? (
          <View style={styles.section}>
            <Text style={styles.sectionEyebrow}>SIGNAL DETECTION</Text>
            <View style={styles.card}>
              <View style={styles.settingRow}>
                <View style={styles.settingCopy}>
                  <Text style={styles.settingTitle}>Detect signals from notifications</Text>
                  <Text style={styles.description}>Read notifications from X to detect trading signals from your configured sources.</Text>
                </View>
                <Switch
                  value={signal.isEnabled}
                  onValueChange={signal.setIsEnabled}
                  disabled={signal.isLoading}
                  trackColor={{ false: colors.surfaceAlt, true: colors.up }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <View style={styles.divider} />
              <Text style={styles.fieldLabel}>X source names</Text>
              <View style={styles.inputRow}>
                <TextInput
                  value={sourceName}
                  onChangeText={(value) => { setSourceName(value); setSaved(false); }}
                  editable={signal.isEnabled && !signal.isLoading}
                  style={[styles.input, !signal.isEnabled && styles.inputDisabled]}
                  maxLength={80}
                  autoCapitalize="words"
                  autoCorrect={false}
                  autoComplete="off"
                  placeholder={signal.isLoading ? 'Loading…' : 'e.g. Alpha Calls, Gem Hunter'}
                  placeholderTextColor={colors.textFaint}
                  accessibilityLabel="Signal sources, comma-separated"
                />
                <Pressable
                  onPress={saveSources}
                  disabled={!signal.isEnabled || !sourceName.trim() || signal.isLoading}
                  style={[styles.saveButton, (!signal.isEnabled || !sourceName.trim() || signal.isLoading) && styles.disabled]}
                  accessibilityRole="button"
                  accessibilityLabel="Save signal sources"
                >
                  {saved ? <CheckIcon size={15} color={colors.onAccent} /> : <Text style={styles.saveText}>Save</Text>}
                </Pressable>
              </View>
              <Text style={styles.description}>Separate each source&apos;s display name with a comma.</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>APPEARANCE</Text>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Theme</Text>
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
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.divider} />
            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <Text style={styles.settingTitle}>Text size</Text>
                <Text style={styles.description}>Adjust text across the app.</Text>
              </View>
              <Text style={styles.currentSize}>{FONT_SIZE_OPTIONS[step]!.label}</Text>
            </View>
            <View style={styles.fontOptions}>
              {FONT_SIZE_OPTIONS.map((option, index) => {
                const active = step === index;
                return (
                  <Pressable
                    key={option.label}
                    onPress={() => setStep(index)}
                    style={[styles.fontOption, active && styles.fontOptionActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${option.label} app text`}
                  >
                    <Text style={[styles.fontOptionText, active && styles.fontOptionTextActive]}>{option.shortLabel}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((colors) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '700' },
  headerSpacer: { width: 40 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xl },
  section: { gap: spacing.sm },
  sectionEyebrow: { color: colors.textFaint, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  settingCopy: { flex: 1, gap: 3 },
  settingTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  description: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs },
  fieldLabel: { color: colors.textFaint, fontSize: 11, fontWeight: '700' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: { flex: 1, minHeight: 42, color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 14 },
  inputDisabled: { opacity: 0.5 },
  saveButton: { minWidth: 62, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.accent },
  saveText: { color: colors.onAccent, fontSize: 12, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 3, gap: 3 },
  segmentItem: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segmentItemActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: colors.onAccent },
  currentSize: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  fontOptions: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 3, gap: 3 },
  fontOption: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  fontOptionActive: { backgroundColor: colors.accent },
  fontOptionText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  fontOptionTextActive: { color: colors.onAccent },
}));
