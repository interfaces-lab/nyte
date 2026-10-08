import { css, html } from "react-strict-dom";
import { list, textStyles, tokens } from "../theme.ts";

export function SectionHeader({
  label,
  first = false,
  tone = "muted",
}: {
  label: string;
  first?: boolean;
  tone?: "muted" | "danger";
}) {
  return (
    <html.div style={[styles.header, !first && styles.following]}>
      <html.h2 style={[textStyles.secondary, styles.label, tone === "danger" && styles.danger]}>
        {label}
      </html.h2>
    </html.div>
  );
}

const styles = css.create({
  header: {
    paddingInline: list.gutter,
    paddingBottom: list.headerGap,
  },
  following: { paddingTop: list.sectionGap },
  label: { margin: 0, fontWeight: 500 },
  danger: { color: tokens.danger },
});
