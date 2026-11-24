import type { ComponentProps } from "react";
import { StyleSheet, View } from "react-native";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Pressable } from "@/components/AppLayout";
import { Text } from "@/components/AppText";
import { AccountIcon, HomeIcon, TradeIcon } from "@/components/Icons";
import {
  FLOATING_TAB_BAR_BOTTOM_MARGIN,
  FLOATING_TAB_BAR_HEIGHT,
} from "@/hooks/useFloatingTabBarInset";
import { spacing } from "@/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { createThemedStyles } from "@/theme/themedStyles";

type BottomTabBarProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
>[0];

const VISIBLE_TABS = new Set(["index", "trade", "account"]);

function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const isDark = scheme === "dark";

  const activeColor = "#00B982";
  const inactiveIconColor = isDark ? colors.textFaint : "#8A94A7";
  const inactiveLabelColor = isDark ? colors.textMuted : "#7C879D";

  return (
    <View
      style={[
        styles.bar,
        {
          height: FLOATING_TAB_BAR_HEIGHT,
          bottom: insets.bottom + FLOATING_TAB_BAR_BOTTOM_MARGIN,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        if (!VISIBLE_TABS.has(route.name)) return null;
        const { options } = descriptors[route.key]!;
        const isFocused = state.index === index;
        const label =
          typeof options.title === "string" ? options.title : route.name;

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        const onLongPress = () => {
          navigation.emit({
            type: "tabLongPress",
            target: route.key,
          });
        };

        const iconColor = isFocused ? activeColor : inactiveIconColor;
        const labelColor = isFocused ? activeColor : inactiveLabelColor;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            onPress={onPress}
            onLongPress={onLongPress}
            style={[styles.item, isFocused && styles.itemActive]}
          >
            {options.tabBarIcon?.({
              focused: isFocused,
              color: iconColor,
              size: 18,
            })}
            <Text
              style={[
                styles.label,
                { color: labelColor, fontWeight: isFocused ? "600" : "500" },
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <HomeIcon size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="trade"
        options={{
          title: "Trade",
          tabBarIcon: ({ color }) => <TradeIcon size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color }) => <AccountIcon size={18} color={color} />,
        }}
      />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}

const useStyles = createThemedStyles((colors) => {
  const isDark = colors.bg === "#121212";
  return StyleSheet.create({
    bar: {
      position: "absolute",
      left: spacing.lg,
      right: spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 6,
      gap: 4,
      borderRadius: 32,
      backgroundColor: isDark ? colors.surface : "#FFFFFF",
      borderWidth: 1,
      borderColor: isDark ? colors.border : "#F0F2F5",
      shadowColor: "#1E3250",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: isDark ? 0.35 : 0.08,
      shadowRadius: 16,
      elevation: 6,
    },
    item: {
      flex: 1,
      height: 54,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
    },
    itemActive: {
      backgroundColor: isDark ? "rgba(0, 185, 130, 0.16)" : "#E7F9F2",
    },
    label: {
      fontSize: 11,
    },
  });
});
