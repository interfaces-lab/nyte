import { ActionSheetIOS, Switch } from "react-native";
import { css, html } from "react-strict-dom";
import type { SFSymbol } from "expo-symbols";
import { GroupRow } from "../ui/group.tsx";
import { IconRing } from "../ui/icon-tile.tsx";
import type { Setting } from "./preferences.ts";
import { textStyles, useTheme } from "../theme.ts";

export function ChoiceRow<Value extends string>({
  label,
  icon,
  setting,
}: {
  label: string;
  icon?: SFSymbol;
  setting: Setting<Value>;
}) {
  return (
    <GroupRow
      onClick={() =>
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: label,
            options: [...setting.choices.map((choice) => choice.label), "Cancel"],
            cancelButtonIndex: setting.choices.length,
          },
          (index) => {
            const choice = setting.choices[index];
            if (choice !== undefined) setting.select(choice.value);
          },
        )
      }
    >
      {icon === undefined ? null : <IconRing name={icon} />}
      <html.span style={[textStyles.body, styles.label]}>{label}</html.span>
      <html.span style={[textStyles.secondary, styles.trailing]}>{setting.label}</html.span>
    </GroupRow>
  );
}

export function SwitchRow({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon?: SFSymbol;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useTheme();

  return (
    <GroupRow role="switch" checked={value} onClick={() => onChange(!value)}>
      {icon === undefined ? null : <IconRing name={icon} />}
      <html.span style={[textStyles.body, styles.label]}>{label}</html.span>
      <html.div style={styles.trailing} aria-hidden>
        <Switch
          value={value}
          accessible={false}
          pointerEvents="none"
          trackColor={{ false: theme.fill, true: theme.accentFill }}
        />
      </html.div>
    </GroupRow>
  );
}

const styles = css.create({
  label: { flexShrink: 1, textAlign: "start" },
  trailing: { flexShrink: 0, marginInlineStart: "auto" },
});
