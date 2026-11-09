import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { parseArgs } from "node:util";
import { afterTool, afterUser, fakeModels, script, simulate } from "@nyte-ai/bench";
import { clearSpans, enableTracing, readSpans } from "@nyte-ai/core";
import type { Span } from "@nyte-ai/core";
import type { ModelRef } from "@nyte-ai/schema";
import { getCurrentTools } from "@nyte-ai/schema/model";
import { openCatalog, parseModel } from "./models.ts";
import { meterUsage } from "./usage.ts";

const USAGE =
  "Usage: pnpm --dir packages/nyte-bench overhead --out <dir> [--runs n] [--warmup n] [--model provider/id]... [--prompt-file path]\n";

const SCRIPTED: ModelRef = { provider: "test", id: "model" };

const args = parseArgs({
  options: {
    out: { type: "string" },
    runs: { type: "string", default: "30" },
    warmup: { type: "string", default: "3" },
    model: { type: "string", multiple: true },
    "prompt-file": { type: "string" },
  },
});

const out = args.values.out;

if (out === undefined) {
  process.stderr.write(USAGE);
  process.exit(1);
}

await mkdir(out, { recursive: true });

const folder = await realpath(out);

enableTracing({ stdout: false });

const warmup = Number(args.values.warmup);

const turns = [];

let coldOpenMs: number | null = null;

for (let index = 0; index < warmup + Number(args.values.runs); index += 1) {
  const turn = await scriptedTurn();

  coldOpenMs ??= turn.openMs;

  if (index >= warmup) turns.push(turn);
  process.stdout.write(
    `turn ${index + 1}: ${turn.turnMs.toFixed(1)} ms, harness ${turn.harnessMs.toFixed(1)} ms\n`,
  );
}

const prompt =
  args.values["prompt-file"] === undefined
    ? "Reply with the single word OK."
    : await readFile(args.values["prompt-file"], "utf8");

const refs = args.values.model?.map(parseModel) ?? [];

const prompts = [];

for (const ref of refs) prompts.push(await firstRequest(ref, prompt, folder));

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  prompt: await measurePrompt(),
  scripted: {
    runs: turns.length,
    description:
      "One turn on a scripted model that answers at once: read a small file, then reply. What remains is the harness's own time.",
    hostOpenColdMs: coldOpenMs,
    hostOpenMs: summary(turns.map((turn) => turn.openMs)),
    preModelMs: summary(turns.map((turn) => turn.preModelMs)),
    toolHopMs: summary(turns.map((turn) => turn.toolHopMs)),
    finalizeMs: summary(turns.map((turn) => turn.finalizeMs)),
    harnessMs: summary(turns.map((turn) => turn.harnessMs)),
    turnMs: summary(turns.map((turn) => turn.turnMs)),
  },
  firstRequest: {
    prompt: args.values["prompt-file"] ?? prompt,
    models: prompts,
  },
};

await writeFile(join(folder, "overhead.json"), `${JSON.stringify(report, null, 2)}\n`);

process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`);

process.exit(0);

/**
 * One turn on a scripted model: the model asks to read a file, then answers. The model and the
 * tool take next to no time, so the turn's length is the harness: admitting the message, building
 * each request, running the tool call and recording the answer.
 */
async function scriptedTurn() {
  clearSpans();

  const turnScript = script([
    {
      name: "read",
      when: afterUser,
      reply: {
        content: [
          { type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
        ],
        stopReason: "toolUse",
      },
    },
    {
      name: "answer",
      when: afterTool("read"),
      reply: { content: [{ type: "text", text: "Done." }] },
    },
  ]);

  const opening = performance.now();

  await using simulation = await simulate({
    models: fakeModels({ fallback: turnScript.answer }).models,
  });

  const openMs = performance.now() - opening;
  await writeFile(join(simulation.workspace, "README.md"), "# Bench\n");

  const started = epoch();

  const start = await simulation.host.sessions.start({
    content: "Read README.md, then say done.",
    configuration: { model: SCRIPTED },
  });

  await start.receipt.settled();
  const ended = epoch();
  const pending = turnScript.pending();

  if (pending.length > 0) throw new Error(`The scripted turn never reached ${pending.join(", ")}.`);
  const spans = readSpans().filter((span) => span.start >= started);
  const streams = spans.filter((span) => span.name === "model.stream");
  const tools = spans.filter((span) => span.name === "tool.run");
  const firstStream = streams[0];
  const lastStream = streams.at(-1);

  if (firstStream === undefined || lastStream === undefined || tools.length === 0)
    throw new Error("The turn recorded no model or tool spans; is tracing on?");

  return {
    openMs,
    turnMs: ended - started,
    preModelMs: firstStream.start - started,
    toolHopMs: hops(tools, streams),
    finalizeMs: ended - spanEnd(lastStream),
    harnessMs: ended - started - total(streams) - total(tools),
  };
}

/**
 * What a chat's first request carries before the user's words, in characters of JSON as the
 * provider receives them: the system sections and each tool's name, description and parameters,
 * largest first. Characters, not tokens, so the shape comes free from a scripted model.
 */
async function measurePrompt() {
  const fake = fakeModels({ fallback: { content: [{ type: "text", text: "OK" }] } });
  await using simulation = await simulate({ models: fake.models });

  const start = await simulation.host.sessions.start({
    content: "OK?",
    configuration: { model: SCRIPTED },
  });

  await start.receipt.settled();

  const first = fake.requests.find(
    (request) => getCurrentTools(request.context.messages).length > 0,
  );

  if (first === undefined) throw new Error("The chat sent no request with tools.");
  const system = first.context.messages.find((message) => message.role === "system");

  const tools = getCurrentTools(first.context.messages)
    .map((entry) => ({
      name: entry.name,
      chars: JSON.stringify({
        name: entry.name,
        description: entry.description,
        parameters: entry.parameters,
      }).length,
    }))
    .toSorted((a, b) => b.chars - a.chars);

  return {
    systemChars:
      system === undefined
        ? 0
        : Object.values("sections" in system ? (system.sections ?? {}) : {}).join("\n").length,
    toolChars: tools.reduce((sum, entry) => sum + entry.chars, 0),
    tools,
  };
}

/** The first chat request's input on a real model: Nyte's fixed prompt, its tool definitions and `prompt`. */
async function firstRequest(ref: ModelRef, text: string, dir: string) {
  const meter = meterUsage();
  const factory = await openCatalog([ref], dir);
  await using simulation = await simulate({ models: await factory(meter.wrap) });

  const start = await simulation.host.sessions.start({
    content: text,
    configuration: { model: ref, thinking: "off" },
  });

  await start.receipt.settled();
  const usage = await meter.total();

  return {
    model: `${ref.provider}/${ref.id}`,
    tokens: usage.first?.tokens ?? null,
    tools: usage.first?.tools ?? null,
    costUsd: usage.cost,
  };
}

/** From each tool call's end to the next model request's start. */
function hops(tools: readonly Span[], streams: readonly Span[]): number {
  const gaps = tools.flatMap((tool) => {
    const next = streams.find((stream) => stream.start >= spanEnd(tool));

    return next === undefined ? [] : [next.start - spanEnd(tool)];
  });

  return gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length);
}

function spanEnd(span: Span): number {
  return span.start + span.duration;
}

function total(spans: readonly Span[]): number {
  return spans.reduce((sum, span) => sum + span.duration, 0);
}

function epoch(): number {
  return performance.timeOrigin + performance.now();
}

function summary(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);

  return { p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9) };
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const below = sorted[Math.floor(position)] ?? 0;
  const above = sorted[Math.ceil(position)] ?? below;

  return below + (above - below) * (position - Math.floor(position));
}
