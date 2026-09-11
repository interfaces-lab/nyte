/**
 * Settings › Usage: one total across every tool on this machine, then recorded
 * API cost estimates and tokens from Nyte's own history for one window at a
 * time, then each external tool's local history by model.
 *
 * The host answers per window, so every card here sums the same cells along a
 * different axis and any two cards reconcile. That is what lets the page state
 * its terms once instead of footnoting each card with what its numbers do not
 * mean.
 *
 * The page is arrangeable because no two readers watch the same number. Cards
 * are sorted with dnd-kit and the order is the reader's, kept across restarts.
 * Dragging moves the card's own node rather than a copy in an overlay, so a
 * chart is never mounted twice and never re-animates mid-drag.
 */
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { Toggle } from "@nyte-ai/ui/toggle";
import * as stylex from "@stylexjs/stylex";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { UsageSnapshot } from "../../../shared/ipc.ts";
import { Icon } from "../components/icons.tsx";
import { Button, focus, formatTimeAgo, srOnly } from "../components/ui.tsx";
import { useUsageReport } from "../queries.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import {
  ActivityChart,
  ChartEmpty,
  MODEL_BAR_LIMIT,
  ModelsChart,
  SpendChart,
  TokensChart,
  useChartPalette,
  type ChartPalette,
} from "./usage-charts.tsx";
import {
  CARD_TITLES,
  getUsageOrder,
  isDefaultUsageOrder,
  LIST_CARDS,
  setUsageOrder,
  TILE_LABELS,
  USAGE_CARDS,
  useUsageOrder,
  type UsageCard,
} from "./usage-layout.ts";
import { usageStyles as styles } from "./usage-settings.stylex.ts";
import { Bone, UsageGridSkeleton, UsageTilesSkeleton } from "./usage-skeleton.tsx";
import { LocalHistorySection } from "./local-history-usage.tsx";
import { UsageToolsSection } from "./usage-tools.tsx";
import {
  cacheHitRate,
  dayLabel,
  deriveUsage,
  costChange,
  formatCount,
  formatPercent,
  formatTokens,
  formatUsd,
  usageWindow,
  USAGE_STALE_AFTER_MS,
  TOKEN_KINDS,
  TOKEN_KIND_LABELS,
  USAGE_RANGE_LABELS,
  USAGE_RANGES,
  type UsageDerived,
  type UsageRange,
} from "./usage-view.ts";

/** Longer than the pointer's own slop, so a click on the grip is never a drag. */
const DRAG_DISTANCE = 4;

/**
 * A minute clock, shared by every reader.
 *
 * "Read 4m ago" is only honest if it counts, and reading the wall clock during
 * render would be neither stable across renders nor self-updating. An external
 * store is both.
 */
interface Clock {
  now: number;
  readonly listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | undefined;
}

const clock: Clock = { now: Date.now(), listeners: new Set(), timer: undefined };

function subscribeClock(listener: () => void): () => void {
  // The panel can be closed for an hour; the first reader back resets the tick.
  clock.now = Date.now();
  clock.listeners.add(listener);
  clock.timer ??= setInterval(() => {
    clock.now = Date.now();
    for (const notify of clock.listeners) notify();
  }, USAGE_STALE_AFTER_MS);
  return () => {
    clock.listeners.delete(listener);
    if (clock.listeners.size === 0 && clock.timer !== undefined) {
      clearInterval(clock.timer);
      clock.timer = undefined;
    }
  };
}

function readClock(): number {
  return clock.now;
}

function useClock(): number {
  return useSyncExternalStore(subscribeClock, readClock, readClock);
}

function RangeControl({
  range,
  onRangeChange,
}: {
  readonly range: UsageRange;
  readonly onRangeChange: (range: UsageRange) => void;
}): ReactElement {
  return (
    <ToggleGroup
      value={[range]}
      aria-label="Usage range"
      {...stylex.props(styles.segments)}
      onValueChange={(next) => {
        // An empty group means the reader pressed the range already showing.
        const chosen = next.at(-1);
        if (chosen !== undefined) onRangeChange(chosen);
      }}
    >
      {USAGE_RANGES.map((option) => (
        <Toggle key={option} value={option} {...stylex.props(styles.segment, focus.ring)}>
          {USAGE_RANGE_LABELS[option]}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

function Tile({
  label,
  value,
  detail,
  detailTitle,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: ReactNode;
  /** The full text when the detail is a name the tile has to truncate. */
  readonly detailTitle?: string;
}): ReactElement {
  return (
    <div {...stylex.props(styles.tile)}>
      <span {...stylex.props(styles.tileLabel)}>{label}</span>
      <span {...stylex.props(styles.tileValue)}>{value}</span>
      <span title={detailTitle} {...stylex.props(styles.tileDetail)}>
        {detail}
      </span>
    </div>
  );
}

function SummaryTiles({ usage }: { readonly usage: UsageDerived }): ReactElement {
  const change = costChange(usage.totals.cost, usage.previousCost);
  const topChat = usage.chats[0];

  return (
    <div {...stylex.props(styles.tiles)}>
      <Tile
        label={TILE_LABELS.spend}
        value={formatUsd(usage.totals.cost)}
        detail={
          change === undefined ? (
            "This window"
          ) : (
            <>
              <span
                {...stylex.props(
                  change.direction === "up" && styles.changeUp,
                  change.direction === "down" && styles.changeDown,
                )}
              >
                {change.label}
              </span>
              {" vs. previous"}
            </>
          )
        }
      />
      <Tile
        label={TILE_LABELS.tokens}
        value={formatTokens(usage.totals.tokens)}
        detail={`${formatPercent(cacheHitRate(usage.totals))} from cache`}
      />
      <Tile
        label={TILE_LABELS.requests}
        value={formatCount(usage.totals.turns)}
        detail={`${formatCount(usage.chats.length)} ${usage.chats.length === 1 ? "chat" : "chats"} · ${formatCount(usage.folders.length)} ${usage.folders.length === 1 ? "folder" : "folders"}`}
      />
      <Tile
        label={TILE_LABELS.busiest}
        value={topChat === undefined ? "—" : formatUsd(topChat.cost)}
        detail={topChat?.label ?? "No chats"}
        detailTitle={topChat?.label}
      />
    </div>
  );
}

/**
 * A ranked row. Every list on this page shares one denominator — the window's
 * total — so a bar means the same thing in the folders card as in the chats
 * card, and a row can be compared across cards without doing arithmetic.
 */
function ShareRow({
  label,
  qualifier,
  meta,
  value,
  share,
}: {
  readonly label: string;
  readonly qualifier?: string;
  readonly meta?: string;
  readonly value: string;
  readonly share: number;
}): ReactElement {
  return (
    <div {...stylex.props(styles.row)}>
      <span
        {...stylex.props(styles.rowTrack)}
        style={{ width: `${String(Math.max(share, 0) * 100)}%` }}
        aria-hidden="true"
      />
      <span {...stylex.props(styles.rowLabel)}>
        {label}
        {qualifier !== undefined && <span {...stylex.props(styles.rowMeta)}> in {qualifier}</span>}
      </span>
      {meta !== undefined && <span {...stylex.props(styles.rowMeta)}>{meta}</span>}
      <span {...stylex.props(styles.rowValue)}>{value}</span>
    </div>
  );
}

interface CardFace {
  readonly value: string;
  readonly detail: ReactNode;
  readonly body: ReactNode;
}

function TokenLegend({ palette }: { readonly palette: ChartPalette }): ReactElement {
  return (
    <span {...stylex.props(styles.legend)}>
      {TOKEN_KINDS.map((kind) => (
        <span key={kind} {...stylex.props(styles.legendItem)}>
          <span
            {...stylex.props(styles.legendDot)}
            style={{ backgroundColor: palette.tokens[kind] }}
            aria-hidden="true"
          />
          {TOKEN_KIND_LABELS[kind]}
        </span>
      ))}
    </span>
  );
}

/** What each card puts in its header and its body, from the one shared window. */
function cardFace(card: UsageCard, usage: UsageDerived, palette: ChartPalette): CardFace {
  const denominator = usage.totals.cost > 0 ? "API estimate" : "tokens";

  switch (card) {
    case "spend": {
      const change = costChange(usage.totals.cost, usage.previousCost);
      return {
        value: formatUsd(usage.totals.cost),
        detail:
          usage.overheadCost > 0
            ? `${change?.label ?? "This window"} · ${formatUsd(usage.overheadCost)} compaction and tools`
            : (change?.label ?? "This window"),
        body:
          usage.totals.cost === 0 ? (
            <ChartEmpty message="No priced spend" />
          ) : (
            <SpendChart points={usage.points} palette={palette} />
          ),
      };
    }
    case "tokens":
      return {
        value: formatTokens(usage.totals.tokens),
        detail: <TokenLegend palette={palette} />,
        body:
          usage.totals.tokens === 0 ? (
            <ChartEmpty message="No tokens recorded" />
          ) : (
            <TokensChart points={usage.points} palette={palette} />
          ),
      };
    case "models": {
      const leader = usage.models[0];
      const hidden = Math.max(0, usage.models.length - MODEL_BAR_LIMIT);
      return {
        value: leader?.model ?? "—",
        // The card is the empty state when there is nothing; the detail stays out of it.
        detail:
          leader === undefined
            ? ""
            : `${leader.provider} · ${formatPercent(leader.share)} of ${denominator} · ${formatCount(leader.turns)} requests${hidden > 0 ? ` · ${String(hidden)} more` : ""}`,
        body:
          usage.models.length === 0 ? (
            <ChartEmpty message="No models used" />
          ) : (
            <ModelsChart models={usage.models} palette={palette} />
          ),
      };
    }
    case "activity": {
      const busiest = usage.calendar.data.reduce<{ day: string; value: number } | undefined>(
        (found, day) => (found === undefined || day.value > found.value ? day : found),
        undefined,
      );
      return {
        value: `${formatCount(usage.calendar.data.length)} active days`,
        detail:
          busiest === undefined
            ? ""
            : `Busiest ${dayLabel(busiest.day)} · ${formatTokens(busiest.value)} tokens`,
        body:
          usage.calendar.data.length === 0 ? (
            <ChartEmpty message="No activity" />
          ) : (
            <ActivityChart calendar={usage.calendar} palette={palette} />
          ),
      };
    }
    case "folders": {
      const leader = usage.folders[0];
      return {
        value: leader?.label ?? "—",
        detail: leader === undefined ? "" : `${formatPercent(leader.share)} of ${denominator}`,
        body:
          usage.folders.length === 0 ? (
            <ChartEmpty message="No folder usage" />
          ) : (
            usage.folders.map((folder) => (
              <ShareRow
                key={folder.key}
                label={folder.label}
                qualifier={folder.qualifier}
                meta={formatTokens(folder.tokens)}
                value={formatUsd(folder.cost)}
                share={folder.share}
              />
            ))
          ),
      };
    }
    case "chats": {
      const leader = usage.chats[0];
      return {
        value: formatCount(usage.chats.length),
        detail:
          leader === undefined
            ? ""
            : `${leader.label} · ${formatPercent(leader.share)} of ${denominator}`,
        body:
          usage.chats.length === 0 ? (
            <ChartEmpty message="No chats" />
          ) : (
            usage.chats.map((chat) => (
              <ShareRow
                key={chat.sessionId}
                label={chat.label}
                meta={formatTokens(chat.tokens)}
                value={formatUsd(chat.cost)}
                share={chat.share}
              />
            ))
          ),
      };
    }
    default: {
      const _exhaustive: never = card;
      return _exhaustive;
    }
  }
}

function UsageCardView({
  card,
  usage,
  palette,
}: {
  readonly card: UsageCard;
  readonly usage: UsageDerived;
  readonly palette: ChartPalette;
}): ReactElement {
  const sortable = useSortable({ id: card });
  const face = cardFace(card, usage, palette);
  const translate = CSS.Translate.toString(sortable.transform);
  const title = CARD_TITLES[card];

  return (
    <section
      ref={sortable.setNodeRef}
      aria-label={title}
      style={{
        // A lift, not a resize: the chart inside keeps its measured geometry.
        transform: sortable.isDragging ? `${translate ?? ""} scale(1.012)`.trim() : translate,
        transition: sortable.transition,
      }}
      {...stylex.props(
        styles.card,
        sortable.isDragging && styles.cardLifted,
        sortable.isSorting && !sortable.isDragging && styles.cardSorting,
      )}
    >
      <header {...stylex.props(styles.cardHeader)}>
        <span {...stylex.props(styles.cardCopy)}>
          <span {...stylex.props(styles.cardTitle)}>{title}</span>
          <span {...stylex.props(styles.cardValue)}>{face.value}</span>
        </span>
        <button
          type="button"
          ref={sortable.setActivatorNodeRef}
          title="Drag to arrange"
          aria-label={`Reorder ${title}`}
          {...sortable.attributes}
          {...(sortable.listeners ?? {})}
          {...stylex.props(styles.handle, sortable.isDragging && styles.handleDragging, focus.ring)}
        >
          <Icon name="drag-handle" size={13} />
        </button>
      </header>
      <span {...stylex.props(styles.cardDetail)}>{face.detail}</span>
      {LIST_CARDS.includes(card) ? (
        <div {...stylex.props(styles.cardBodyList)} data-nyte-scrollport="balanced">
          {face.body}
        </div>
      ) : (
        <div {...stylex.props(styles.cardBody)}>{face.body}</div>
      )}
    </section>
  );
}

function UsageGrid({
  usage,
  palette,
}: {
  readonly usage: UsageDerived;
  readonly palette: ChartPalette;
}): ReactElement {
  const order = useUsageOrder();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event: DragEndEvent) => {
        const over = event.over;
        if (over === null || over.id === event.active.id) return;
        const current = getUsageOrder();
        const from = current.findIndex((card) => card === event.active.id);
        const to = current.findIndex((card) => card === over.id);
        if (from === -1 || to === -1) return;
        setUsageOrder(arrayMove([...current], from, to));
      }}
    >
      <SortableContext items={[...order]} strategy={rectSortingStrategy}>
        <div {...stylex.props(styles.grid)}>
          {order.map((card) => (
            <UsageCardView key={card} card={card} usage={usage} palette={palette} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function UsageState({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <div {...stylex.props(styles.state)}>
      <span {...stylex.props(styles.stateTitle)}>{title}</span>
      <p {...stylex.props(styles.stateBody)}>{body}</p>
      {action !== undefined && <span {...stylex.props(styles.stateActions)}>{action}</span>}
    </div>
  );
}

/**
 * One line above the numbers when they are not simply current: a read that
 * failed, a folder that could not be opened, or a window that has moved on
 * since the report was folded. Never a replacement for the numbers.
 */
function Notice({
  icon,
  children,
  action,
}: {
  readonly icon: "warning" | "clock";
  readonly children: ReactNode;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <div {...stylex.props(styles.notice)} role="status">
      <Icon name={icon} size={13} {...stylex.props(styles.noticeIcon)} />
      <span {...stylex.props(styles.noticeCopy)}>{children}</span>
      {action}
    </div>
  );
}

function NoticeRefresh({ onRefresh }: { readonly onRefresh: () => void }): ReactElement {
  return (
    <button type="button" onClick={onRefresh} {...stylex.props(styles.noticeAction, focus.ring)}>
      Refresh
    </button>
  );
}

function windowLabel(usage: UsageDerived): string {
  return usage.from === usage.to
    ? dayLabel(usage.to)
    : `${dayLabel(usage.from)} – ${dayLabel(usage.to)}`;
}

/** Nothing to break down: the read failed, the history is empty, or the window is. */
function EmptyUsage({
  report,
  unreadFolders,
  range,
  onShowAll,
  refresh,
}: {
  readonly report: UsageSnapshot;
  readonly unreadFolders: readonly string[];
  readonly range: UsageRange;
  readonly onShowAll: () => void;
  readonly refresh: ReactNode;
}): ReactElement {
  const earliest = report.earliestDay;
  if (report.nyteError !== null || unreadFolders.length > 0) {
    return (
      <UsageState
        title="Couldn't read all Nyte usage"
        body={report.nyteError ?? "Some folder history could not be read."}
        action={refresh}
      />
    );
  }
  if (earliest === undefined) {
    return (
      <UsageState
        title="No recorded Nyte usage"
        body="Chats you run here will show up."
        action={refresh}
      />
    );
  }
  return (
    <UsageState
      title={
        range === "all"
          ? "Nothing in this window"
          : `Nothing in the last ${USAGE_RANGE_LABELS[range].toLocaleLowerCase()}`
      }
      body={`Earliest recorded usage: ${dayLabel(earliest)}.`}
      action={
        range === "all" ? (
          refresh
        ) : (
          <Button variant="primary" onClick={onShowAll}>
            Show all time
          </Button>
        )
      }
    />
  );
}

export function UsageSettings(): ReactElement {
  // Today is pinned at open, so a report and the heading describing it name the
  // same days for as long as the panel is up, even across midnight.
  const [openedAt] = useState(() => Date.now());
  const [range, setRange] = useState<UsageRange>("30d");
  // The window is a view of the report, not a query for one. Every range shares
  // the same read, so pressing between them is arithmetic and never a load.
  const view = useMemo(() => usageWindow(range, openedAt), [range, openedAt]);

  const palette = useChartPalette();
  const order = useUsageOrder();
  const now = useClock();

  const { report, error, isFetching, refresh } = useUsageReport(view.untilDay);
  // One place to ask whether the page has numbers. Everything downstream either
  // reads them or draws the skeleton of the card that will hold them.
  const read = useMemo(
    () => (report === undefined ? undefined : { report, usage: deriveUsage(report, view) }),
    [report, view],
  );

  // The first read is not a re-read, and saying so is the page's only progress.
  const reading = read === undefined ? "Reading…" : "Refreshing…";
  const refreshButton = (
    <Button variant="secondary" disabled={isFetching} onClick={refresh}>
      {isFetching ? reading : "Refresh"}
    </Button>
  );

  if (read === undefined && error !== null) {
    return (
      <div role="alert">
        <UsageState title="Couldn't read usage" body={error.message} action={refreshButton} />
      </div>
    );
  }

  // A window with nothing in it still gets a breakdown section while it loads:
  // the cards are what the reader is waiting for.
  const hasBreakdown = read === undefined || read.report.entries.length > 0;

  return (
    <div {...stylex.props(styles.panel)}>
      {read === undefined && (
        <span role="status" {...stylex.props(srOnly)}>
          Reading local history…
        </span>
      )}
      <UsageToolsSection report={read?.report} palette={palette} />
      <section {...stylex.props(settingsPatterns.section)}>
        <div {...stylex.props(styles.toolbar)}>
          <span {...stylex.props(styles.toolbarCopy)}>
            <h2 {...stylex.props(settingsPatterns.sectionTitle)}>Nyte</h2>
            <span {...stylex.props(styles.toolbarHint)}>
              {read === undefined ? <Bone width={104} height={9} /> : windowLabel(read.usage)}
            </span>
          </span>
          <span {...stylex.props(styles.toolbarActions)}>
            {refreshButton}
            <RangeControl range={range} onRangeChange={setRange} />
          </span>
        </div>
        <p {...stylex.props(settingsPatterns.sectionDescription, styles.sectionCopy)}>
          Nyte&apos;s own chats, in the window above · API estimates, not charges
        </p>

        {read !== undefined && (
          <>
            {error !== null && (
              <div role="alert">
                <Notice icon="warning" action={<NoticeRefresh onRefresh={refresh} />}>
                  Last good read {formatTimeAgo(read.report.readAt, now)} ago. {error.message}
                </Notice>
              </div>
            )}
            {error === null && read.usage.unreadFolders.length > 0 && (
              <Notice icon="warning">
                Couldn&apos;t read {read.usage.unreadFolders.join(", ")}.{" "}
                {read.usage.unreadFolders.length === 1 ? "Its" : "Their"} spend is missing here.
              </Notice>
            )}
            {error === null && !isFetching && now - read.report.readAt > USAGE_STALE_AFTER_MS && (
              <Notice icon="clock" action={<NoticeRefresh onRefresh={refresh} />}>
                Read {formatTimeAgo(read.report.readAt, now)} ago.
              </Notice>
            )}
          </>
        )}

        {read === undefined ? (
          <UsageTilesSkeleton />
        ) : read.report.entries.length > 0 ? (
          <SummaryTiles usage={read.usage} />
        ) : (
          <EmptyUsage
            report={read.report}
            unreadFolders={read.usage.unreadFolders}
            range={range}
            onShowAll={() => setRange("all")}
            refresh={refreshButton}
          />
        )}
      </section>

      {hasBreakdown && (
        <section {...stylex.props(settingsPatterns.section)}>
          <div {...stylex.props(styles.toolbar)}>
            <span {...stylex.props(styles.toolbarCopy)}>
              <h2 {...stylex.props(settingsPatterns.sectionTitle)}>Breakdown</h2>
            </span>
            <span {...stylex.props(styles.toolbarActions)}>
              {read !== undefined && !isDefaultUsageOrder(order) && (
                <button
                  type="button"
                  {...stylex.props(styles.reset, focus.ring)}
                  onClick={() => setUsageOrder(USAGE_CARDS)}
                >
                  <Icon name="refresh" size={12} />
                  Reset layout
                </button>
              )}
            </span>
          </div>
          {read === undefined ? (
            <UsageGridSkeleton order={order} days={view} />
          ) : (
            <UsageGrid usage={read.usage} palette={palette} />
          )}
        </section>
      )}
      <LocalHistorySection tool="claudeCode" usage={read?.report.claudeCode} />
      <LocalHistorySection tool="codex" usage={read?.report.codex} />
    </div>
  );
}
