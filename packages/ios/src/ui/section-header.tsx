import { css, html } from "react-strict-dom";
import { list, textStyles } from "../theme.ts";

/** Sentence-case section label, inset to the list gutter. */
export function SectionHeader({ label, first = false }: { label: string; first?: boolean }) {
  return (
    <html.div style={[styles.header, !first && styles.following]}>
      <html.span style={textStyles.secondary}>{label}</html.span>
    </html.div>
  );
}

const styles = css.create({
  header: {
    paddingInline: list.gutter,
    paddingBottom: list.headerGap,
  },
  following: { paddingTop: list.sectionGap },
});
