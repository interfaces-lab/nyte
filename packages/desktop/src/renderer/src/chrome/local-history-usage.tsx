/**
 * Settings › Usage: one tool's local history by model. Claude Code and Codex
 * are read the same way and answer in the same shape, so they share a section
 * and differ only in name and in where their history was looked for.
 */
import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { UsageSnapshot } from "../../../shared/ipc.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { localHistoryStyles as styles } from "./usage-settings.stylex.ts";
import { Bone, ModelRowsSkeleton } from "./usage-skeleton.tsx";
import {
  formatTokens,
  formatUsd,
  USAGE_TOOL_HOMES,
  USAGE_TOOL_LABELS,
  type UsageTool,
} from "./usage-view.ts";

/** How many model rows the skeleton stands in for; most histories have a few. */
const SKELETON_ROWS = 3;

export type LocalHistoryTool = Exclude<UsageTool, "nyte">;

export function LocalHistorySection({
  tool,
  usage,
}: {
  readonly tool: LocalHistoryTool;
  /** Undefined while the report that carries this section is still being read. */
  readonly usage: UsageSnapshot["claudeCode"] | undefined;
}): ReactElement {
  const title = `${USAGE_TOOL_LABELS[tool]} · by model`;
  return (
    <section aria-label={title} {...props(settingsPatterns.section)}>
      <div {...props(settingsPatterns.sectionHeader)}>
        <h2 {...props(settingsPatterns.sectionTitle)}>{title}</h2>
        <p {...props(settingsPatterns.sectionDescription)}>
          All-time, ignoring the range above · API estimates, not charges
        </p>
      </div>
      <LocalHistoryBody tool={tool} usage={usage} />
    </section>
  );
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

function LocalHistoryBody({
  tool,
  usage,
}: {
  readonly tool: LocalHistoryTool;
  readonly usage: UsageSnapshot["claudeCode"] | undefined;
}): ReactElement {
  if (usage === undefined) {
    return (
      <>
        <span {...props(styles.headline)}>
          <Bone width={132} height={24} />
          <Bone width={188} height={11} />
        </span>
        <ModelRowsSkeleton rows={SKELETON_ROWS} />
      </>
    );
  }

  switch (usage.kind) {
    case "missing":
      return (
        <p {...props(styles.meta, settingsPatterns.sectionDescription)}>
          No local history in {USAGE_TOOL_HOMES[tool]}.
        </p>
      );
    case "failed":
      return (
        <p role="alert" {...props(styles.meta, settingsPatterns.sectionDescription)}>
          Couldn&apos;t read {USAGE_TOOL_LABELS[tool]} local history. {usage.message}
        </p>
      );
    case "ready": {
      const total = usage.summary.total;
      // Silence is the good state: the coverage line only appears when the read
      // left out something the totals below cannot account for.
      const skipped = [
        usage.malformedRecords > 0 && plural(usage.malformedRecords, "malformed record"),
        usage.unreadableFiles > 0 && plural(usage.unreadableFiles, "unreadable file"),
        usage.unpricedRecords > 0 && plural(usage.unpricedRecords, "unpriced record"),
      ].filter((gap) => gap !== false);
      const partial = skipped.length > 0;

      return (
        <>
          <span {...props(styles.headline)}>
            <span {...props(styles.amount)}>
              {partial && total.cost.total === 0
                ? "No priced history"
                : formatUsd(total.cost.total)}
            </span>
            <span {...props(styles.meta)}>
              {formatTokens(total.totalTokens)} tokens ·{" "}
              {partial ? "partial API estimate" : "API estimate"}
            </span>
            {partial && (
              <span role="status" {...props(styles.meta)}>
                Skipped {skipped.join(", ")}. Unpriced tokens count as tokens, not cost.
              </span>
            )}
          </span>
          {usage.summary.models.length === 0 ? (
            <p {...props(styles.meta, settingsPatterns.sectionDescription)}>
              No usage records in the readable history.
            </p>
          ) : (
            <div
              role="list"
              aria-label={`${USAGE_TOOL_LABELS[tool]} usage by model`}
              {...props(settingsPatterns.group)}
            >
              {usage.summary.models.map((row) => (
                <div
                  role="listitem"
                  key={JSON.stringify([row.provider, row.model])}
                  {...props(settingsPatterns.row)}
                >
                  <div {...props(settingsPatterns.rowCopy)}>
                    <span {...props(settingsPatterns.rowTitle)}>{row.model}</span>
                    <span {...props(styles.rowMeta)}>
                      {formatTokens(row.usage.totalTokens)} tokens · {plural(row.turns, "record")}
                    </span>
                  </div>
                  {row.usage.cost.total === 0 && partial ? (
                    <span {...props(styles.rowUnpriced)}>Unpriced</span>
                  ) : (
                    <span {...props(styles.rowAmount)}>{formatUsd(row.usage.cost.total)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      );
    }
    default: {
      const _exhaustive: never = usage;
      return _exhaustive;
    }
  }
}
