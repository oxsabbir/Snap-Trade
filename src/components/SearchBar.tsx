import { Pressable, View } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { TextInput } from '@/components/AppText';

import { CloseIcon, SearchIcon } from '@/components/Icons';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { createThemedStyles } from '@/theme/themedStyles';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onSubmit?: () => void;
  placeholder?: string;
};

export function SearchBar({
  value,
  onChangeText,
  onFocus,
  onBlur,
  onSubmit,
  placeholder = 'Search coin',
}: Props) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.container}>
      <View style={styles.leadingIcon}>
        <SearchIcon />
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="search"
        clearButtonMode="never"
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={10}
          style={styles.trailingIcon}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <CloseIcon />
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      height: 40,
      paddingHorizontal: spacing.md,
    },
    leadingIcon: {
      marginRight: spacing.sm,
    },
    input: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      padding: 0,
    },
    trailingIcon: {
      marginLeft: spacing.sm,
    },
  }),
);