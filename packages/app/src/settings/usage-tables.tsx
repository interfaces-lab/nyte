import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { create, props } from "@stylexjs/stylex";
import { useId, useState } from "react";
import type { ReactElement } from "react";
import { formatPercent, formatTokens, formatUsd, formatUsdPrecise } from "../lib/format.ts";
import { settings } from "../theme/schema.stylex.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import {
  Empty,
  modelTint,
  ShareBar,
  tintScope,
  tipSurface,
  useUsageFocus,
} from "./usage-parts.tsx";
import { usageStyles } from "./usage-settings.stylex.ts";
import type { ModelUsage, ShareRow, UsageDerived } from "./usage-view.ts";

const figure = { fontVariantNumeric: "tabular-nums" } as const;

const SHOWN_ROWS = 6;

const NARROW = "@container usage (max-width: 560px)";

const styles = create({
  table: { display: "flex", flexDirection: "column", minWidth: 0 },
  grid: {
    display: "grid",
    gridTemplateColumns: {
      default: "5.5rem minmax(0, 13rem) minmax(0, 1fr) minmax(0, 1fr)",
      [NARROW]: "4.5rem minmax(0, 1fr) minmax(0, 6rem)",
    },
    alignItems: "center",
    columnGap: space.s4,
  },
  single: {
    gridTemplateColumns: {
      default: "5.5rem minmax(0, 13rem) minmax(0, 1fr)",
      [NARROW]: "4.5rem minmax(0, 1fr) minmax(0, 6rem)",
    },
  },
  head: { paddingBlockEnd: space.s2, color: role.contentTertiary },
  headCell: { minWidth: 0, overflowWrap: "anywhere" },
  headEnd: { textAlign: "end" },
  row: {
    width: "100%",
    minHeight: row.heightLg,
    paddingBlock: space.s1,
    "--_row-padding-inline": space.s2,
  },
  inner: { flex: 1, minWidth: 0 },
  rowValue: { ...figure, color: role.contentPrimary, whiteSpace: "nowrap" },
  nameCell: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    columnGap: space.s1_5,
    minWidth: 0,
  },
  rowName: { minWidth: 0, color: role.contentSecondary, overflowWrap: "anywhere" },
  rowNameLit: { color: role.contentPrimary },
  pin: { flexShrink: 0, alignSelf: "center", color: role.contentPrimary },
  flag: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s0_5,
    color: role.contentAccent,
    whiteSpace: "nowrap",
  },
  cell: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    height: "100%",
  },
  second: { display: { default: "flex", [NARROW]: "none" } },
  tip: { insetBlockStart: "50%", transform: "translateY(-50%)" },
  absent: { color: role.contentTertiary },
  cacheTrack: {
    position: "relative",
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: role.fillTertiary,
  },
  quarter: {
    position: "absolute",
    insetBlockStart: -3,
    width: 1,
    height: 10,
    backgroundColor: role.strokeTertiary,
  },
  marker: {
    position: "absolute",
    insetBlockStart: "50%",
    width: 6,
    height: 12,
    borderRadius: 1,
    transform: "translate(-50%, -50%)",
    backgroundColor: role.contentSecondary,
  },
  markerLit: { backgroundColor: role.chartSeries },
  listTick: {
    position: "absolute",
    insetBlockStart: "50%",
    width: 2,
    height: 12,
    borderRadius: 1,
    transform: "translate(-50%, -50%)",
    backgroundColor: role.contentQuaternary,
  },
  shareRow: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) minmax(0, 10rem) 5.5rem",
      [NARROW]: "minmax(0, 1fr) 5.5rem",
    },
    alignItems: "center",
    columnGap: space.s4,
    padding: settings.rowPadding,
  },
  shareName: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  shareIcon: { flexShrink: 0, color: role.contentTertiary },
  shareText: { display: "flex", flexDirection: "column", minWidth: 0 },
  shareLabel: { color: role.contentPrimary, overflowWrap: "anywhere" },
  shareMeta: { color: role.contentTertiary, overflowWrap: "anywhere" },
  shareBar: {
    display: { default: "flex", [NARROW]: "none" },
    alignItems: "center",
  },
  shareValue: { display: "flex", flexDirection: "column", alignItems: "flex-end" },
  more: { alignSelf: "flex-start", marginBlockStart: space.s1 },
  weight: { fontWeight: type.weightMedium },
});

export const MODEL_DETAILS = [
  { value: "chat", label: "Chat Cost", title: "Chat cost" },
  { value: "rate", label: "Token Rate", title: "Token rate" },
  { value: "cache", label: "Cache", title: "Cache" },
] as const;

export type ModelDetail = (typeof MODEL_DETAILS)[number]["value"];

export function ModelTable({
  usage,
  detail,
}: {
  readonly usage: UsageDerived;
  readonly detail: ModelDetail;
}): ReactElement {
  if (detail === "chat") return <ChatCost usage={usage} />;

  if (detail === "rate") return <TokenRate usage={usage} />;

  return <CacheHit usage={usage} />;
}

function ChatCost({ usage }: { readonly usage: UsageDerived }): ReactElement {
  const priced = usage.priced;

  const models = usage.models.toSorted((left, right) =>
    priced ? left.perChat.cost - right.perChat.cost : left.perChat.tokens - right.perChat.tokens,
  );

  const maxCost = Math.max(...models.map((model) => model.perChat.cost), 0);
  const maxTokens = Math.max(...models.map((model) => model.perChat.tokens), 0);

  return (
    <div role="list" aria-label="Average per chat, by model" {...props(styles.table)}>
      <Head
        single={!priced}
        labels={priced ? ["Cost per chat", "Tokens per chat"] : ["Tokens per chat"]}
      />
      {models.map((model) => (
        <ModelRow
          key={model.key}
          model={model}
          single={!priced}
          value={priced ? formatUsdPrecise(model.perChat.cost) : formatTokens(model.perChat.tokens)}
          measure={priced ? "per chat" : "tokens per chat"}
          cells={
            priced
              ? [
                  { share: maxCost === 0 ? 0 : model.perChat.cost / maxCost },
                  { share: maxTokens === 0 ? 0 : model.perChat.tokens / maxTokens },
                ]
              : [{ share: maxTokens === 0 ? 0 : model.perChat.tokens / maxTokens }]
          }
          details={[
            ...(priced ? [["Cost per chat", formatUsdPrecise(model.perChat.cost)] as const] : []),
            ["Tokens per chat", formatTokens(model.perChat.tokens)],
            ["Chats", String(model.chats)],
          ]}
        />
      ))}
    </div>
  );
}

function TokenRate({ usage }: { readonly usage: UsageDerived }): ReactElement {
  if (!usage.priced) {
    return (
      <Empty
        title="No prices for these models"
        body="Nyte prices usage from the model catalog. These models don't list a price, so only their tokens count."
      />
    );
  }

  const models = usage.models.toSorted((left, right) => (left.rate ?? 0) - (right.rate ?? 0));

  const scale = Math.max(
    ...models.map((model) => Math.max(model.rate ?? 0, model.list?.input ?? 0)),
    0,
  );

  return (
    <div role="list" aria-label="Effective price per 1M tokens, by model" {...props(styles.table)}>
      <Head single labels={["Per 1M tokens, with the list input price marked"]} />
      {models.map((model) => (
        <ModelRow
          key={model.key}
          model={model}
          single
          value={
            model.rate === undefined
              ? model.list === undefined
                ? "No price"
                : "Free"
              : formatUsdPrecise(model.rate)
          }
          measure={model.rate === undefined ? "" : "per 1M tokens"}
          absent={model.rate === undefined}
          cells={[
            {
              share: scale === 0 ? 0 : (model.rate ?? 0) / scale,
              mark: model.list === undefined || scale === 0 ? undefined : model.list.input / scale,
            },
          ]}
          details={[
            ["Effective", model.rate === undefined ? "—" : formatUsdPrecise(model.rate)],
            ...(model.list === undefined
              ? []
              : ([
                  ["List input", formatUsdPrecise(model.list.input)],
                  ["List output", formatUsdPrecise(model.list.output)],
                  ["Cache read", formatUsdPrecise(model.list.cacheRead)],
                ] as const)),
          ]}
        />
      ))}
    </div>
  );
}

function CacheHit({ usage }: { readonly usage: UsageDerived }): ReactElement {
  const models = usage.models.toSorted(
    (left, right) => (right.cache.ratio ?? -1) - (left.cache.ratio ?? -1),
  );

  return (
    <div role="list" aria-label="Cache hit rate, by model" {...props(styles.table)}>
      <Head single labels={["0–100%"]} end />
      {models.map((model) => (
        <ModelRow
          key={model.key}
          model={model}
          single
          value={model.cache.ratio === undefined ? "—" : formatPercent(model.cache.ratio)}
          measure="cache hit"
          warn={model.cache.low}
          absent={model.cache.ratio === undefined}
          cells={[{ cache: model.cache.ratio ?? 0, warn: model.cache.low }]}
          details={[
            ["Cache hit", model.cache.ratio === undefined ? "—" : formatPercent(model.cache.ratio)],
            ["Cached", formatTokens(model.cache.cached)],
            ["Uncached", formatTokens(model.cache.uncached)],
            ...(usage.priced ? [["Saved", formatUsd(model.cache.saved)] as const] : []),
          ]}
        />
      ))}
    </div>
  );
}

function Head({
  labels,
  single = false,
  end = false,
}: {
  readonly labels: readonly string[];
  readonly single?: boolean;
  readonly end?: boolean;
}): ReactElement {
  return (
    <div aria-hidden="true" {...props(text.xs, styles.grid, single && styles.single, styles.head)}>
      <span />
      <span {...props(styles.headCell)}>Model</span>
      {labels.map((label, index) => (
        <span
          key={label}
          {...props(styles.headCell, index === 1 && styles.second, end && styles.headEnd)}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

type Cell =
  | { readonly share: number; readonly mark?: number | undefined }
  | { readonly cache: number; readonly warn: boolean };

function ModelRow({
  model,
  value,
  measure,
  cells,
  details,
  single,
  warn = false,
  absent = false,
}: {
  readonly model: ModelUsage;
  readonly value: string;
  readonly measure: string;
  readonly cells: readonly Cell[];
  readonly details: readonly (readonly [string, string])[];
  readonly single: boolean;
  readonly warn?: boolean;
  readonly absent?: boolean;
}): ReactElement {
  const focus = useUsageFocus();
  const [shown, setShown] = useState(false);
  const describedBy = useId();
  const tint = modelTint(focus, model.key);
  const lit = tint !== undefined;
  const pinned = focus.pinned === model.key;
  const first = cells[0];
  const anchor = first === undefined ? 0 : "share" in first ? first.share : first.cache;
  const spoken = [value, measure].filter((part) => part !== "").join(" ");

  return (
    <div role="listitem">
      <Row
        variant="nav"
        selected={pinned}
        aria-pressed={pinned}
        aria-label={`${model.model}, ${spoken}${warn ? ", low" : ""}`}
        aria-describedby={describedBy}
        onPointerEnter={() => {
          setShown(true);
          focus.hover(model.key);
        }}
        onPointerLeave={() => {
          setShown(false);
          focus.hover(undefined);
        }}
        onFocus={() => {
          setShown(true);
          focus.hover(model.key);
        }}
        onBlur={() => {
          setShown(false);
          focus.hover(undefined);
        }}
        onClick={() => focus.toggle(model.key)}
        xstyle={styles.row}
      >
        <span {...props(styles.grid, single && styles.single, styles.inner)}>
          <span
            {...props(
              text.base,
              styles.rowValue,
              warn && intent.warning,
              warn && usageStyles.accent,
              !warn && tintScope(tint),
              !warn && lit && usageStyles.accent,
              absent && styles.absent,
            )}
          >
            {value}
          </span>
          <span {...props(styles.nameCell)}>
            {pinned && <Icon name="pin" size="xs" {...props(styles.pin)} />}
            <span {...props(text.base, styles.rowName, lit && styles.rowNameLit)}>
              {model.model}
            </span>
            {warn && (
              <span {...props(text.xs, intent.warning, styles.flag)}>
                <Icon name="warning" size="xs" />
                Low
              </span>
            )}
          </span>
          {cells.map((cell, index) => (
            <span key={index} {...props(styles.cell, index === 1 && styles.second)}>
              {"share" in cell ? (
                <>
                  <ShareBar share={cell.share} tint={tint} />
                  {cell.mark !== undefined && (
                    <span
                      aria-hidden="true"
                      {...props(styles.listTick)}
                      style={{ left: `${String(Math.min(cell.mark, 1) * 100)}%` }}
                    />
                  )}
                </>
              ) : (
                <CacheTrack
                  ratio={cell.cache}
                  tint={cell.warn ? undefined : tint}
                  warn={cell.warn}
                />
              )}
              {index === 0 && shown && <RowTip rows={details} at={anchor} />}
            </span>
          ))}
        </span>
        <span id={describedBy} {...props(srOnly)}>
          {details.map(([label, detail]) => `${label} ${detail}`).join(", ")}
        </span>
      </Row>
    </div>
  );
}

function CacheTrack({
  ratio,
  tint,
  warn,
}: {
  readonly ratio: number;
  readonly tint: ReturnType<typeof modelTint>;
  readonly warn: boolean;
}): ReactElement {
  return (
    <span aria-hidden="true" {...props(styles.cacheTrack)}>
      {[0.25, 0.5, 0.75].map((quarter) => (
        <span
          key={quarter}
          {...props(styles.quarter)}
          style={{ left: `${String(quarter * 100)}%` }}
        />
      ))}
      <span
        {...props(
          warn ? intent.warning : tintScope(tint),
          styles.marker,
          (warn || tint !== undefined) && styles.markerLit,
        )}
        style={{ left: `clamp(3px, ${String(ratio * 100)}%, calc(100% - 3px))` }}
      />
    </span>
  );
}

function RowTip({
  rows,
  at,
}: {
  readonly rows: readonly (readonly [string, string])[];
  readonly at: number;
}): ReactElement {
  return (
    <span
      aria-hidden="true"
      {...props(text.xs, tipSurface, styles.tip)}
      style={
        at < 0.6
          ? { left: `calc(${String(at * 100)}% + 12px)` }
          : { right: `calc(${String((1 - at) * 100)}% + 12px)` }
      }
    >
      {rows.map(([label, value]) => (
        <span key={label} {...props(usageStyles.tipRow)}>
          <span>{label}</span>
          <span {...props(usageStyles.value, styles.weight)}>{value}</span>
        </span>
      ))}
    </span>
  );
}

export function ShareRows({
  rows,
  noun,
}: {
  readonly rows: readonly ShareRow[];
  readonly noun: string;
}): ReactElement {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOWN_ROWS);

  return (
    <div {...props(styles.table)}>
      <div role="table" aria-label={`Spend by ${noun}`} {...props(settingsPatterns.group)}>
        {shown.map((item) => (
          <div key={item.key} role="row" {...props(settingsPatterns.rowRule, styles.shareRow)}>
            <span role="cell" {...props(styles.shareName)}>
              {item.icon !== undefined && (
                <Icon name={item.icon} size="sm" {...props(styles.shareIcon)} />
              )}
              <span {...props(styles.shareText)}>
                <span {...props(text.base, styles.shareLabel)}>{item.label}</span>
                <span {...props(text.sm, styles.shareMeta)}>{item.meta}</span>
              </span>
            </span>
            <span role="cell" {...props(styles.shareBar)}>
              <ShareBar share={item.share} tint={undefined} />
            </span>
            <span role="cell" {...props(styles.shareValue)}>
              <span {...props(text.base, usageStyles.value, item.absent && styles.absent)}>
                {item.value}
              </span>
              {!item.absent && (
                <span {...props(text.sm, usageStyles.quiet)}>{formatPercent(item.share)}</span>
              )}
            </span>
          </div>
        ))}
      </div>
      {rows.length > SHOWN_ROWS && (
        <Button
          variant="text"
          size="sm"
          xstyle={styles.more}
          onClick={() => setAll((open) => !open)}
        >
          {all ? "Show Fewer" : `Show All ${String(rows.length)}`}
        </Button>
      )}
    </div>
  );
}
