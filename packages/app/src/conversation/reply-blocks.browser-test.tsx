import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Execution, Message } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { queryClient } from "../data/query-client.ts";
import { installConnection } from "../data/connection.ts";
import { scriptedConnection } from "../../test/scripted-connection.ts";
import { SubagentCitation } from "./subagent-call.tsx";
import { SubagentSessionsProvider } from "./subagent-sessions.ts";
import { transcriptRows } from "./transcript-rows.ts";
import { TurnItemView } from "./turn-view.tsx";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import {
  COMPLETED,
  endedTurn,
  listedChildren,
  sessionRow,
  settledTool,
} from "../../test/view-fixtures.ts";

const HOUR = 3_600_000;

/** Past the minute the clock floors to, so the age reads a whole 4 hours. */
const SENT = Date.now() - 4 * HOUR - 60_000;

const CODE = "const answer = 42;";

const LIVE: Execution = {
  kind: "live",
  run: {
    id: asId<"run">("child-run"),
    head: asId<"head">("main"),
    startedAt: 0,
    attempt: 1,
    origin: { kind: "input", message: asId<"message">("child-prompt") },
  },
  phase: "responding",
  stopping: false,
};

function reply(id: string, turn: string, at: number, markdown: string): Message {
  return {
    id: asId<"message">(id),
    turn: asId<"turn">(turn),
    at,
    kind: "part",
    part: asId<"part">(id),
    partKind: "text",
    role: "answer",
    state: { markdown, signature: null },
    version: 1,
    status: { kind: "settled", commit: asId<"commit">(id), endedAt: at },
  };
}

function work(id: string, turn: string, at: number, endedAt: number): Message {
  return {
    ...settledTool(id, { kind: "read", path: `/w/${id}.ts` }),
    turn: asId<"turn">(turn),
    at,
    status: { kind: "settled", commit: asId<"commit">(id), endedAt },
  };
}

const rows = transcriptRows({
  loading: false,
  failed: false,
  turns: [
    endedTurn(
      [work("r1", "t1", SENT - 2_000, SENT - 1_000), reply("a1", "t1", SENT, "First answer")],
      {
        id: asId<"turn">("t1"),
        startedAt: SENT - 2_500,
      },
    ),
    endedTurn(
      [
        work("r2", "t2", SENT + 1_000, SENT + 4_000),
        reply("a2", "t2", SENT + 3_000, `Second answer\n\n\`\`\`ts\n${CODE}\n\`\`\``),
      ],
      { id: asId<"turn">("t2"), startedAt: SENT },
    ),
  ],
  changes: [],
  prompts: [],
  running: false,
  held: false,
  retrying: undefined,
}).filter((row) => row.kind === "response");

const working = sessionRow("working", { name: "Map the core", parent: asId("parent") }, LIVE);

const finished = sessionRow("finished", { name: "Map the app", parent: asId("parent") }, COMPLETED);

installConnection(scriptedConnection({ sessions: [working, finished] }).connection);

function Stage(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delay={0} closeDelay={0} timeout={0}>
        <SubagentSessionsProvider
          value={{ children: listedChildren([working, finished]), open: () => undefined }}
        >
          {rows.map((row) => (
            <div key={row.key} data-row={row.key}>
              <TurnItemView row={row} running={false} density="compact" cwd={undefined} />
            </div>
          ))}
          <p>
            <SubagentCitation session={working.id} label="core" />{" "}
            <SubagentCitation session={finished.id} label="app" />
          </p>
        </SubagentSessionsProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function settled(element: Element): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await Promise.all(element.getAnimations().map((animation) => animation.finished));
}

function find<T extends Element>(scope: ParentNode, selector: string, type: new () => T): T {
  const element = scope.querySelector(selector);

  if (!(element instanceof type)) throw new Error(`Missing ${selector}`);

  return element;
}

function opacity(element: Element): number {
  return Number(getComputedStyle(element).opacity);
}

export async function run(): Promise<string> {
  const failures: string[] = [];

  const check = (condition: boolean, message: string): void => {
    if (!condition) failures.push(message);
  };

  const stage = document.createElement("div");
  stage.style.cssText = "width:640px;padding:24px;";
  document.body.append(stage);
  const root = createRoot(stage);
  flushSync(() => root.render(<Stage />));
  await wait(50);

  const first = find(stage, "[data-row='response:a1']", HTMLElement);
  const second = find(stage, "[data-row='response:a2']", HTMLElement);
  const text = (row: HTMLElement) => row.textContent ?? "";

  check(text(first).startsWith("Worked for 3s"), `the first turn's work line reads ${text(first)}`);
  check(
    text(second).startsWith("Worked for 4s"),
    `the second turn's work line reads ${text(second)}`,
  );
  check(
    stage.querySelectorAll("[aria-label='Copy reply']").length === 2,
    "each finished reply has one copy control",
  );

  const firstTime = find(first, "time", HTMLElement);
  const secondTime = find(second, "time", HTMLElement);
  check(
    firstTime.textContent ===
      "4h agoMessage sent " +
        new Date(SENT).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    `the reply's time reads ${firstTime.textContent ?? ""}`,
  );
  await settled(secondTime);
  check(opacity(secondTime) === 1, "the latest reply's time is always shown");
  check(opacity(firstTime) === 0, "an earlier reply's time waits for hover or focus");

  const copy = find(first, "[aria-label='Copy reply']", HTMLButtonElement);
  copy.focus();
  await settled(firstTime);
  check(opacity(firstTime) === 1, "focusing an earlier reply's actions shows its time");

  copy.click();
  await wait(100);
  check(copy.hasAttribute("data-copied"), "copying a reply confirms it");
  check((await navigator.clipboard.readText()) === "First answer", "the reply copies its own text");
  await navigator.clipboard.writeText("untouched");
  copy.click();
  await wait(100);
  check(
    (await navigator.clipboard.readText()) === "untouched",
    "a click during the confirmation copies nothing",
  );

  const code = find(second, "[aria-label='Copy ts code block']", HTMLButtonElement);
  code.click();
  await wait(100);
  check(code.hasAttribute("data-copied"), "copying code confirms it");
  check((await navigator.clipboard.readText()) === CODE, "the code block copies its code");

  await wait(2_000);
  check(!copy.hasAttribute("data-copied"), "the reply's confirmation resets after 2 s");
  check(!code.hasAttribute("data-copied"), "the code block's confirmation resets after 2 s");

  const [busy, idle] = stage.querySelectorAll("a[data-citation='agent']");
  check(
    busy !== undefined && busy.getAnimations({ subtree: true }).length > 0,
    "a working subagent's link shows an animated glyph",
  );
  check(
    idle !== undefined && idle.getAnimations({ subtree: true }).length === 0,
    "a finished subagent's link shows the still agent glyph",
  );

  flushSync(() => root.unmount());
  stage.remove();

  return failures.length === 0 ? "passed" : failures.join("\n");
}
