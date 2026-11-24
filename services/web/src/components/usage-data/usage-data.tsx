import { Tabs } from "@nyte-ai/ui/tabs";
import { motion, role } from "@nyte-ai/ui/styles/vars.stylex";
import { create, keyframes, props } from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { UsageStats } from "~/lib/usage-stats";

type Measure = "tokens" | "installs" | "active";

interface Layer {
  key: string;
  name: string;
}

interface Column {
  day: string;
  values: readonly number[];
  total: number;
}

interface Plot {
  layers: readonly Layer[];
  columns: readonly Column[];
}

interface ShareRow {
  key: string;
  name: string;
  detail?: string;
  value: number;
}

const MEASURES = [
  { value: "tokens", label: "Tokens" },
  { value: "installs", label: "Installs" },
  { value: "active", label: "Active installs" },
] as const satisfies readonly { value: Measure; label: string }[];

const CHARTED_PROVIDERS = 4;

const providerNames = new Map([
  ["anthropic", "Anthropic"],
  ["openai", "OpenAI API"],
  ["openai-codex", "ChatGPT"],
  ["opencode", "OpenCode Zen"],
  ["opencode-go", "OpenCode Go"],
  ["github-copilot", "GitHub Copilot"],
  ["vercel-ai-gateway", "Vercel AI Gateway"],
  ["openrouter", "OpenRouter"],
  ["other", "Other"],
]);

const clientNames = new Map([
  ["desktop", "Desktop app"],
  ["tui", "Terminal"],
]);

const systemNames = new Map([
  ["darwin", "macOS"],
  ["linux", "Linux"],
  ["win32", "Windows"],
]);

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const updatedFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const rise = keyframes({ from: { transform: "scaleY(0)" } });

const chart = create({
  column: {
    backgroundImage: `radial-gradient(circle, ${role.strokeTertiary} 0.75px, transparent 1px)`,
    backgroundPosition: "center bottom",
    backgroundSize: "100% 8px",
    transformOrigin: "bottom",
    animationName: { default: rise, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "520ms",
    animationTimingFunction: motion.easeOut,
    animationFillMode: "both",
    outlineStyle: "dashed",
    outlineWidth: 1,
    outlineOffset: 2,
    outlineColor: "transparent",
  },
  columnActive: { outlineColor: role.strokeSecondary },
  layer: {
    backgroundColor: role.contentTertiary,
    transitionProperty: "height, background-color",
    transitionDuration: { default: "240ms", "@media (prefers-reduced-motion: reduce)": "0s" },
    transitionTimingFunction: motion.easeOut,
  },
  layerQuiet: { backgroundColor: role.contentQuaternary },
  layerLit: { backgroundColor: role.chartSeries },
  stub: { backgroundColor: role.fillPrimary },
  average: { borderBlockStartColor: role.strokeSecondary },
  track: { backgroundColor: role.fillTertiary },
  fill: {
    backgroundColor: role.contentSecondary,
    transformOrigin: "left center",
    transitionProperty: "background-color",
    transitionDuration: { default: "160ms", "@media (prefers-reduced-motion: reduce)": "0s" },
  },
  fillLit: { backgroundColor: role.chartSeries },
});

export function UsageData({ stats }: { stats: UsageStats | null }) {
  return (
    <main className="mx-auto w-full max-w-(--site-inner) px-(--site-pad) pt-10 pb-24">
      <header className="flex max-w-160 flex-col gap-2">
        <h1 className="text-lg font-medium">Nyte by the numbers</h1>
        <p className="text-base text-muted-foreground">
          Anonymous counts from Nyte installs, added up with no IDs attached.{" "}
          <Link
            to="/docs/$"
            params={{ _splat: "usage-data" }}
            className="text-foreground underline underline-offset-4"
          >
            See what Nyte sends
          </Link>
        </p>
      </header>

      {stats === null ? <Unreachable /> : <Numbers stats={stats} />}
    </main>
  );
}

function Numbers({ stats }: { stats: UsageStats }) {
  const hasTokens = stats.tokens.some((row) => row.tokens > 0);
  const [measure, setMeasure] = useState<Measure>(hasTokens ? "tokens" : "installs");
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [lit, setLit] = useState<string | undefined>(undefined);
  const today = stats.updated.slice(0, 10);
  const plot = buildPlot(stats, measure, today);
  const total = sum(plot.columns.map((column) => column.total));
  const last = plot.columns.length - 1;
  const pointed = cursor === undefined ? undefined : plot.columns[cursor];
  const top = Math.max(...plot.columns.map((column) => column.total), 1);
  const average = total / Math.max(plot.columns.length, 1);
  const shown = pointed === undefined ? plot.columns : [pointed];
  const providers = shareRows(
    stats.providers.map((row) => ({
      key: row.provider,
      name: providerName(row.provider),
      value: row.input + row.output,
    })),
  );

  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = cursor ?? last;

    const next =
      event.key === "ArrowLeft"
        ? Math.max(current - 1, 0)
        : event.key === "ArrowRight"
          ? Math.min(current + 1, last)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : undefined;

    if (next === undefined) return;
    event.preventDefault();
    setCursor(next);
  };

  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor(((event.clientX - box.left) / box.width) * plot.columns.length);

    setCursor(Math.min(Math.max(index, 0), last));
  };

  return (
    <>
      <section aria-label="Daily counts" className="mt-14">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <p
            aria-live="polite"
            className="min-h-[2lh] font-pixel text-[clamp(2rem,1.4rem+2.4vw,3.5rem)] leading-[1.08] tracking-[-0.01em] sm:min-h-[1lh]"
          >
            {readout(measure, shown, pointed?.day)}
          </p>
          <Tabs.Root
            variant="segmented"
            value={measure}
            onValueChange={(next) => {
              const option = MEASURES.find((candidate) => candidate.value === next);

              if (option === undefined) return;
              setMeasure(option.value);
              setLit(undefined);
            }}
          >
            <Tabs.List aria-label="Show">
              {MEASURES.map((option) => (
                <Tabs.Tab key={option.value} value={option.value}>
                  {option.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.Root>
        </div>

        <p className="mt-3 min-h-[1lh] max-w-160 text-base text-muted-foreground tabular-nums">
          {total === 0 ? emptyNote(measure) : breakdown(plot.layers, shown)}
        </p>

        <div
          role="group"
          aria-roledescription="chart"
          aria-label={`${MEASURES.find((option) => option.value === measure)?.label ?? ""} per day. Use the arrow keys to read each day.`}
          tabIndex={0}
          onKeyDown={step}
          onFocus={() => setCursor((current) => current ?? last)}
          onBlur={() => setCursor(undefined)}
          onPointerMove={point}
          onPointerLeave={() => setCursor(undefined)}
          className="relative mt-8 flex h-56 touch-pan-y items-end gap-[3px] rounded-[2px] outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring sm:h-72"
        >
          {total > 0 ? (
            <span
              aria-hidden="true"
              {...mix(
                "pointer-events-none absolute inset-x-0 z-1 border-t border-dashed",
                { bottom: `${String((average / top) * 100)}%` },
                props(chart.average),
              )}
            />
          ) : null}
          {plot.columns.map((column, index) => (
            <div
              key={column.day}
              aria-hidden="true"
              {...mix(
                "flex h-full min-w-0 flex-1 flex-col-reverse gap-px",
                { animationDelay: `${String(index * 14)}ms` },
                props(chart.column, index === cursor && chart.columnActive),
              )}
            >
              {column.total === 0 ? (
                <span {...mix("block h-0.5 shrink-0", undefined, props(chart.stub))} />
              ) : (
                plot.layers.map((layer, layerIndex) => (
                  <span
                    key={layer.key}
                    {...mix(
                      "block shrink-0",
                      { height: `${String(((column.values[layerIndex] ?? 0) / top) * 100)}%` },
                      props(
                        chart.layer,
                        layer.key === "other" && chart.layerQuiet,
                        layer.key === lit && chart.layerLit,
                      ),
                    )}
                  />
                ))
              )}
            </div>
          ))}
        </div>
        <div
          aria-hidden="true"
          className="mt-2 flex justify-between text-sm text-tertiary-foreground tabular-nums"
        >
          <span>{formatDay(plot.columns[0]?.day ?? today)}</span>
          {average >= 1 ? (
            <span>{compact.format(Math.round(average))} a day on average</span>
          ) : null}
          <span>{formatDay(plot.columns[last]?.day ?? today)}</span>
        </div>
      </section>

      <div className="mt-20 grid gap-x-16 gap-y-14 md:grid-cols-2">
        <Shares
          title="Providers"
          rows={providers}
          unit="tokens"
          lit={measure === "tokens" ? lit : undefined}
          onLight={measure === "tokens" ? setLit : undefined}
        />
        <Shares
          title="Models"
          rows={shareRows(
            stats.models.map((row) => ({
              key: `${row.provider}/${row.model}`,
              name: row.model,
              detail: providerName(row.provider),
              value: row.input + row.output,
            })),
          )}
          unit="tokens"
        />
      </div>

      <div className="mt-14 grid gap-x-16 gap-y-14 md:grid-cols-3">
        <Shares
          title="Versions"
          rows={shareRows(
            stats.versions.map((row) => ({
              key: row.version,
              name: row.version,
              value: row.count,
            })),
          )}
          unit="installs and updates"
        />
        <Shares
          title="Systems"
          rows={shareRows(
            stats.platforms.map((row) => ({
              key: `${row.os}/${row.arch}`,
              name: systemName(row.os, row.arch),
              value: row.count,
            })),
          )}
          unit="installs and updates"
        />
        <Shares
          title="Apps"
          rows={shareRows(
            stats.clients.map((row) => ({
              key: row.client,
              name: clientNames.get(row.client) ?? row.client,
              value: row.count,
            })),
          )}
          unit="installs and updates"
        />
      </div>

      <p className="mt-20 max-w-160 text-sm text-tertiary-foreground">
        Token and active counts come only from installs with Share usage statistics turned on. Each
        day&rsquo;s totals arrive the next day. Updated{" "}
        <time dateTime={stats.updated}>{updatedFormat.format(new Date(stats.updated))}</time>.
      </p>
    </>
  );
}

function Shares({
  title,
  rows,
  unit,
  lit,
  onLight,
}: {
  title: string;
  rows: readonly (ShareRow & { share: number })[];
  unit: string;
  lit?: string;
  onLight?: (key: string | undefined) => void;
}) {
  return (
    <section aria-label={title} className="min-w-0">
      <h2 className="text-base font-medium">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-tertiary-foreground">Nothing counted yet.</p>
      ) : (
        <ol className="mt-3 flex flex-col">
          {rows.map((row) => (
            <li
              key={row.key}
              onPointerEnter={onLight === undefined ? undefined : () => onLight(row.key)}
              onPointerLeave={onLight === undefined ? undefined : () => onLight(undefined)}
              className="grid grid-cols-[minmax(0,3fr)_minmax(2.5rem,2fr)_3rem] items-center gap-x-4 py-2 text-sm"
            >
              <span className="truncate">
                {row.name}
                {row.detail === undefined ? null : (
                  <span className="text-tertiary-foreground"> {row.detail}</span>
                )}
              </span>
              <span
                aria-hidden="true"
                {...mix(
                  "relative block h-1 overflow-clip rounded-[2px]",
                  undefined,
                  props(chart.track),
                )}
              >
                <span
                  {...mix(
                    "absolute inset-0",
                    { transform: `scaleX(${String(row.share)})` },
                    props(chart.fill, row.key === lit && chart.fillLit),
                  )}
                />
              </span>
              <span className="text-end text-muted-foreground tabular-nums">
                {percent.format(row.share)}
                <span className="sr-only">
                  {", "}
                  {compact.format(row.value)} {unit}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Unreachable() {
  return (
    <section className="mt-14 flex max-w-160 flex-col gap-2">
      <p className="font-pixel text-[clamp(2rem,1.4rem+2.4vw,3.5rem)] leading-[1.08]">
        The counts didn&rsquo;t load
      </p>
      <p className="text-base text-muted-foreground">
        The counting server didn&rsquo;t answer. Reload the page in a few minutes.
      </p>
    </section>
  );
}

function buildPlot(stats: UsageStats, measure: Measure, today: string): Plot {
  if (measure === "installs") {
    return {
      layers: [
        { key: "installs", name: "Installs" },
        { key: "updates", name: "Updates" },
      ],
      columns: daysEnding(today, stats.days).map((day) => {
        const row = stats.installs.find((entry) => entry.day === day);

        return column(day, [row?.installs ?? 0, row?.updates ?? 0]);
      }),
    };
  }

  const yesterday = shiftDay(today, -1);

  if (measure === "active") {
    return {
      layers: [{ key: "active", name: "Active installs" }],
      columns: daysEnding(yesterday, stats.days).map((day) =>
        column(day, [stats.active.find((entry) => entry.day === day)?.count ?? 0]),
      ),
    };
  }

  const ranked = [...new Set(stats.tokens.map((row) => row.provider))]
    .filter((provider) => provider !== "other")
    .map((provider) => ({
      provider,
      total: sum(stats.tokens.filter((row) => row.provider === provider).map((row) => row.tokens)),
    }))
    .toSorted((left, right) => right.total - left.total);

  const charted = ranked.slice(0, CHARTED_PROVIDERS).map((entry) => entry.provider);
  const hasOther = stats.tokens.some((row) => !charted.includes(row.provider));

  const layers = [
    ...charted.map((provider) => ({ key: provider, name: providerName(provider) })),
    ...(hasOther ? [{ key: "other", name: "Other" }] : []),
  ];

  return {
    layers,
    columns: daysEnding(yesterday, stats.days).map((day) => {
      const rows = stats.tokens.filter((row) => row.day === day);

      return column(
        day,
        layers.map((layer) =>
          sum(
            rows
              .filter((row) =>
                layer.key === "other"
                  ? !charted.includes(row.provider)
                  : row.provider === layer.key,
              )
              .map((row) => row.tokens),
          ),
        ),
      );
    }),
  };
}

function readout(measure: Measure, columns: readonly Column[], day: string | undefined) {
  const when = day === undefined ? `in ${String(columns.length)} days` : `on ${formatDay(day)}`;
  const total = sum(columns.map((entry) => entry.total));

  if (measure === "tokens") {
    return total === 0 && day === undefined
      ? "No tokens counted yet"
      : `${compact.format(total)} tokens ${when}`;
  }

  if (measure === "installs") {
    const installs = sum(columns.map((entry) => entry.values[0] ?? 0));
    const updates = sum(columns.map((entry) => entry.values[1] ?? 0));

    return total === 0 && day === undefined
      ? "No installs counted yet"
      : `${counted(installs, "install")}, ${counted(updates, "update")} ${when}`;
  }

  if (day !== undefined) return `${counted(total, "install")} shared usage ${when}`;

  return total === 0
    ? "No usage shared yet"
    : `${counted(Math.round(total / columns.length), "install")} share usage a day`;
}

function breakdown(layers: readonly Layer[], columns: readonly Column[]) {
  const total = sum(columns.map((entry) => entry.total));

  if (total === 0 || layers.length < 2) return "";

  const parts = layers.flatMap((layer, index) => {
    const share = sum(columns.map((entry) => entry.values[index] ?? 0)) / total;

    return share > 0 ? [`${layer.name} ${percent.format(share)}`] : [];
  });

  return parts.length > 1 ? parts.join(", ") : "";
}

function emptyNote(measure: Measure) {
  return measure === "installs"
    ? "Counting starts with Nyte’s next release."
    : "To add yours, turn on Share usage statistics in Settings › General › Privacy.";
}

function shareRows(rows: readonly ShareRow[]) {
  const total = sum(rows.map((row) => row.value));

  return rows
    .filter((row) => row.value > 0)
    .toSorted((left, right) => right.value - left.value)
    .map((row) => ({ ...row, share: row.value / Math.max(total, 1) }));
}

function column(day: string, values: readonly number[]): Column {
  return { day, values, total: sum(values) };
}

function daysEnding(end: string, count: number) {
  return Array.from({ length: count }, (_, index) => shiftDay(end, index - count + 1));
}

function shiftDay(day: string, offset: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

function providerName(provider: string) {
  return providerNames.get(provider) ?? provider;
}

function systemName(os: string, arch: string) {
  const system = systemNames.get(os) ?? os;

  if (os === "darwin") return `${system}, ${arch === "arm64" ? "Apple silicon" : "Intel"}`;

  return `${system}, ${arch === "x64" ? "x64" : arch === "arm64" ? "Arm" : arch}`;
}

function mix(
  className: string,
  style: CSSProperties | undefined,
  styled: ReturnType<typeof props>,
) {
  return {
    className: `${className} ${styled.className ?? ""}`,
    style: { ...styled.style, ...style },
  };
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function counted(value: number, noun: string) {
  return `${compact.format(value)} ${noun}${value === 1 ? "" : "s"}`;
}

function formatDay(day: string) {
  return dayFormat.format(new Date(`${day}T00:00:00Z`));
}
