import { ActionSheetIOS, Switch } from "react-native";
import { css, html } from "react-strict-dom";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { GroupRow } from "../ui/group.tsx";
import { IconTile } from "../ui/icon-tile.tsx";
import type { Setting } from "./preferences.ts";
import { controls, textStyles, useTheme } from "../theme.ts";

export function ChoiceRow<Value extends string>({
  label,
  icon,
  setting,
}: {
  label: string;
  icon?: SFSymbol;
  setting: Setting<Value>;
}) {
  const theme = useTheme();

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
      {icon === undefined ? null : <IconTile name={icon} />}
      <html.span style={[textStyles.body, styles.label]}>{label}</html.span>
      <html.span style={[textStyles.secondary, styles.trailing]}>{setting.label}</html.span>
      <html.div style={styles.chevron} aria-hidden>
        <SymbolView name="chevron.up.chevron.down" size={controls.iconXs} tintColor={theme.muted} />
      </html.div>
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
  return (
    <GroupRow role="switch" checked={value} onClick={() => onChange(!value)}>
      {icon === undefined ? null : <IconTile name={icon} />}
      <html.span style={[textStyles.body, styles.label]}>{label}</html.span>
      <html.div style={styles.switch} aria-hidden>
        <Switch value={value} accessible={false} pointerEvents="none" />
      </html.div>
    </GroupRow>
  );
}

const styles = css.create({
  label: { flex: 1, minWidth: 0, textAlign: "start" },
  trailing: { flexShrink: 1, maxWidth: "45%", textAlign: "end" },
  switch: { flexShrink: 0, marginInlineStart: "auto" },
  chevron: { display: "flex", alignItems: "center", flexShrink: 0 },
});
