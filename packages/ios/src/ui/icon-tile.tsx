import { css, html } from "react-strict-dom";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { list, radii, tokens, useTheme } from "../theme.ts";

/** A muted icon tile — the leading slot in grouped rows. */
export function IconTile({ name, color }: { name: SFSymbol; color?: string }) {
  const theme = useTheme();
  return (
    <html.div style={styles.tile}>
      <SymbolView name={name} size={14} tintColor={color ?? theme.muted} />
    </html.div>
  );
}

const styles = css.create({
  tile: {
    width: list.tile,
    height: list.tile,
    borderRadius: radii.tile,
    backgroundColor: tokens.fill,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
