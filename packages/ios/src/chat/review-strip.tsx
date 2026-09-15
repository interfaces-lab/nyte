import { css, html } from "react-strict-dom";
import type { FileChange } from "@nyte-ai/core/views";
import { Chip } from "../ui/chip.tsx";
import { spacing, tokens } from "../theme.ts";

/** The review actions that float above the composer once work finished. */
export function ReviewStrip({
  changes,
  onReview,
  onAskMerge,
}: {
  changes: readonly FileChange[];
  onReview: () => void;
  onAskMerge: () => void;
}) {
  const added = changes.reduce((total, file) => total + file.added, 0);
  const removed = changes.reduce((total, file) => total + file.removed, 0);
  return (
    <html.div style={styles.row}>
      <Chip onClick={onReview}>
        <html.span>Review </html.span>
        <html.span style={styles.success}>{`+${String(added)} `}</html.span>
        <html.span style={styles.danger}>{`\u2212${String(removed)}`}</html.span>
      </Chip>
      <Chip onClick={onAskMerge}>Ask to merge</Chip>
    </html.div>
  );
}

const styles = css.create({
  row: {
    display: "flex",
    flexDirection: "row",
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  success: { color: tokens.success },
  danger: { color: tokens.danger },
});
