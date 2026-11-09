import { Link } from "@tanstack/react-router";
import {
  capabilityGroups,
  deepsweRuns,
  nyteOverhead,
  nyteTasks,
  promptSizes,
  suiteScores,
} from "~/lib/benchmarks";
import type { CapabilityCell } from "~/lib/benchmarks";
import { splitHref } from "~/lib/href";

const percent = (value: number) => `${Math.round(value * 100)}%`;

const minutes = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;

const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const TICKS = [0, 0.25, 0.5, 0.75, 1];

const LABELLED_TICKS = [0, 0.5, 1];

function Gridlines() {
  return TICKS.map((tick) => (
    <line
      key={tick}
      className="bench-grid"
      x1={percent(tick)}
      x2={percent(tick)}
      y1="0"
      y2="100%"
    />
  ));
}

/** DeepSWE resolve rates with their 95% intervals, Nyte's run beside eve's published one. */
export function HarnessBenchmark() {
  return (
    <figure className="bench">
      <div className="bench-plot" role="list">
        {deepsweRuns.map((run) => (
          <div key={run.label} className="bench-group" role="listitem">
            <div className="bench-group-head">
              <a href={run.source}>{run.label}</a>
              <span>
                {run.tasks} · {run.model} · {date(run.measuredAt)}
              </span>
            </div>
            {[...run.harnesses]
              .sort((a, b) => b.resolveRate.estimate - a.resolveRate.estimate)
              .map((score) => (
                <div
                  key={score.harness}
                  className="bench-row"
                  data-ours={run.ours || undefined}
                  aria-label={`${score.harness}: ${score.resolved} of ${score.attempts} resolved, 95% interval ${percent(score.resolveRate.low)} to ${percent(score.resolveRate.high)}`}
                >
                  <span className="bench-name">{score.harness}</span>
                  <svg className="bench-track" aria-hidden>
                    <Gridlines />
                    <line
                      className="bench-whisker"
                      x1={percent(score.resolveRate.low)}
                      x2={percent(score.resolveRate.high)}
                      y1="50%"
                      y2="50%"
                    />
                    <circle
                      className="bench-dot"
                      cx={percent(score.resolveRate.estimate)}
                      cy="50%"
                      r="5"
                    />
                  </svg>
                  <span className="bench-count">
                    {score.resolved}/{score.attempts}
                  </span>
                </div>
              ))}
          </div>
        ))}
        <div className="bench-axis" aria-hidden>
          <span />
          <svg className="bench-ticks">
            {LABELLED_TICKS.map((tick) => (
              <text
                key={tick}
                x={percent(tick)}
                y="14"
                textAnchor={tick === 0 ? "start" : tick === 1 ? "end" : "middle"}
              >
                {percent(tick)}
              </text>
            ))}
          </svg>
          <span />
        </div>
      </div>

      <div className="doc-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Harness</th>
              <th>Resolved</th>
              <th>95% interval</th>
              <th>Median time</th>
              <th>p90 time</th>
              <th>Cost per resolve</th>
              <th>Input tokens</th>
              <th>Cached</th>
            </tr>
          </thead>
          <tbody>
            {deepsweRuns.flatMap((run) =>
              run.harnesses.map((score) => (
                <tr key={`${run.label}-${score.harness}`}>
                  <td>
                    {score.runUrl === null ? (
                      score.harness
                    ) : (
                      <a href={score.runUrl}>{score.harness}</a>
                    )}
                    {score.version === null ? null : (
                      <span className="bench-version"> {score.version}</span>
                    )}
                  </td>
                  <td>
                    {score.resolved}/{score.attempts}
                  </td>
                  <td>
                    {percent(score.resolveRate.low)}–{percent(score.resolveRate.high)}
                  </td>
                  <td>{minutes(score.latencyP50Ms)}</td>
                  <td>{minutes(score.latencyP90Ms)}</td>
                  <td>
                    {score.costPerResolvedUsd === null
                      ? "–"
                      : `$${score.costPerResolvedUsd.toFixed(2)}`}
                  </td>
                  <td>{`${(score.inputTokens / 1_000_000).toFixed(1)}M`}</td>
                  <td>{score.cachedShare === null ? "–" : percent(score.cachedShare)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      <div className="bench-tasks" aria-label="Nyte's attempts by task">
        {nyteTasks.map((task) => (
          <div key={task.task} className="bench-task">
            <span className="bench-cells">
              {Array.from({ length: task.attempts }, (_, index) => (
                <span
                  key={index}
                  className="bench-cell"
                  data-resolved={index < task.resolved || undefined}
                />
              ))}
            </span>
            <span className="bench-task-name">{task.task}</span>
            <span className="bench-version">{task.language}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

const milliseconds = (ms: number) => (ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`);

const thousands = (chars: number) => `${(chars / 1000).toFixed(1)}K`;

const modelName = (model: string) => model.slice(model.indexOf("/") + 1);

/** The figures a reader should take away, each read from the measured data below it. */
export function BenchmarkHighlights() {
  const nyte = promptSizes.harnesses.find((entry) => entry.ours);

  const smallest = Math.min(
    ...promptSizes.harnesses.filter((entry) => !entry.ours).map((entry) => entry.total),
  );

  return (
    <div className="bench-highlights">
      <div className="bench-highlight">
        <strong>{milliseconds(nyteOverhead.harnessMs.p50)}</strong>
        <span>of harness time in a turn with a tool call</span>
      </div>
      {nyte === undefined ? null : (
        <div className="bench-highlight">
          <strong>{(smallest / nyte.total).toFixed(1)}×</strong>
          <span>smaller fixed prompt than Claude Code or Codex</span>
        </div>
      )}
      <div className="bench-highlight">
        <strong>8</strong>
        <span>model providers built in, 3 with subscription sign-in</span>
      </div>
      <div className="bench-highlight">
        <strong>177</strong>
        <span>typed host operations in the SDK</span>
      </div>
    </div>
  );
}

/** Each harness's fixed prompt, tool definitions then system text, to one scale. */
export function PromptSize() {
  const longest = Math.max(...promptSizes.harnesses.map((entry) => entry.total));

  return (
    <figure className="bench">
      <div className="bench-plot bench-compare">
        {promptSizes.harnesses.map((entry) => (
          <div
            key={entry.harness}
            className="bench-stage"
            data-ours={entry.ours || undefined}
            aria-label={`${entry.harness}: ${thousands(entry.total)} characters, ${entry.tools} tools`}
          >
            <span className="bench-stage-label">
              {entry.harness} <span className="bench-version">{entry.tools} tools</span>
            </span>
            <svg className="bench-track" aria-hidden>
              <rect
                className="bench-bar-p90"
                x="0"
                y="8"
                height="12"
                width={percent(entry.total / longest)}
                rx="2"
              />
              <rect
                className="bench-bar"
                x="0"
                y="8"
                height="12"
                width={percent(entry.toolChars / longest)}
                rx="2"
              />
            </svg>
            <span className="bench-count">{thousands(entry.total)}</span>
          </div>
        ))}
      </div>
      <figcaption>
        Characters sent before your first word: tool definitions (solid) and system text (lighter).
        Claude Code and Codex are from the turns <a href={promptSizes.source}>T3 Code captured</a>,
        without T3 Code's own tools and instructions. On a real model, Nyte's first request is{" "}
        {promptSizes.firstRequest
          .map(
            (entry) =>
              `${entry.tokens === null ? "–" : entry.tokens.toLocaleString("en-US")} tokens on ${modelName(entry.model)}`,
          )
          .join(" and ")}
        .
      </figcaption>
    </figure>
  );
}

/** Nyte Bench pass counts per behaviour, one column per model. */
export function SuiteScores() {
  return (
    <div className="doc-table-scroll">
      <table>
        <thead>
          <tr>
            <th>What Nyte Bench checks</th>
            {suiteScores.models.map((model) => (
              <th key={model}>{modelName(model)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {suiteScores.rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              {row.cells.map((cell, index) => (
                <td key={suiteScores.models[index]} className="bench-score">
                  <svg className="bench-score-bar" aria-hidden>
                    <rect className="bench-bar-p90" x="0" y="0" height="100%" width="100%" rx="2" />
                    <rect
                      className="bench-bar"
                      x="0"
                      y="0"
                      height="100%"
                      width={percent(cell.graded === 0 ? 0 : cell.passed / cell.graded)}
                      rx="2"
                    />
                  </svg>
                  {cell.passed}/{cell.graded}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const OVERHEAD_STAGES = [
  { label: "Open a host", value: nyteOverhead.hostOpenMs },
  { label: "Message to first model request", value: nyteOverhead.preModelMs },
  { label: "Tool result to next request", value: nyteOverhead.toolHopMs },
  { label: "Last answer to settled", value: nyteOverhead.finalizeMs },
  { label: "Harness time per turn", value: nyteOverhead.harnessMs },
];

/** Nyte's own time at each stage of a turn, with the model and the tool taken out. */
export function HarnessOverhead() {
  const longest = Math.max(...OVERHEAD_STAGES.map((stage) => stage.value.p90));

  return (
    <figure className="bench">
      <div className="bench-plot">
        <div className="bench-group-head">
          <strong>Nyte</strong>
          <span>
            {nyteOverhead.runs} turns · {nyteOverhead.machine} · {date(nyteOverhead.measuredAt)}
          </span>
        </div>
        {OVERHEAD_STAGES.map((stage) => (
          <div
            key={stage.label}
            className="bench-stage"
            aria-label={`${stage.label}: median ${milliseconds(stage.value.p50)}, p90 ${milliseconds(stage.value.p90)}`}
          >
            <span className="bench-stage-label">{stage.label}</span>
            <svg className="bench-track" aria-hidden>
              <rect
                className="bench-bar-p90"
                x="0"
                y="8"
                height="12"
                width={percent(stage.value.p90 / longest)}
                rx="2"
              />
              <rect
                className="bench-bar"
                x="0"
                y="8"
                height="12"
                width={percent(stage.value.p50 / longest)}
                rx="2"
              />
            </svg>
            <span className="bench-count">{milliseconds(stage.value.p50)}</span>
          </div>
        ))}
      </div>
      <figcaption>
        Medians, with the p90 as the lighter bar. The scripted model answers at once and the tool
        reads a one-line file, so the time left is Nyte's.
      </figcaption>
    </figure>
  );
}

function CapabilityLink({ cell }: { readonly cell: CapabilityCell }) {
  if (cell.href === null) return <span className="bench-version">{cell.text}</span>;

  if (cell.href.startsWith("/")) return <Link {...splitHref(cell.href)}>{cell.text}</Link>;

  return (
    <a href={cell.href} rel="noreferrer" target="_blank">
      {cell.text}
    </a>
  );
}

/** What each product offers, every cell linked to the page that shows it. */
export function HarnessCapabilities() {
  return (
    <div className="bench">
      {capabilityGroups.map((group) => (
        <div key={group.title} className="doc-table-scroll">
          <table className="bench-capabilities">
            <thead>
              <tr>
                <th>{group.title}</th>
                <th>Nyte</th>
                <th>eve</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td data-ours>
                    <CapabilityLink cell={row.nyte} />
                  </td>
                  <td>
                    <CapabilityLink cell={row.eve} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
