import { Badge, Grid, LineChart, Section, Stack, Stat, Table, Text, Tracker } from "nyte/canvas";
import type { Standing } from "./log.ts";

type Run = Standing["runs"][number];

const TONES = {
  keep: "success",
  discard: "neutral",
  crash: "danger",
  checks_failed: "warning",
} as const satisfies Record<Run["status"], "success" | "neutral" | "danger" | "warning">;

const LABELS = {
  keep: "kept",
  discard: "discarded",
  crash: "crashed",
  checks_failed: "checks failed",
} as const satisfies Record<Run["status"], string>;

const RECENT = 8;

export default function Dashboard(props: { readonly state: Standing }) {
  const state = props.state;
  const config = state.config;
  const unit = config.unit === "" ? "" : ` ${config.unit}`;
  const measure = (value: number | null) => (value === null ? "–" : `${value}${unit}`);

  const change =
    state.baseline === null || state.best === null || state.baseline === 0
      ? undefined
      : `${(((state.best - state.baseline) / Math.abs(state.baseline)) * 100).toFixed(1)}%`;

  const measured = state.runs.flatMap((run) =>
    run.metric === null ? [] : [{ x: run.run, y: run.metric }],
  );

  const keptPoints = state.runs.flatMap((run) =>
    run.status === "keep" && run.metric !== null ? [{ x: run.run, y: run.metric }] : [],
  );

  const best = keptPoints.filter((point, index) =>
    keptPoints
      .slice(0, index)
      .every((earlier) =>
        config.direction === "lower" ? point.y < earlier.y : point.y > earlier.y,
      ),
  );

  return (
    <Section
      title={config.name}
      description={`${config.metric}${config.unit === "" ? "" : ` (${config.unit})`}, ${config.direction} is better. ${state.runs.length} runs, ${keptPoints.length} kept.`}
    >
      <Stack gap={4}>
        <Grid columns={4} minWidth={140}>
          <Stat label="Baseline" value={measure(state.baseline)} />
          <Stat
            label="Best"
            value={measure(state.best)}
            delta={change}
            invert={config.direction === "lower"}
          />
          <Stat label="Kept" value={`${keptPoints.length} of ${state.runs.length}`} />
          <Stat
            label="Confidence"
            value={state.confidence === null ? "–" : `${state.confidence.toFixed(1)}x`}
            detail={state.confidence === null ? "after 3 runs" : "the noise"}
            tone={confidenceTone(state.confidence)}
          />
        </Grid>
        {measured.length > 1 && (
          <LineChart
            height={180}
            series={[
              { id: "Every run", data: measured, tint: "gray" },
              { id: "Best kept", data: best, tint: "green" },
            ]}
            yFormat={(value) => `${value}${unit}`}
          />
        )}
        <Tracker
          label="Runs"
          data={state.runs.map((run) => ({
            tone: TONES[run.status],
            label: `#${run.run} ${run.description}`,
          }))}
        />
        <Table
          columns={[
            { key: "run", label: "#", align: "end" },
            { key: "status", label: "Status" },
            { key: "metric", label: config.metric, align: "end" },
            { key: "description", label: "Change" },
          ]}
          rows={state.runs
            .slice(-RECENT)
            .toReversed()
            .map((run) => ({
              run: <Text mono>{run.run}</Text>,
              status: <Badge tone={TONES[run.status]}>{LABELS[run.status]}</Badge>,
              metric: <Text mono>{measure(run.metric)}</Text>,
              description: <Text truncate>{run.description}</Text>,
            }))}
        />
      </Stack>
    </Section>
  );
}

function confidenceTone(confidence: number | null): "neutral" | "success" | "warning" | "danger" {
  if (confidence === null) return "neutral";

  if (confidence >= 2) return "success";

  return confidence >= 1 ? "warning" : "danger";
}
