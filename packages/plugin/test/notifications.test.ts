import type { ClientApi } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import type { Execution, SessionInfo } from "@nyte-ai/schema";
import { expect, test } from "vitest";
import { mountClientPlugins } from "../src/client/mount.ts";
import notifications from "../src/client/notifications.ts";
import { fakeModels, open } from "./fake-models.ts";

const RUN = {
  id: asId<"run">("run"),
  head: asId<"head">("main"),
  startedAt: 1,
  attempt: 1,
  origin: { kind: "input", message: asId<"message">("m") },
} as const;

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const LIVE: Execution = { kind: "live", run: RUN, phase: "responding", stopping: false };

const ASKING: Execution = { kind: "waiting", run: RUN, on: { kind: "part", part: asId("p1") } };

const ON_SUBAGENT: Execution = {
  kind: "waiting",
  run: RUN,
  on: { kind: "run", session: asId("child"), run: asId("child-run") },
};

const DONE: Execution = {
  kind: "idle",
  lastRun: { id: RUN.id, end: { kind: "completed", usage: USAGE }, endedAt: 2 },
};

const FAILED: Execution = {
  kind: "idle",
  lastRun: {
    id: RUN.id,
    end: { kind: "failed", failure: { class: "provider", message: "Rate\nlimited." } },
    endedAt: 2,
  },
};

const STOPPED: Execution = {
  kind: "idle",
  lastRun: { id: RUN.id, end: { kind: "stopped" }, endedAt: 2 },
};

function row(
  name: string,
  execution: Execution,
  change: { readonly working?: number; readonly waiting?: number; readonly parent?: string } = {},
): SessionInfo {
  return {
    id: asId<"session">(name),
    name,
    parent: change.parent === undefined ? null : asId<"session">(change.parent),
    call: null,
    workspace: asId<"workspace">("w"),
    pinned: false,
    archived: false,
    activation: { kind: "active" },
    heads: [
      {
        name: asId<"head">("main"),
        tip: { kind: "commit", id: asId<"commit">("tip") },
        stack: null,
        execution,
        unread: false,
        background: { working: change.working ?? 0, waiting: change.waiting ?? 0 },
      },
    ],
    createdAt: 0,
    lastActivityAt: 0,
  };
}

test.each<{
  readonly name: string;
  readonly before: SessionInfo;
  /** Heard between `before` and `after`. */
  readonly through?: SessionInfo;
  readonly after: SessionInfo;
  readonly notified: readonly Parameters<ClientApi["ui"]["notify"]>[0][];
}>([
  {
    name: "a chat that starts waiting on its own question",
    before: row("Release", LIVE),
    after: row("Release", ASKING),
    notified: [{ title: "Release", message: "Needs your answer", level: "warning" }],
  },
  {
    name: "a chat whose subagent starts waiting",
    before: row("Release", ON_SUBAGENT),
    after: row("Release", ON_SUBAGENT, { waiting: 1 }),
    notified: [{ title: "Release", message: "Needs your answer", level: "warning" }],
  },
  {
    name: "an idle chat whose background subagent starts waiting",
    before: row("Release", DONE, { working: 1 }),
    after: row("Release", DONE, { waiting: 1 }),
    notified: [{ title: "Release", message: "Needs your answer", level: "warning" }],
  },
  {
    name: "a running chat whose background subagent starts waiting",
    before: row("Release", LIVE, { working: 1 }),
    after: row("Release", LIVE, { waiting: 1 }),
    notified: [{ title: "Release", message: "Needs your answer", level: "warning" }],
  },
  {
    name: "an idle chat once its subagent's question is answered, without its end again",
    before: row("Release", DONE, { working: 1 }),
    through: row("Release", DONE, { waiting: 1 }),
    after: row("Release", DONE, { working: 1 }),
    notified: [{ title: "Release", message: "Needs your answer", level: "warning" }],
  },
  {
    name: "a run that completes",
    before: row("Release", LIVE),
    after: row("Release", DONE),
    notified: [{ title: "Release", message: "Done", level: "info" }],
  },
  {
    name: "a run that fails, on one line",
    before: row("Release", LIVE),
    after: row("Release", FAILED),
    notified: [{ title: "Release", message: "Failed: Rate limited.", level: "error" }],
  },
  {
    name: "a stopped run stays quiet",
    before: row("Release", LIVE),
    after: row("Release", STOPPED),
    notified: [],
  },
  {
    name: "a subagent stays quiet; its parent asks",
    before: row("child", LIVE, { parent: "Release" }),
    after: row("child", ASKING, { parent: "Release" }),
    notified: [],
  },
  {
    name: "a side chat's old question rings on the side chat",
    before: { ...row("side", LIVE, { parent: "Release" }), side: true },
    after: { ...row("side", ASKING, { parent: "Release" }), side: true },
    notified: [{ title: "side", message: "Needs your answer", level: "warning" }],
  },
  {
    name: "a side chat's end stays quiet",
    before: { ...row("side", LIVE, { parent: "Release" }), side: true },
    after: { ...row("side", DONE, { parent: "Release" }), side: true },
    notified: [],
  },
  {
    name: "a chat someone is looking at stays quiet",
    before: row("shown", LIVE),
    after: row("shown", ASKING),
    notified: [],
  },
  {
    name: "the same state again says nothing",
    before: row("Release", ASKING),
    after: row("Release", ASKING),
    notified: [],
  },
])("notifies $name", async (scenario) => {
  await using host = await open(fakeModels(), []);
  const notified: Parameters<ClientApi["ui"]["notify"]>[0][] = [];

  const plugins = await mountClientPlugins({
    connection: host,
    plugins: [notifications],
    client: { name: "web", frameworks: ["react"] },
    session: () => null,
    looking: () => new Set([asId<"session">("shown")]),
    notify: (input) => void notified.push(input),
    report: () => undefined,
  });

  plugins.sessionsChanged([scenario.before]);

  if (scenario.through !== undefined) plugins.sessionsChanged([scenario.through]);
  plugins.sessionsChanged([scenario.after]);
  await Promise.resolve();

  expect(notified).toEqual(scenario.notified);
  await plugins.dispose();
});
