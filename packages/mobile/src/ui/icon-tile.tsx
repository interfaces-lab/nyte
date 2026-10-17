import { css, html } from "react-strict-dom";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { controls, list, useTheme } from "../theme.ts";

export function IconTile({ name, color }: { name: SFSymbol; color?: string }) {
  const theme = useTheme();

  return (
    <html.div style={styles.icon} aria-hidden>
      <SymbolView name={name} size={controls.icon} tintColor={color ?? theme.muted} />
    </html.div>
  );
}

const styles = css.create({
  icon: {
    display: "flex",
    flexDirection: "column",
    width: list.tile,
    height: list.tile,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
