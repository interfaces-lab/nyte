import { css, html } from "react-strict-dom";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { controls, list, radii, tokens, useTheme } from "../theme.ts";

/** A muted icon tile — the leading slot in grouped rows. */
export function IconTile({ name, color }: { name: SFSymbol; color?: string }) {
  const theme = useTheme();

  return (
    <html.div style={styles.tile}>
      <SymbolView name={name} size={14} tintColor={color ?? theme.muted} />
    </html.div>
  );
}

/** A hairline ring holding a glyph — the leading slot in flat rows. */
export function IconRing({ name, color }: { name: SFSymbol; color?: string }) {
  const theme = useTheme();
  const tint = color ?? theme.muted;

  return (
    <html.div style={[styles.ring, styles.ringTint(tint)]}>
      <SymbolView name={name} size={13} tintColor={tint} />
    </html.div>
  );
}

const styles = css.create({
  tile: {
    display: "flex",
    flexDirection: "column",
    width: list.tile,
    height: list.tile,
    borderRadius: radii.tile,
    backgroundColor: tokens.fill,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  ring: {
    display: "flex",
    width: list.ring,
    height: list.ring,
    borderRadius: radii.pill,
    borderWidth: controls.hairline,
    borderStyle: "solid",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  ringTint: (color: string) => ({ borderColor: color }),
});
