import { Pressable, View } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { TextInput } from '@/components/AppText';

import { CloseIcon, SearchIcon } from '@/components/Icons';
import { spacing } from '@/theme';
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
        placeholderTextColor={scheme === 'dark' ? colors.textFaint : '#929BAE'}
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

const useStyles = createThemedStyles((colors) => {
  const isDark = colors.bg === '#121212';
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? colors.surfaceAlt : '#F3F4F7',
      borderRadius: 14,
      height: 44,
      paddingHorizontal: 14,
    },
    leadingIcon: {
      marginRight: spacing.sm,
    },
    input: {
      flex: 1,
      color: isDark ? colors.text : '#111827',
      fontSize: 14,
      padding: 0,
    },
    trailingIcon: {
      marginLeft: spacing.sm,
    },
  });
});