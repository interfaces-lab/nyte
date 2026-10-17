import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { buildWaterfall, ciRepo, formatWaterfall } from "@nyte-ai/host/bench";
import type { CiRepo, SpanSource, Waterfall, WaterfallRow } from "@nyte-ai/host/bench";
import { SPAN_NAMES } from "@nyte-ai/sdk";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Span, SpanDetail } from "@nyte-ai/sdk";

const run = promisify(execFile);

/** Runs git in `cwd` and answers what it printed. */
export async function git(cwd: string, ...args: readonly string[]): Promise<string> {
  return (await run("git", [...args], { cwd })).stdout;
}

/**
 * Scenario D's repo under `parent` (`ciRepo`), its branch pushed to a bare
 * `origin.git` beside it, as a pull request's branch tracks its remote, so the
 * commit bar can commit and push.
 */
export async function pushedCiRepo(parent: string): Promise<CiRepo> {
  const repo = await ciRepo(parent);
  const origin = join(parent, "origin.git");
  await git(parent, "init", "--quiet", "--bare", origin);
  await git(repo.root, "remote", "add", "origin", origin);
  await git(repo.root, "push", "--quiet", "--set-upstream", "origin", "fix-sum");

  return repo;
}

/**
 * Scenario D's per-hop budgets in milliseconds, for the longest span of each
 * hop. A hop is a span name, or a name and the tool or part kind it served
 * (`tool.run:bash`); the narrower key wins. Measured on an M4 Pro with the
 * scripted model pacing 30 ms to first token and 2 ms per delta, each budget
 * is several times its measurement, so a miss is a regression, not noise.
 */
export const HOP_BUDGETS: ReadonlyMap<string, number> = new Map([
  ["composer.submit", 250],
  ["sdk.send", 250],
  ["host.admit", 100],
  ["turn.start", 150],
  ["model.stream", 1_000],
  ["skill.load", 50],
  ["mcp.connect", 1_500],
  ["mcp.call:list_check_runs", 250],
  ["mcp.call:get_job_logs", 500],
  ["mcp.serve", 250],
  ["tool.run", 500],
  ["tool.run:mcp__ci__get_job_logs", 750],
  ["tool.run:bash", 2_000],
  ["canvas.compile", 100],
  ["canvas.paint", 1_500],
  ["pty.spawn", 250],
  ["pty.output", 1_000],
  ["part.publish", 50],
  ["client.paint", 400],
]);

/** How long the expanded tool row of the 5 MiB job log may take from its keystroke to the frame that shows it. */
export const LOG_ROW_BUDGET_MS = 100;

/** One hop of a waterfall against its budget. */
export interface HopRow {
  readonly hop: string;
  readonly process: string;
  readonly count: number;
  readonly max: number;
  readonly total: number;
  readonly budget: number | null;
}

/** Focuses `target` as Tab would, checks it took focus, and presses `key` on it. */
export async function press(target: Locator, key = "Enter"): Promise<void> {
  await expect(async () => {
    await target.focus();
    await expect(target).toBeFocused({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await target.page().keyboard.press(key);
}

/** Presses `button` from the keyboard for as long as it is shown, as a "Scroll to bottom" control that may leave on its own. */
export async function pressUntilGone(button: Locator): Promise<void> {
  await expect(async () => {
    if ((await button.count()) > 0) {
      await button.focus({ timeout: 1_000 });
      await button.page().keyboard.press("Enter");
    }

    await expect(button).toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

const ScalarSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);

const MeasureSchema = Type.Object({
  name: Type.String(),
  start: Type.Number(),
  duration: Type.Number(),
  detail: Type.Union([Type.Record(Type.String(), ScalarSchema), Type.Null()]),
});

/** The trace spans this page's renderer recorded (tracing on through localStorage `NYTE_TRACE`). */
export async function readRendererSpans(page: Page): Promise<readonly Span[]> {
  const entries = await page.evaluate(() =>
    performance.getEntriesByType("measure").map((entry) =>
      JSON.stringify({
        name: entry.name,
        start: performance.timeOrigin + entry.startTime,
        duration: entry.duration,
        detail: "detail" in entry ? entry.detail : null,
      }),
    ),
  );

  return entries.flatMap((json): Span[] => {
    const entry = Value.Parse(MeasureSchema, JSON.parse(json));
    const name = SPAN_NAMES.find((candidate) => candidate === entry.name);

    if (name === undefined) return [];
    const { trace = null, ...detail } = entry.detail ?? {};

    return [
      {
        name,
        trace: Value.Check(Type.String(), trace) ? trace : null,
        start: entry.start,
        duration: entry.duration,
        detail,
      },
    ];
  });
}

/** The trace `composer.submit` started for the page's last message: its receipt id. */
export function submitTrace(spans: readonly Span[]): string {
  const trace = spans.findLast((span) => span.name === "composer.submit")?.trace;

  if (trace === null || trace === undefined)
    throw new Error("No composer.submit span was recorded.");

  return trace;
}

function hopName(row: WaterfallRow): string {
  const served = row.detail.tool ?? row.detail.kind ?? null;

  return served === null ? row.name : `${row.name}:${String(served)}`;
}

function budgetFor(hop: string): number | null {
  return HOP_BUDGETS.get(hop) ?? HOP_BUDGETS.get(hop.split(":")[0] ?? "") ?? null;
}

/** Folds `waterfall` into one row per hop and process: how often it ran, its longest and total time, and its budget. */
export function hopTable(waterfall: Waterfall): readonly HopRow[] {
  const rows = new Map<string, HopRow>();

  for (const row of waterfall.rows) {
    const hop = hopName(row);
    const key = `${hop}\u0000${row.process}`;
    const seen = rows.get(key);

    rows.set(key, {
      hop,
      process: row.process,
      count: (seen?.count ?? 0) + 1,
      max: Math.max(seen?.max ?? 0, row.duration),
      total: Math.round(((seen?.total ?? 0) + row.duration) * 100) / 100,
      budget: budgetFor(hop),
    });
  }

  return [...rows.values()];
}

/** Draws `table` as a Markdown table. */
export function formatHopTable(table: readonly HopRow[]): string {
  return [
    "| hop | process | count | max ms | total ms | budget ms | within |",
    "|---|---|---|---|---|---|---|",
    ...table.map(
      (row) =>
        `| ${row.hop} | ${row.process} | ${String(row.count)} | ${row.max.toFixed(1)} | ${row.total.toFixed(1)} | ${row.budget === null ? "-" : String(row.budget)} | ${row.budget === null ? "-" : row.max <= row.budget ? "yes" : "NO"} |`,
    ),
  ].join("\n");
}

/** Budgeted hops a run may lack: `mcp.connect` carries no trace and shows only when the link connects inside the run. */
const UNTRACED: ReadonlySet<string> = new Set(["mcp.connect"]);

/** Expects every budgeted hop in `table` within its budget, naming the ones over it and the ones it lacks. */
export function expectWithinBudgets(table: readonly HopRow[]): void {
  const missing = [...HOP_BUDGETS.keys()].flatMap((key) =>
    UNTRACED.has(key) || table.some((row) => row.hop === key || row.hop.startsWith(`${key}:`))
      ? []
      : [`${key} missing`],
  );

  const over = table.flatMap((row) =>
    row.budget !== null && row.max > row.budget
      ? [`${row.hop} [${row.process}] ${row.max.toFixed(1)} ms > ${String(row.budget)} ms`]
      : [],
  );

  expect([...missing, ...over], "hops missing or over budget").toEqual([]);
}

/** Scenario D's waterfall of `trace` across `sources`, with its hop table. */
export function scenarioWaterfall(trace: string, sources: readonly SpanSource[]) {
  const waterfall = buildWaterfall(trace, sources);

  return { waterfall, hops: hopTable(waterfall) };
}

/**
 * Writes a run's proof under `NYTE_WATERFALL_DIR` when it is set: `<name>.json`
 * with `facts`, the waterfall and the hop table, and `<name>.md` with the drawn
 * waterfall and the hop table.
 */
export async function saveProof(
  name: string,
  input: {
    readonly waterfall: Waterfall;
    readonly hops: readonly HopRow[];
    readonly facts: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  const directory = process.env.NYTE_WATERFALL_DIR;

  if (directory === undefined || directory === "") return;
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${name}.json`),
    `${JSON.stringify({ ...input.facts, hops: input.hops, ...input.waterfall }, null, 2)}\n`,
  );
  await writeFile(
    join(directory, `${name}.md`),
    `# ${name}\n\n\`\`\`json\n${JSON.stringify(input.facts, null, 2)}\n\`\`\`\n\n## Hops\n\n${formatHopTable(input.hops)}\n\n## Waterfall\n\n\`\`\`\n${formatWaterfall(input.waterfall)}\n\`\`\`\n`,
  );
}

/**
 * Presses `key` on `trigger` and returns the milliseconds from its keydown to
 * the first animation frame holding an element labelled `label` whose text
 * includes `text`, as the startup bench times a keystroke to its paint.
 */
export async function timeKeyToFrame(
  trigger: Locator,
  shown: { readonly label: string; readonly text: string },
  key = "Enter",
): Promise<number> {
  const page = trigger.page();
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.evaluate(() => {
    delete document.documentElement.dataset.nyteKeyAt;
    delete document.documentElement.dataset.nyteShownAt;
    addEventListener(
      "keydown",
      (event) => {
        document.documentElement.dataset.nyteKeyAt = String(event.timeStamp);
      },
      { capture: true, once: true },
    );
  });
  await page.keyboard.press(key);

  const painted = await page.waitForFunction(
    ({ label, text }) => {
      const found = [...document.querySelectorAll("[aria-label]")].some(
        (element) =>
          element.getAttribute("aria-label") === label &&
          (element.textContent ?? "").includes(text),
      );

      if (found) document.documentElement.dataset.nyteShownAt = String(performance.now());

      return found;
    },
    shown,
    { polling: "raf" },
  );

  await painted.dispose();

  return page.evaluate(
    () =>
      Number(document.documentElement.dataset.nyteShownAt) -
      Number(document.documentElement.dataset.nyteKeyAt),
  );
}

/**
 * Counts the pixels of two same-size PNG screenshots that differ by more than
 * `tolerance` (0-255) in any channel, decoding them in `page`; -1 when their
 * sizes differ. Font antialiasing can move a channel by a few levels between
 * two paints of the same frame, which a byte compare would call a change.
 */
export async function countChangedPixels(
  page: Page,
  before: Buffer,
  after: Buffer,
  tolerance = 8,
): Promise<number> {
  return page.evaluate(
    async ({ images, limit }) => {
      const decoded = await Promise.all(
        images.map(async (base64) => {
          const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext("2d");

          if (context === null) throw new Error("No 2D context to decode a screenshot.");
          context.drawImage(bitmap, 0, 0);

          return context.getImageData(0, 0, bitmap.width, bitmap.height);
        }),
      );

      const [first, second] = decoded;

      if (
        first === undefined ||
        second === undefined ||
        first.width !== second.width ||
        first.height !== second.height
      )
        return -1;
      let changed = 0;

      for (let index = 0; index < first.data.length; index += 4) {
        for (let channel = 0; channel < 4; channel += 1) {
          if (
            Math.abs((first.data[index + channel] ?? 0) - (second.data[index + channel] ?? 0)) >
            limit
          ) {
            changed += 1;
            break;
          }
        }
      }

      return changed;
    },
    { images: [before.toString("base64"), after.toString("base64")], limit: tolerance },
  );
}

/** Lists `detail` without its session id, for a proof file. */
export function plainDetail(detail: SpanDetail): SpanDetail {
  return Object.fromEntries(Object.entries(detail).filter(([key]) => key !== "session"));
}
