/**
 * Rows that settle in place. A preference the user can see the result of is a
 * menu or a switch on the row itself, never a pushed screen: the list stays put
 * while the app changes behind it.
 */
import { Button, HStack, Host, Image, Menu, Text } from "@expo/ui/swift-ui";
import { buttonStyle, font, foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { Switch } from "react-native";
import { css, html } from "react-strict-dom";
import { GroupRow } from "../ui/group.tsx";
import type { Setting } from "./preferences.ts";
import { controls, spacing, textStyles, typography, useTheme } from "../theme.ts";

export function ChoiceRow<Value extends string>({
  label,
  setting,
}: {
  label: string;
  setting: Setting<Value>;
}) {
  const theme = useTheme();
  return (
    <GroupRow>
      <html.span style={[textStyles.body, styles.label]}>{label}</html.span>
      <html.div style={styles.trailing}>
        <Host matchContents={{ horizontal: true }} style={menuHost} ignoreSafeArea="all">
          <Menu
            label={
              <HStack spacing={4}>
                <Text modifiers={[font(valueFont), foregroundStyle(theme.muted)]}>
                  {setting.label}
                </Text>
                <Image
                  systemName="chevron.up.chevron.down"
                  size={10}
                  modifiers={[foregroundStyle(theme.tertiary)]}
                />
              </HStack>
            }
            modifiers={[buttonStyle("plain")]}
          >
            {setting.choices.map((choice) => (
              <Button
                key={choice.value}
                label={choice.label}
                systemImage={choice.value === setting.value ? "checkmark" : undefined}
                onPress={() => setting.select(choice.value)}
              />
            ))}
          </Menu>
        </Host>
      </html.div>
    </GroupRow>
  );
}

export function SwitchRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <GroupRow>
      <html.span style={[textStyles.body, styles.label]}>{label}</html.span>
      <html.div style={styles.trailing}>
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: theme.fill, true: theme.accent }}
          accessibilityLabel={label}
        />
      </html.div>
    </GroupRow>
  );
}

const valueFont = { size: typography.secondary.fontSize } as const;
const menuHost = { height: controls.metaTarget } as const;

const styles = css.create({
  label: { flexShrink: 1, textAlign: "start" },
  trailing: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: spacing.sm,
    marginInlineStart: "auto",
  },
});
