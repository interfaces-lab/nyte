/** One diff surface shared by transcript receipts and the Changes workbench. */
import * as stylex from "@stylexjs/stylex";
import { memo } from "react";
import type { ReactElement } from "react";
import { PierrePatch } from "./pierre-patch.tsx";
import { diffStyles } from "./styles.stylex.ts";
import type { ParsedDiff } from "./tool-detail.ts";

export type DiffViewVariant = "inline" | "workbench";

export const DiffView = memo(function DiffView({
  path,
  diff,
  variant,
}: {
  readonly path: string;
  readonly diff: ParsedDiff;
  readonly variant: DiffViewVariant;
}): ReactElement {
  const workbench = variant === "workbench";

  return (
    <div
      {...stylex.props(diffStyles.surface, workbench ? diffStyles.workbench : diffStyles.inline)}
    >
      {workbench && (
        <div {...stylex.props(diffStyles.header)}>
          <span title={path} {...stylex.props(diffStyles.path)}>
            {path}
          </span>
          <span
            aria-label={`${String(diff.added)} added, ${String(diff.removed)} removed`}
            {...stylex.props(diffStyles.stats)}
          >
            {diff.added > 0 && <span {...stylex.props(diffStyles.added)}>+{diff.added}</span>}
            {diff.removed > 0 && <span {...stylex.props(diffStyles.removed)}>-{diff.removed}</span>}
          </span>
        </div>
      )}
      <div
        data-nyte-scrollport="balanced"
        {...stylex.props(
          diffStyles.body,
          workbench ? diffStyles.bodyWorkbench : diffStyles.bodyInline,
        )}
      >
        <PierrePatch patch={diff.patch} />
      </div>
    </div>
  );
});
