/**
 * Settings › Usage, in the order the questions get asked: what Nyte cost and
 * which models spent it, how much of each subscription is left, where inside
 * Nyte the spend went, and what every tool has recorded all time.
 *
 * The page reads local history once per visit and the providers' limit windows
 * once per visit. A range press is arithmetic over the report already in hand.
 * Every list is the same two parts, a stacked bar and the rows that name its
 * segments, so nothing here is legible only under the pointer and a long name
 * wraps instead of being cut off.
 */
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { Toggle } from "@nyte-ai/ui/toggle";
import * as stylex from "@stylexjs/stylex";
import { useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Icon } from "../components/icons.tsx";
import { Button, focus, srOnly } from "../components/ui.tsx";
import { useAccountLimits, useUsageReport } from "../queries.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { skeletonStyles as bone, usageStyles as styles } from "./usage-settings.stylex.ts";
import {
  costChange,
  dayLabel,
  deriveAccount,
  deriveLocalHistory,
  deriveTools,
  deriveUsage,
  describeEmptyRange,
  describeTotals,
  formatPercent,
  formatUsd,
  timeLabel,
  usageWindow,
  LOCAL_TOOLS,
  USAGE_RANGE_LABELS,
  USAGE_RANGES,
  USAGE_TOOL_LABELS,
  type UsageDerived,
  type UsageRange,
  type UsageRow,
} from "./usage-view.ts";

/** Rows past this are counted in one line: a ranked list is read from the top. */
const MAX_ROWS = 5;

/** A window this full is worth a second look, so it drops the calm colour. */
const LIMIT_HIGH_PERCENT = 85;

/** One colour per rank, shared by a bar segment and the row that names it. */
const RANK_COLOURS = [
  styles.series0,
  styles.series1,
  styles.series2,
  styles.series3,
  styles.series4,
] as const;

function rankColour(rank: number): stylex.StyleXStyles {
  return RANK_COLOURS[rank % RANK_COLOURS.length] ?? styles.series0;
}

function percentOf(share: number): string {
  return `${String(Math.min(Math.max(share, 0), 1) * 100)}%`;
}

function Bone({
  width,
  height,
}: {
  readonly width: number | string;
  readonly height: number;
}): ReactElement {
  return <span aria-hidden="true" {...stylex.props(bone.bone)} style={{ width, height }} />;
}

function UsageSection({
  title,
  hint,
  actions,
  children,
}: {
  readonly title: string;
  readonly hint?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section aria-label={title} {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.heading)}>
        <span {...stylex.props(styles.headingCopy)}>
          <h2 {...stylex.props(settingsPatterns.sectionTitle)}>{title}</h2>
          {hint !== undefined && <span {...stylex.props(styles.hint)}>{hint}</span>}
        </span>
        {actions !== undefined && <span {...stylex.props(styles.headingActions)}>{actions}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * A whole split into its parts: one stacked bar, then the rows that name its
 * segments. The rows carry the numbers, so the bar needs no readout.
 */
function Breakdown({
  label,
  rows,
  empty,
}: {
  readonly label: string;
  readonly rows: readonly UsageRow[];
  readonly empty: string;
}): ReactElement {
  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;

  return (
    <div {...stylex.props(styles.group)}>
      {shown.length === 0 ? (
        <p {...stylex.props(styles.row, styles.meta)}>{empty}</p>
      ) : (
        <>
          <span aria-hidden="true" {...stylex.props(styles.bar)}>
            {shown.map((row, rank) =>
              row.share <= 0 ? null : (
                <span
                  key={row.key}
                  {...stylex.props(styles.barSegment, rankColour(rank))}
                  style={{ flexBasis: percentOf(row.share) }}
                />
              ),
            )}
          </span>
          <div role="list" aria-label={label}>
            {shown.map((row, rank) => (
              <div role="listitem" key={row.key} {...stylex.props(styles.row)}>
                <span {...stylex.props(styles.rowCopy)}>
                  <span {...stylex.props(styles.rowName)}>
                    <span aria-hidden="true" {...stylex.props(styles.dot, rankColour(rank))} />
                    {row.label}
                  </span>
                  <span {...stylex.props(styles.rowMeta)}>{row.meta}</span>
                </span>
                <span
                  {...stylex.props(styles.rowValue, row.value.kind === "absent" && styles.absent)}
                >
                  {row.value.text}
                </span>
                <span {...stylex.props(styles.rowShare)}>{formatPercent(row.share)}</span>
              </div>
            ))}
            {hidden > 0 && <p {...stylex.props(styles.row, styles.meta)}>+{String(hidden)} more</p>}
          </div>
        </>
      )}
    </div>
  );
}

function BreakdownSkeleton({
  rows,
  bar = true,
}: {
  readonly rows: number;
  /** A list with no whole to split, such as the limit windows, waits without one. */
  readonly bar?: boolean;
}): ReactElement {
  return (
    <div aria-busy="true" {...stylex.props(styles.group)}>
      {bar && <span {...stylex.props(styles.bar)} />}
      {Array.from({ length: rows }, (_slot, index) => (
        <span key={index} {...stylex.props(styles.row, bone.row)}>
          <Bone width={index === 0 ? 168 : 124} height={10} />
          <Bone width={index === 0 ? "58%" : "34%"} height={8} />
        </span>
      ))}
    </div>
  );
}

/**
 * Spend per bucket across the window. The bars carry the shape and the caption
 * carries the numbers, so nothing has to be hovered to be read.
 */
function SpendTrend({ usage }: { readonly usage: UsageDerived }): ReactElement | null {
  const peak = usage.points.reduce((found, point) => (point.cost > found.cost ? point : found), {
    label: "",
    cost: 0,
  });
  if (usage.points.length < 2 || peak.cost <= 0) return null;

  return (
    <div {...stylex.props(styles.trend)}>
      <span aria-hidden="true" {...stylex.props(styles.trendBars)}>
        {usage.points.map((point) => (
          <span
            key={point.label}
            {...stylex.props(styles.trendBar, point.cost === peak.cost && styles.trendPeak)}
            style={{ height: percentOf(point.cost / peak.cost) }}
          />
        ))}
      </span>
      <span {...stylex.props(styles.trendCaption)}>
        <span>{usage.grain === "week" ? "Per week" : "Per day"}</span>
        <span>
          Peak {formatUsd(peak.cost)} · {peak.label}
        </span>
      </span>
    </div>
  );
}

function LimitMeter({
  label,
  used,
  reset,
}: {
  readonly label: string;
  readonly used: number;
  readonly reset: string;
}): ReactElement {
  const high = used >= LIMIT_HIGH_PERCENT;

  return (
    <div {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.meter, styles.rowCopy)}>
        <span {...stylex.props(styles.meterHead)}>
          <span {...stylex.props(styles.rowName)}>{label}</span>
          <span {...stylex.props(styles.rowValue, high && styles.meterHigh)}>
            {String(used)}% used
          </span>
        </span>
        <span
          role="progressbar"
          aria-label={`${label} limit`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={used}
          aria-valuetext={`${String(used)}% used`}
          {...stylex.props(styles.meterTrack)}
        >
          <span
            {...stylex.props(styles.meterFill, high && styles.meterFillHigh)}
            style={{ width: percentOf(used / 100) }}
          />
        </span>
        <span {...stylex.props(styles.rowMeta)}>{reset}</span>
      </span>
    </div>
  );
}

function Notice({
  children,
  alert,
  action,
}: {
  readonly children: ReactNode;
  readonly alert?: boolean;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <p role={alert === true ? "alert" : "status"} {...stylex.props(styles.notice)}>
      <Icon name="warning" size={13} {...stylex.props(styles.noticeIcon)} />
      <span {...stylex.props(styles.noticeCopy)}>{children}</span>
      {action}
    </p>
  );
}

function EmptyPanel({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action: ReactNode;
}): ReactElement {
  return (
    <div {...stylex.props(styles.panel)}>
      <span {...stylex.props(styles.panelTitle)}>{title}</span>
      <p {...stylex.props(styles.panelBody)}>{body}</p>
      <span {...stylex.props(styles.panelActions)}>{action}</span>
    </div>
  );
}

export function UsageSettings(): ReactElement {
  // Keep the heading and the query on the same day if the panel stays open past midnight.
  const [openedAt] = useState(() => Date.now());
  const [range, setRange] = useState<UsageRange>("30d");
  const view = useMemo(() => usageWindow(range, openedAt), [range, openedAt]);

  const { report, error, isFetching, refresh } = useUsageReport(view.untilDay);
  const limits = useAccountLimits();
  const usage = useMemo(
    () => (report === undefined ? undefined : deriveUsage(report, view)),
    [report, view],
  );
  const tools = useMemo(() => (report === undefined ? undefined : deriveTools(report)), [report]);
  const histories = useMemo(
    () =>
      report === undefined
        ? undefined
        : LOCAL_TOOLS.map((tool) => ({ tool, history: deriveLocalHistory(tool, report[tool]) })),
    [report],
  );

  const refreshButton = (
    <Button variant="secondary" disabled={isFetching} onClick={refresh}>
      {isFetching ? "Reading…" : "Refresh"}
    </Button>
  );

  if (report === undefined && error !== null) {
    return (
      <div role="alert">
        <EmptyPanel title="Couldn't read usage" body={error.message} action={refreshButton} />
      </div>
    );
  }

  const empty =
    report === undefined || usage === undefined || report.entries.length > 0
      ? undefined
      : describeEmptyRange(report, usage.unreadFolders, range);
  const change =
    usage === undefined ? undefined : costChange(usage.totals.cost, usage.previousCost);

  return (
    <div {...stylex.props(styles.page)}>
      {report === undefined && (
        <span role="status" {...stylex.props(srOnly)}>
          Reading local history…
        </span>
      )}

      <UsageSection
        title="Nyte"
        hint={
          report === undefined || usage === undefined ? (
            <Bone width={168} height={9} />
          ) : (
            `${usage.from === usage.to ? dayLabel(usage.to) : `${dayLabel(usage.from)} – ${dayLabel(usage.to)}`} · read at ${timeLabel(report.readAt)}`
          )
        }
        actions={
          <>
            {refreshButton}
            <ToggleGroup
              value={[range]}
              aria-label="Usage range"
              {...stylex.props(styles.segments)}
              onValueChange={(next) => {
                // Keep the current range when its toggle is pressed again.
                const chosen = next.at(-1);
                if (chosen !== undefined) setRange(chosen);
              }}
            >
              {USAGE_RANGES.map((option) => (
                <Toggle key={option} value={option} {...stylex.props(styles.segment, focus.ring)}>
                  {USAGE_RANGE_LABELS[option]}
                </Toggle>
              ))}
            </ToggleGroup>
          </>
        }
      >
        {report !== undefined && error !== null && (
          <Notice
            alert
            action={
              <button
                type="button"
                onClick={refresh}
                {...stylex.props(styles.noticeAction, focus.ring)}
              >
                Refresh
              </button>
            }
          >
            Showing the last good read, from {timeLabel(report.readAt)}. {error.message}
          </Notice>
        )}
        {error === null && usage !== undefined && usage.unreadFolders.length > 0 && (
          <Notice>
            Couldn&apos;t read {usage.unreadFolders.join(", ")}.{" "}
            {usage.unreadFolders.length === 1 ? "Its" : "Their"} usage is missing from these totals.
          </Notice>
        )}

        {usage === undefined ? (
          <>
            <span {...stylex.props(styles.headline)}>
              <Bone width={148} height={28} />
              <Bone width={264} height={10} />
            </span>
            <BreakdownSkeleton rows={4} />
          </>
        ) : empty !== undefined ? (
          <EmptyPanel
            title={empty.title}
            body={empty.body}
            action={
              empty.offerAllTime ? (
                <Button variant="primary" onClick={() => setRange("all")}>
                  Show all time
                </Button>
              ) : (
                refreshButton
              )
            }
          />
        ) : (
          <>
            <span {...stylex.props(styles.headline)}>
              <span {...stylex.props(styles.amount)}>{formatUsd(usage.totals.cost)}</span>
              <span {...stylex.props(styles.meta)}>
                {describeTotals(usage.totals)}
                {change !== undefined && (
                  <>
                    {" · "}
                    <span
                      {...stylex.props(
                        change.direction === "up" && styles.changeUp,
                        change.direction === "down" && styles.changeDown,
                      )}
                    >
                      {change.label}
                    </span>
                    {" on the period before"}
                  </>
                )}
              </span>
            </span>
            <SpendTrend usage={usage} />
            <Breakdown
              label="Nyte spend by model"
              rows={usage.models}
              empty="No model recorded spend in this range."
            />
          </>
        )}
      </UsageSection>

      <UsageSection title="Plan limits">
        {limits.error !== null ? (
          <Notice alert>Couldn&apos;t read plan limits. {limits.error.message}</Notice>
        ) : limits.data === undefined ? (
          <BreakdownSkeleton rows={2} bar={false} />
        ) : (
          limits.data.map((account) => {
            const plan = deriveAccount(account);
            return (
              <div key={account.provider} {...stylex.props(styles.stack)}>
                <h3 {...stylex.props(styles.label)}>{plan.title}</h3>
                <div {...stylex.props(styles.group)}>
                  {plan.message === undefined ? (
                    plan.meters.map((meter) => (
                      <LimitMeter
                        key={meter.key}
                        label={meter.label}
                        used={meter.used}
                        reset={meter.reset}
                      />
                    ))
                  ) : (
                    <p
                      role={plan.failed ? "alert" : undefined}
                      {...stylex.props(styles.row, styles.meta)}
                    >
                      {plan.message}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </UsageSection>

      {usage !== undefined && empty === undefined && (
        <UsageSection title="Where it went">
          <h3 {...stylex.props(styles.label)}>By folder</h3>
          <Breakdown
            label="Nyte spend by folder"
            rows={usage.folders}
            empty="No folder recorded spend in this range."
          />
          <h3 {...stylex.props(styles.label)}>By chat</h3>
          <Breakdown
            label="Nyte spend by chat"
            rows={usage.chats}
            empty="No chat recorded spend in this range."
          />
        </UsageSection>
      )}

      <UsageSection title="All tools" hint="All time">
        <span {...stylex.props(styles.headline)}>
          <span {...stylex.props(styles.amount)}>
            {tools === undefined ? <Bone width={120} height={28} /> : tools.amount}
          </span>
          <span {...stylex.props(styles.meta)}>
            {tools === undefined ? <Bone width={248} height={10} /> : tools.meta}
          </span>
        </span>
        {tools === undefined ? (
          <BreakdownSkeleton rows={3} />
        ) : (
          <Breakdown label="Spend by tool" rows={tools.rows} empty="No tool history read." />
        )}
        {(histories ?? LOCAL_TOOLS.map((tool) => ({ tool, history: undefined }))).map(
          ({ tool, history }) => (
            <div key={tool} {...stylex.props(styles.stack)}>
              <h3 {...stylex.props(styles.label)}>{USAGE_TOOL_LABELS[tool]} by model</h3>
              {history === undefined ? (
                <BreakdownSkeleton rows={2} />
              ) : history.kind === "message" ? (
                <div {...stylex.props(styles.group)}>
                  <p
                    role={history.failed ? "alert" : undefined}
                    {...stylex.props(styles.row, styles.meta)}
                  >
                    {history.message}
                  </p>
                </div>
              ) : (
                <>
                  <Breakdown
                    label={`${USAGE_TOOL_LABELS[tool]} spend by model`}
                    rows={history.rows}
                    empty="No usage records in the readable history."
                  />
                  {history.note !== undefined && (
                    <p {...stylex.props(styles.note)}>{history.note}</p>
                  )}
                </>
              )}
            </div>
          ),
        )}
      </UsageSection>
    </div>
  );
}
