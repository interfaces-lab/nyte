/**
 * Settings › Usage before its report lands.
 *
 * Each card draws the chart it is waiting for, on that chart's own margins and
 * gridlines, so the page is laid out once and nothing moves when the numbers
 * arrive. Titles, axes, and the grid are known before the read and are drawn
 * for real; only the marks that carry numbers are bones.
 *
 * Every shape here is fixed. Bones that reshuffle on each render read as data.
 */
import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { UsageWindow } from "../nyte.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import {
  ACTIVITY_MARGIN,
  DAY_SPACING,
  MAX_TICKS,
  MODEL_BAR_LIMIT,
  MODEL_GRID_LINES,
  MODELS_MARGIN,
  SPEND_MARGIN,
  TIME_GRID_LINES,
  TOKENS_MARGIN,
  WEEKDAY_GUTTER,
  WEEKDAY_TICKS,
} from "./usage-charts.tsx";
import {
  CARD_TITLES,
  LIST_CARDS,
  TILE_LABELS,
  USAGE_TILES,
  type UsageCard,
  type UsageTile,
} from "./usage-layout.ts";
import {
  BODY_HEIGHT,
  skeletonStyles as skeleton,
  usageStyles as styles,
} from "./usage-settings.stylex.ts";
import { dayStart } from "./usage-view.ts";

export function Bone({
  width,
  height,
}: {
  readonly width: number | string;
  readonly height: number;
}): ReactElement {
  return <span aria-hidden="true" {...props(skeleton.bone)} style={{ width, height }} />;
}

const DAY_MS = 86_400_000;

/** A year of heatmap, which is what `All time` most often turns out to be. */
const UNBOUNDED_DAYS = 371;

/** Past this the bars are hairlines anyway, and the extra nodes buy nothing. */
const MAX_BARS = 60;

/** How many days the read covers. `all` has no start until the report names one. */
function windowSpan(days: UsageWindow): number {
  if (days.sinceDay === null) return UNBOUNDED_DAYS;
  return Math.round((dayStart(days.untilDay) - dayStart(days.sinceDay)) / DAY_MS) + 1;
}

/** A steady profile with no run of equal bars, so the shape reads as a chart. */
function barHeight(index: number): number {
  return 34 + ((index * 37) % 53);
}

/** Ranked bars and their labels, longest first, the way a sorted chart lands. */
const MODEL_BARS = [88, 62, 44, 30, 18];
const MODEL_LABELS = [62, 74, 55, 68, 48];

/** Ranked rows: one leader, then a tail. */
const ROW_SHARES = [86, 58, 40, 27, 16];
const ROW_LABELS = [104, 88, 122, 76, 96];

const TICK_HEIGHT = 6;
const WEEKDAY_ROWS = 7;

/** What nivo leaves a day once seven rows and their gaps have taken the height. */
const DAY_SIZE = Math.floor(
  (BODY_HEIGHT - ACTIVITY_MARGIN.top - ACTIVITY_MARGIN.bottom - DAY_SPACING * (WEEKDAY_ROWS + 1)) /
    WEEKDAY_ROWS,
);

function counter(length: number): readonly number[] {
  return Array.from({ length }, (_slot, index) => index);
}

interface ChartMargin {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * A chart body on its chart's margins: ticks down the left, ticks along the
 * bottom, and the plot in the corner they meet.
 */
function ChartFrame({
  margin,
  leftTicks,
  bottomTicks,
  children,
}: {
  readonly margin: ChartMargin;
  readonly leftTicks: ReactElement;
  readonly bottomTicks: number;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <div
      aria-hidden="true"
      {...props(skeleton.chart)}
      style={{
        gridTemplateColumns: `${String(margin.left)}px minmax(0, 1fr)`,
        gridTemplateRows: `minmax(0, 1fr) ${String(margin.bottom)}px`,
      }}
    >
      {leftTicks}
      <div
        {...props(skeleton.plotCell)}
        style={{ paddingTop: margin.top, paddingRight: margin.right }}
      >
        <div {...props(skeleton.plot)}>{children}</div>
      </div>
      <div {...props(skeleton.axisBottom)} style={{ paddingRight: margin.right }}>
        {counter(bottomTicks).map((tick) => (
          <Bone key={tick} width={24} height={TICK_HEIGHT} />
        ))}
      </div>
    </div>
  );
}

function ValueTicks(): ReactElement {
  return (
    <div {...props(skeleton.axisLeft)}>
      {counter(TIME_GRID_LINES).map((tick) => (
        <Bone key={tick} width={22} height={TICK_HEIGHT} />
      ))}
    </div>
  );
}

function GridRows(): ReactElement {
  return (
    <span {...props(skeleton.gridRows)}>
      {counter(TIME_GRID_LINES).map((line) => (
        <span key={line} {...props(skeleton.gridRow)} />
      ))}
    </span>
  );
}

/** The line's own path, reused closed to the baseline as the area beneath it. */
const SPEND_PATH =
  "M0,26 C8,24 12,14 20,15 C28,16 32,25 40,22 C48,19 52,7 62,9 C72,11 74,20 84,17 C92,15 96,9 100,11";

function SpendSkeleton(): ReactElement {
  return (
    <ChartFrame margin={SPEND_MARGIN} leftTicks={<ValueTicks />} bottomTicks={MAX_TICKS}>
      <>
        <GridRows />
        <svg viewBox="0 0 100 32" preserveAspectRatio="none" {...props(skeleton.line)}>
          <path d={`${SPEND_PATH} L100,32 L0,32 Z`} {...props(skeleton.lineArea)} />
          <path d={SPEND_PATH} vectorEffect="non-scaling-stroke" {...props(skeleton.lineStroke)} />
        </svg>
      </>
    </ChartFrame>
  );
}

function TokensSkeleton({ bars }: { readonly bars: number }): ReactElement {
  // The real chart tightens its padding once the bars get thin; so does this.
  const width = bars > 40 ? "1.4%" : "2.4%";
  return (
    <ChartFrame margin={TOKENS_MARGIN} leftTicks={<ValueTicks />} bottomTicks={MAX_TICKS}>
      <>
        <GridRows />
        <span {...props(skeleton.bars)}>
          {counter(bars).map((bar) => (
            <span
              key={bar}
              {...props(skeleton.bone, skeleton.bar)}
              style={{ width, height: `${String(barHeight(bar))}%` }}
            />
          ))}
        </span>
      </>
    </ChartFrame>
  );
}

function ModelsSkeleton(): ReactElement {
  const bands = `repeat(${String(MODEL_BAR_LIMIT)}, minmax(0, 1fr))`;
  return (
    <ChartFrame
      margin={MODELS_MARGIN}
      bottomTicks={MODEL_GRID_LINES}
      leftTicks={
        <div {...props(skeleton.axisLeftBands)} style={{ gridTemplateRows: bands }}>
          {MODEL_LABELS.map((label, index) => (
            <Bone key={index} width={label} height={TICK_HEIGHT} />
          ))}
        </div>
      }
    >
      <>
        <span {...props(skeleton.gridColumns)}>
          {counter(MODEL_GRID_LINES).map((line) => (
            <span key={line} {...props(skeleton.gridColumn)} />
          ))}
        </span>
        <span {...props(skeleton.bands)} style={{ gridTemplateRows: bands }}>
          {MODEL_BARS.map((bar, index) => (
            <span
              key={index}
              {...props(skeleton.bone, skeleton.band)}
              style={{ width: `${String(bar)}%` }}
            />
          ))}
        </span>
      </>
    </ChartFrame>
  );
}

function ActivitySkeleton({ span }: { readonly span: number }): ReactElement {
  const rows = `repeat(${String(WEEKDAY_ROWS)}, ${String(DAY_SIZE)}px)`;
  const weeks = Math.ceil(span / WEEKDAY_ROWS) + 1;

  return (
    <div
      aria-hidden="true"
      {...props(skeleton.chart)}
      style={{
        gridTemplateColumns: `${String(ACTIVITY_MARGIN.left + WEEKDAY_GUTTER)}px minmax(0, 1fr)`,
        paddingTop: ACTIVITY_MARGIN.top + DAY_SPACING,
        paddingBottom: ACTIVITY_MARGIN.bottom,
      }}
    >
      <div {...props(skeleton.weekdays)} style={{ gridTemplateRows: rows, rowGap: DAY_SPACING }}>
        {counter(WEEKDAY_ROWS).map((row) =>
          WEEKDAY_TICKS.some((tick) => tick === row) ? (
            <Bone key={row} width={20} height={TICK_HEIGHT} />
          ) : (
            <span key={row} />
          ),
        )}
      </div>
      <div
        {...props(skeleton.days)}
        style={{ gridTemplateRows: rows, gridAutoColumns: DAY_SIZE, gap: DAY_SPACING }}
      >
        {counter(weeks * WEEKDAY_ROWS).map((day) => (
          <span key={day} {...props(skeleton.day)} />
        ))}
      </div>
    </div>
  );
}

/** How many ranked rows fit a card body without the last one being a sliver. */
const LIST_ROWS = 5;

/** A ranked list, in the geometry `ShareRow` will fill. */
function RowsSkeleton({ rows }: { readonly rows: number }): ReactElement {
  return (
    <>
      {counter(rows).map((row) => (
        <span key={row} aria-hidden="true" {...props(skeleton.rowBones)}>
          <span
            {...props(styles.rowTrack)}
            style={{ width: `${String(ROW_SHARES[row] ?? 12)}%` }}
          />
          <span {...props(styles.rowLabel)}>
            <Bone width={ROW_LABELS[row] ?? 96} height={9} />
          </span>
          <Bone width={42} height={9} />
        </span>
      ))}
    </>
  );
}

function CardBodySkeleton({
  card,
  span,
}: {
  readonly card: UsageCard;
  readonly span: number;
}): ReactElement {
  switch (card) {
    case "spend":
      return <SpendSkeleton />;
    case "tokens":
      return <TokensSkeleton bars={Math.min(span, MAX_BARS)} />;
    case "models":
      return <ModelsSkeleton />;
    case "activity":
      return <ActivitySkeleton span={span} />;
    case "folders":
    case "chats":
      return <RowsSkeleton rows={LIST_ROWS} />;
    default: {
      const _exhaustive: never = card;
      return _exhaustive;
    }
  }
}

function UsageCardSkeleton({
  card,
  span,
}: {
  readonly card: UsageCard;
  readonly span: number;
}): ReactElement {
  const title = CARD_TITLES[card];
  return (
    <section aria-label={title} aria-busy="true" {...props(styles.card)}>
      <header {...props(styles.cardHeader)}>
        <span {...props(styles.cardCopy)}>
          <span {...props(styles.cardTitle)}>{title}</span>
          <span {...props(styles.cardValue)}>
            <Bone width={92} height={16} />
          </span>
        </span>
      </header>
      <span {...props(styles.cardDetail)}>
        <Bone width={132} height={9} />
      </span>
      <div {...props(LIST_CARDS.includes(card) ? styles.cardBodyList : styles.cardBody)}>
        <CardBodySkeleton card={card} span={span} />
      </div>
    </section>
  );
}

export function UsageGridSkeleton({
  order,
  days,
}: {
  readonly order: readonly UsageCard[];
  readonly days: UsageWindow;
}): ReactElement {
  const span = windowSpan(days);
  return (
    <div {...props(styles.grid)}>
      {order.map((card) => (
        <UsageCardSkeleton key={card} card={card} span={span} />
      ))}
    </div>
  );
}

const TILE_VALUES: Readonly<Record<UsageTile, number>> = {
  spend: 74,
  tokens: 62,
  requests: 48,
  busiest: 68,
};

export function UsageTilesSkeleton(): ReactElement {
  return (
    <div aria-busy="true" {...props(styles.tiles)}>
      {USAGE_TILES.map((tile) => (
        <div key={tile} {...props(styles.tile)}>
          <span {...props(styles.tileLabel)}>{TILE_LABELS[tile]}</span>
          <span {...props(styles.tileValue)}>
            <Bone width={TILE_VALUES[tile]} height={20} />
          </span>
          <span {...props(styles.tileDetail)}>
            <Bone width={110} height={9} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The Claude Code section's per-model rows, in the settings row geometry. */
export function ModelRowsSkeleton({ rows }: { readonly rows: number }): ReactElement {
  return (
    <div aria-busy="true" {...props(settingsPatterns.group)}>
      {counter(rows).map((row) => (
        <div key={row} {...props(settingsPatterns.row)}>
          <div {...props(settingsPatterns.rowCopy)}>
            <Bone width={ROW_LABELS[row] ?? 96} height={11} />
            <Bone width={132} height={9} />
          </div>
          <Bone width={78} height={11} />
        </div>
      ))}
    </div>
  );
}
