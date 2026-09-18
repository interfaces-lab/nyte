import { css, html } from "react-strict-dom";
import { list, textStyles, tokens } from "../theme.ts";

/**
 * Sentence-case section label, inset to the list gutter. It names the group
 * below without competing with it, so it stays at caption size in grey.
 * `danger` tints the label red for sections whose rows are all destructive.
 */
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
      <html.span style={[textStyles.caption, tone === "danger" && styles.danger]}>
        {label}
      </html.span>
    </html.div>
  );
}

const styles = css.create({
  header: {
    paddingInline: list.gutter,
    paddingBottom: list.headerGap,
  },
  following: { paddingTop: list.sectionGap },
  danger: { color: tokens.danger },
});
