import { expect, test } from "vitest";
import type { PartStatus, ToolPartState } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { ToolMessage, ToolWord } from "@nyte-ai/plugin/client/presentation";
import { basename, fileUrl, toolFacts } from "./tool-facts.ts";
import type { ToolCardKind } from "./tool-facts.ts";

const RUN = asId<"run">("run");

const CALL = {
  call: asId<"call">("c"),
  name: "shell",
  args: null,
  class: { kind: "shell", command: "ls" },
} as const;

const RUNNING: ToolPartState = { ...CALL, phase: "running", progress: { text: "progress" } };

type Outcome = Extract<ToolPartState, { readonly phase: "settled" }>["outcome"];

function settled(outcome: Outcome): ToolPartState {
  return { ...CALL, phase: "settled", outcome, changes: null };
}

const OK = settled({
  kind: "ok",
  content: [{ kind: "text", text: "out" }],
  output: null,
  parts: [],
});

const LIVE: PartStatus = { kind: "live", run: RUN };

const SETTLED: PartStatus = { kind: "settled", commit: asId<"commit">("c"), endedAt: 2500 };

function failed(failure: "provider" | "aborted"): PartStatus {
  return { kind: "failed", run: RUN, failure: { class: failure, message: "x" } };
}

function message(state: ToolPartState, status: PartStatus): ToolMessage {
  return {
    id: asId<"message">("m"),
    turn: asId<"turn">("t"),
    at: 1000,
    kind: "part",
    part: asId<"part">("m"),
    partKind: "tool",
    role: "step",
    version: 1,
    state,
    status,
  };
}

const VERBS = { running: "Running", past: "Ran" };

type Policy = "settled" | "while running" | "while unsettled";

const POLICY_COLUMN = { settled: 0, "while running": 1, "while unsettled": 2 } as const;

const CARDS: readonly (readonly [ToolCardKind, Policy])[] = [
  ["edit", "settled"],
  ["mcp", "settled"],
  ["script", "settled"],
  ["browser", "settled"],
  ["web", "settled"],
  ["secret", "settled"],
  ["shell", "while running"],
  ["line", "while running"],
  ["subagent", "while unsettled"],
];

test.each<
  [
    state: string,
    message: ToolMessage,
    whole: ToolPartState,
    word: ToolWord | undefined,
    running: boolean,
    verb: string | undefined,
    durationMs: number | undefined,
    outputs: readonly [settled: string, whileRunning: string, whileUnsettled: string],
  ]
>([
  [
    "running",
    message(RUNNING, LIVE),
    RUNNING,
    undefined,
    true,
    "Running",
    undefined,
    ["", "progress", "progress"],
  ],
  [
    "waiting on input",
    message(RUNNING, { kind: "waiting", run: RUN, on: { kind: "part", part: asId<"part">("q") } }),
    RUNNING,
    "Needs input",
    true,
    "Running",
    undefined,
    ["", "progress", "progress"],
  ],
  ["settled ok", message(OK, SETTLED), OK, undefined, false, "Ran", 1500, ["out", "out", "out"]],
  [
    "settled failed",
    message(settled({ kind: "failed", message: "boom" }), SETTLED),
    settled({ kind: "failed", message: "boom" }),
    "Failed",
    false,
    undefined,
    1500,
    ["boom", "boom", "boom"],
  ],
  [
    "settled rejected",
    message(settled({ kind: "rejected", reason: "denied" }), SETTLED),
    settled({ kind: "rejected", reason: "denied" }),
    "Blocked",
    false,
    undefined,
    1500,
    ["denied", "denied", "denied"],
  ],
  [
    "settled stopped",
    message(settled({ kind: "stopped" }), SETTLED),
    settled({ kind: "stopped" }),
    "Stopped",
    false,
    undefined,
    1500,
    ["", "", ""],
  ],
  [
    "settled interrupted",
    message(settled({ kind: "interrupted" }), SETTLED),
    settled({ kind: "interrupted" }),
    "Interrupted",
    false,
    undefined,
    1500,
    ["", "", ""],
  ],
  [
    "failed while running: only the subagent keeps its last progress",
    message(RUNNING, failed("provider")),
    RUNNING,
    "Interrupted",
    false,
    undefined,
    undefined,
    ["", "", "progress"],
  ],
  [
    "aborted: only the subagent keeps its last progress",
    message(RUNNING, failed("aborted")),
    RUNNING,
    "Stopped",
    false,
    undefined,
    undefined,
    ["", "", "progress"],
  ],
  [
    "the whole part settled before the message: running lines show nothing yet",
    message(RUNNING, LIVE),
    OK,
    undefined,
    true,
    "Running",
    undefined,
    ["out", "", "out"],
  ],
])("%s", (_, input, whole, word, running, verb, durationMs, outputs) => {
  const facts = CARDS.map(([card]) => toolFacts(input, whole, VERBS, card));

  expect(facts.map((fact) => fact.output)).toEqual(
    CARDS.map(([, policy]) => outputs[POLICY_COLUMN[policy]]),
  );

  for (const fact of facts) {
    expect({ ...fact, output: undefined }).toEqual({
      status: expect.objectContaining({ word }),
      running,
      output: undefined,
      durationMs,
      verb,
    });
  }

  expect(toolFacts(input, whole, undefined, "edit").verb).toBeUndefined();
});

test.each<[string, string | undefined, string | undefined]>([
  ["/repo/src/a b.ts", undefined, "file:///repo/src/a%20b.ts"],
  ["src/a.ts", "/repo", "file:///repo/src/a.ts"],
  ["src/a.ts", undefined, undefined],
])("%s in %s opens %s", (path, cwd, url) => {
  expect(fileUrl(path, cwd)).toBe(url);
});

test.each([
  ["src/a.ts", "a.ts"],
  [String.raw`C:\repo\b.ts`, "b.ts"],
  ["c.ts", "c.ts"],
])("%s is named %s", (path, name) => {
  expect(basename(path)).toBe(name);
});
