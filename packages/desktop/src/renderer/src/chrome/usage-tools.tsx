/**
 * Settings › Usage: one total across every tool whose history this machine
 * holds, and how Nyte, Claude Code, and Codex divide it.
 *
 * The external readers fold whole histories with no days, so this comparison
 * is all-time by construction and says so once in its header. A tool that
 * could not be read keeps its row, without a number, so the total never
 * quietly shrinks to the tools that answered.
 */
import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { UsageSnapshot } from "../../../shared/ipc.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import type { ChartPalette } from "./usage-charts.tsx";
import { toolStyles as styles } from "./usage-settings.stylex.ts";
import { Bone } from "./usage-skeleton.tsx";
import {
  deriveTools,
  formatPercent,
  formatTokens,
  formatUsd,
  USAGE_TOOL_HOMES,
  USAGE_TOOL_LABELS,
  USAGE_TOOLS,
  type ToolSpend,
  type UsageTool,
} from "./usage-view.ts";

/** Each tool keeps one colour from the headline bar to its row. */
function toolColor(tool: UsageTool, palette: ChartPalette): string {
  switch (tool) {
    case "nyte":
      return palette.series[0] ?? palette.accent;
    case "claudeCode":
      return palette.series[3] ?? palette.accent;
    case "codex":
      return palette.series[4] ?? palette.accent;
    default: {
      const _exhaustive: never = tool;
      return _exhaustive;
    }
  }
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

function ToolRow({
  spend,
  color,
}: {
  readonly spend: ToolSpend;
  readonly color: string;
}): ReactElement {
  const label = USAGE_TOOL_LABELS[spend.tool];
  const title = (
    <span {...props(settingsPatterns.rowTitle, styles.rowTitle)}>
      <span {...props(styles.dot)} style={{ backgroundColor: color }} aria-hidden="true" />
      {label}
    </span>
  );

  switch (spend.kind) {
    case "ready":
      return (
        <div role="listitem" {...props(settingsPatterns.row)}>
          <div {...props(settingsPatterns.rowCopy)}>
            {title}
            <span {...props(styles.rowMeta)}>
              {formatTokens(spend.tokens)} tokens
              {spend.partial && " · partial"}
            </span>
          </div>
          <span {...props(styles.rowShare)}>{formatPercent(spend.share)}</span>
          <span {...props(styles.rowAmount)}>{formatUsd(spend.cost)}</span>
        </div>
      );
    case "missing":
      return (
        <div role="listitem" {...props(settingsPatterns.row)}>
          <div {...props(settingsPatterns.rowCopy)}>
            {title}
            <span {...props(styles.rowMeta)}>
              No local history in {USAGE_TOOL_HOMES[spend.tool]}
            </span>
          </div>
          <span {...props(styles.rowAbsent)}>Not found</span>
        </div>
      );
    case "failed":
      return (
        <div role="listitem" {...props(settingsPatterns.row)}>
          <div {...props(settingsPatterns.rowCopy)}>
            {title}
            <span role="alert" {...props(styles.rowMeta)}>
              {spend.message}
            </span>
          </div>
          <span {...props(styles.rowAbsent)}>Couldn&apos;t read</span>
        </div>
      );
    default: {
      const _exhaustive: never = spend;
      return _exhaustive;
    }
  }
}

function ToolsSkeleton(): ReactElement {
  return (
    <>
      <span {...props(styles.headline)}>
        <Bone width={132} height={24} />
        <Bone width={188} height={11} />
      </span>
      <span {...props(styles.bar)} aria-hidden="true" />
      <div {...props(settingsPatterns.group)}>
        {USAGE_TOOLS.map((tool) => (
          <div key={tool} {...props(settingsPatterns.row)}>
            <div {...props(settingsPatterns.rowCopy)}>
              <span {...props(settingsPatterns.rowTitle)}>{USAGE_TOOL_LABELS[tool]}</span>
              <Bone width={92} height={10} />
            </div>
            <Bone width={56} height={14} />
          </div>
        ))}
      </div>
    </>
  );
}

export function UsageToolsSection({
  report,
  palette,
}: {
  /** Undefined while the report that carries every tool is still being read. */
  readonly report: UsageSnapshot | undefined;
  readonly palette: ChartPalette;
}): ReactElement {
  const tools = report === undefined ? undefined : deriveTools(report);
  const counted = tools?.tools.filter((spend) => spend.kind === "ready") ?? [];
  const priced = tools !== undefined && tools.cost > 0;

  return (
    <section aria-label="All tools" {...props(settingsPatterns.section)}>
      <div {...props(settingsPatterns.sectionHeader)}>
        <h2 {...props(settingsPatterns.sectionTitle)}>All tools</h2>
        <p {...props(settingsPatterns.sectionDescription)}>
          All-time, across every local history · API estimates, not charges
        </p>
      </div>
      {tools === undefined ? (
        <ToolsSkeleton />
      ) : (
        <>
          <span {...props(styles.headline)}>
            <span {...props(styles.amount)}>
              {counted.length === 0 ? "No history read" : formatUsd(tools.cost)}
            </span>
            <span {...props(styles.meta)}>
              {counted.length === 0
                ? "Nothing to total until a tool's history can be read."
                : `${formatTokens(tools.tokens)} tokens across ${joinNames(counted.map((spend) => USAGE_TOOL_LABELS[spend.tool]))}`}
              {counted.length > 0 && counted.length < tools.tools.length && " · others not counted"}
            </span>
          </span>
          <span
            {...props(styles.bar)}
            role="img"
            aria-label={`Share of ${priced ? "spend" : "tokens"} by tool: ${counted
              .map((spend) => `${USAGE_TOOL_LABELS[spend.tool]} ${formatPercent(spend.share)}`)
              .join(", ")}`}
          >
            {counted.map((spend) => (
              <span
                key={spend.tool}
                {...props(styles.barSegment)}
                style={{
                  flexBasis: `${String(spend.share * 100)}%`,
                  backgroundColor: toolColor(spend.tool, palette),
                }}
              />
            ))}
          </span>
          <div role="list" aria-label="Spend by tool" {...props(settingsPatterns.group)}>
            {tools.tools.map((spend) => (
              <ToolRow key={spend.tool} spend={spend} color={toolColor(spend.tool, palette)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
