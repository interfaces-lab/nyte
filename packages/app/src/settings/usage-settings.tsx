import { Button } from "@nyte-ai/ui/button";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { Tabs } from "@nyte-ai/ui/tabs";
import { create, props } from "@stylexjs/stylex";
// oxlint-disable-next-line no-restricted-imports -- the compiler widens deriveUsage/deriveTools to every later call that reads them, so a hover or tab switch would re-derive the report
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useCatalog } from "../data/catalog.ts";
import { queryClient } from "../data/query-client.ts";
import { usageReportOptions, useUsageReport } from "../data/usage.ts";
import { useChromeTab } from "../tabs/use-chrome-tab.ts";
import { settings } from "../theme/schema.stylex.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { LimitCards } from "./usage-limits.tsx";
import { ModelColumns, TopModels } from "./usage-models.tsx";
import {
  Empty,
  Notice,
  PinnedModel,
  SectionHead,
  UsageFocusContext,
  type UsageFocus,
} from "./usage-parts.tsx";
import { usageStyles as styles } from "./usage-settings.stylex.ts";
import { SpendBone, SpendCard, UsageFigures } from "./usage-spend.tsx";
import { MODEL_DETAILS, ModelTable, ShareRows, type ModelDetail } from "./usage-tables.tsx";
import {
  defaultGrain,
  deriveTools,
  deriveUsage,
  describeEmptyRange,
  priorLabel,
  timeLabel,
  usageWindow,
  USAGE_RANGE_LABELS,
  USAGE_RANGES,
  windowLabel,
  type ListPrice,
  type UsageGrain,
  type UsageMeasure,
  type UsageRange,
} from "./usage-view.ts";

const RANGE_OPTIONS = ["30d", "7d", "90d", "all"] as const satisfies readonly UsageRange[];

const SPLITS = [
  { value: "folders", label: "Folders", noun: "folder" },
  { value: "chats", label: "Chats", noun: "chat" },
  { value: "tools", label: "Tools", noun: "tool" },
] as const;

const SPLIT_VALUES = ["folders", "chats", "tools"] as const;

const GRAINS = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
] as const satisfies readonly { readonly value: UsageGrain; readonly label: string }[];

const MEASURES = [
  { value: "cost", label: "Cost" },
  { value: "tokens", label: "Tokens" },
] as const satisfies readonly { readonly value: UsageMeasure; readonly label: string }[];

const CHARTED_MODELS = 5;

const layout = create({
  overview: { display: "flex", flexWrap: "wrap", gap: settings.cardGap },
  slot: { display: "flex", flexDirection: "column", flex: "1 1 12rem", minWidth: 0 },
  wide: { flex: "1 1 100%" },
});

export function prefetchUsage(): void {
  void queryClient.prefetchQuery(usageReportOptions(usageWindow(RANGE_OPTIONS[0], Date.now())));
}

function useUsageRange() {
  return useChromeTab("usageRange", RANGE_OPTIONS);
}

export function UsageRangePicker(): ReactElement {
  const [range, setRange] = useUsageRange();

  return (
    <Segmented
      label="Usage range"
      value={range}
      options={USAGE_RANGES.map((option) => ({ value: option, label: USAGE_RANGE_LABELS[option] }))}
      onChange={setRange}
    />
  );
}

export function UsageSettings(): ReactElement {
  const [openedAt] = useState(() => Date.now());
  const [range, setRange] = useUsageRange();
  const [split, setSplit] = useChromeTab("usage", SPLIT_VALUES);
  const [grainChoice, setGrain] = useState<UsageGrain | undefined>(undefined);
  const [measure, setMeasure] = useState<UsageMeasure>("cost");
  const [detail, setDetail] = useState<ModelDetail>("chat");
  const [hovered, setHovered] = useState<string | undefined>(undefined);
  const [pinned, setPinned] = useState<string | undefined>(undefined);
  const requested = usageWindow(range, openedAt);
  const catalog = useCatalog();

  const { read, superseded, error, isFetching, refresh } = useUsageReport(requested);

  const report = read?.report;
  const shown = read?.window ?? requested;
  const grain = grainChoice ?? defaultGrain(shown, report?.earliestDay);

  const prices = useMemo(
    () =>
      new Map<string, ListPrice>(
        catalog.data?.models.map((model) => [model.key, model.cost]) ?? [],
      ),
    [catalog.data],
  );

  const usage = useMemo(
    () =>
      read === undefined
        ? undefined
        : deriveUsage({
            report: read.report,
            window: read.window,
            grain,
            measure,
            prices,
            charted: CHARTED_MODELS,
          }),
    [read, grain, measure, prices],
  );

  const tools = useMemo(() => (report === undefined ? undefined : deriveTools(report)), [report]);

  const focus: UsageFocus = {
    active: hovered ?? pinned,
    pinned,
    names: new Map(usage?.models.map((model) => [model.key, model.model]) ?? []),
    hover: setHovered,
    toggle: (key) => setPinned((current) => (current === key ? undefined : key)),
  };

  const refreshButton = (
    <Button variant="outline" loading={isFetching} onClick={refresh}>
      Refresh Usage
    </Button>
  );

  const empty =
    report === undefined || usage === undefined || report.entries.length > 0
      ? undefined
      : describeEmptyRange(report, usage.unreadFolders, shown);

  const showDetail = MODEL_DETAILS.find((option) => option.value === detail) ?? MODEL_DETAILS[0];
  const splitOption = SPLITS.find((option) => option.value === split) ?? SPLITS[0];
  const freshness = superseded ? styles.superseded : styles.fresh;

  return (
    <UsageFocusContext value={focus}>
      <div {...props(styles.page)}>
        {(report === undefined || superseded) && (
          <span role="status" {...props(srOnly)}>
            Reading local history…
          </span>
        )}

        <div aria-busy={report === undefined || superseded} {...props(layout.overview)}>
          {report === undefined && error !== null ? (
            <div role="alert" {...props(styles.card, layout.wide)}>
              <Empty title="Couldn't read usage" body={error.message} action={refreshButton} />
            </div>
          ) : usage === undefined ? (
            <SpendBone />
          ) : empty === undefined ? (
            <div {...props(layout.slot, freshness)}>
              <SpendCard
                usage={usage}
                rangeLabel={windowLabel(shown)}
                priorLabel={priorLabel(shown)}
              />
            </div>
          ) : (
            <div {...props(styles.card, layout.wide, freshness)}>
              <Empty
                title={empty.title}
                body={empty.body}
                action={
                  empty.offerAllTime ? (
                    <Button variant="solid" tone="primary" onClick={() => setRange("all")}>
                      Show All Time
                    </Button>
                  ) : (
                    refreshButton
                  )
                }
              />
            </div>
          )}
          <LimitCards />
        </div>

        {report !== undefined && error !== null && (
          <Notice
            alert
            action={
              <Button variant="text" onClick={refresh}>
                Refresh Usage
              </Button>
            }
          >
            Showing the last good read, from {timeLabel(report.readAt)}. {error.message}
          </Notice>
        )}

        {usage !== undefined && empty === undefined && (
          <div aria-busy={superseded} {...props(styles.stack, freshness)}>
            {error === null && usage.unreadFolders.length > 0 && (
              <Notice>
                Couldn&apos;t read {usage.unreadFolders.join(", ")}.{" "}
                {usage.unreadFolders.length === 1 ? "Its" : "Their"} usage is missing from these
                totals.
              </Notice>
            )}

            <UsageFigures usage={usage} />

            <section aria-label="Models" {...props(settingsPatterns.section)}>
              <SectionHead title="Models">
                {usage.priced && (
                  <Segmented
                    label="Measure"
                    value={usage.measure}
                    options={MEASURES}
                    onChange={setMeasure}
                  />
                )}
                <Segmented label="Grain" value={grain} options={GRAINS} onChange={setGrain} />
              </SectionHead>
              <PinnedModel />
              <div {...props(styles.card)}>
                <ModelColumns usage={usage} />
              </div>
              <TopModels usage={usage} />
            </section>

            <section aria-label="Per model" {...props(settingsPatterns.section)}>
              <SectionHead title={showDetail.title}>
                <Segmented
                  label="Per model"
                  value={detail}
                  options={MODEL_DETAILS}
                  onChange={setDetail}
                />
              </SectionHead>
              <PinnedModel />
              <div {...props(styles.card)}>
                <ModelTable usage={usage} detail={detail} />
              </div>
            </section>

            <section aria-label="Where it went" {...props(settingsPatterns.section)}>
              <SectionHead title="Where it went">
                <Segmented label="Split by" value={split} options={SPLITS} onChange={setSplit} />
              </SectionHead>
              <ShareRows
                key={split}
                rows={
                  split === "folders"
                    ? usage.folders
                    : split === "chats"
                      ? usage.chatRows
                      : (tools ?? [])
                }
                noun={splitOption.noun}
              />
            </section>
          </div>
        )}

        {empty !== undefined && tools?.some((row) => row.share > 0) === true && (
          <section aria-label="Across tools" {...props(settingsPatterns.section)}>
            <SectionHead title="Across tools" />
            <ShareRows rows={tools} noun="tool" />
          </section>
        )}
      </div>
    </UsageFocusContext>
  );
}

function Segmented<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: Value;
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly onChange: (value: Value) => void;
}): ReactElement {
  return (
    <Tabs.Root
      variant="segmented"
      value={value}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);

        if (option !== undefined) onChange(option.value);
      }}
    >
      <Tabs.List aria-label={label}>
        {options.map((option) => (
          <Tabs.Tab key={option.value} value={option.value}>
            {option.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
