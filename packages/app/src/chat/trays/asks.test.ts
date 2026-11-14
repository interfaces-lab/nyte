import assert from "node:assert/strict";
import { test } from "vitest";
import { openApprovals } from "@nyte-ai/plugin/approvals/schema";
import { openQuestions } from "@nyte-ai/plugin/question/schema";
import type { BackgroundItem, Execution, PartView, SessionId, SessionView } from "@nyte-ai/sdk";
import type { RunView } from "@nyte-ai/schema";
import { asId, asSeq } from "@nyte-ai/schema";
import { waitingWalk } from "../../chats/waiting-walk.ts";
import { chatStore } from "../../data/chat-store.ts";
import { installScripted, scriptedConnection } from "../../../test/scripted-connection.ts";
import type { ViewStream } from "../../../test/scripted-connection.ts";
import { USAGE } from "../../../test/view-fixtures.ts";
import { openAsks } from "./asks.ts";

const RUN: RunView = {
  id: asId<"run">("run"),
  head: asId<"head">("main"),
  startedAt: 0,
  attempt: 1,
  origin: { kind: "input", message: asId<"message">("prompt") },
};

const LIVE: Execution = { kind: "live", run: RUN, phase: "executing", stopping: false };

function onPart(part: string): Execution {
  return { kind: "waiting", run: RUN, on: { kind: "part", part: asId<"part">(part) } };
}

function onChild(session: string): Execution {
  return {
    kind: "waiting",
    run: RUN,
    on: { kind: "run", session: asId<"session">(session), run: RUN.id },
  };
}

function question(id: string, change: Partial<PartView> = {}): PartView {
  return {
    id: asId<"part">(id),
    partKind: "ask/question",
    placement: { kind: "modal" },
    state: {
      questions: [{ header: "Pick", question: id, options: [{ label: "Yes", description: "" }] }],
      call: "call",
      phase: { kind: "asking" },
    },
    version: 1,
    status: { kind: "live", run: RUN.id },
    owner: "question",
    ...change,
  };
}

function late(id: string): PartView {
  return question(id, {
    state: {
      questions: [{ header: "Pick", question: id, options: [{ label: "Yes", description: "" }] }],
      call: "call",
      phase: { kind: "open", head: "main" },
    },
  });
}

function approval(id: string, decision: string | null = null): PartView {
  return {
    id: asId<"part">(id),
    partKind: "ask/approval",
    placement: { kind: "modal" },
    state: { tool: "bash", class: { kind: "shell", command: "ls" }, reason: "shell", decision },
    version: 1,
    status: { kind: "live", run: RUN.id },
    owner: "approvals",
  };
}

const STOPPED: Partial<PartView> = {
  status: { kind: "failed", run: RUN.id, failure: { class: "aborted", message: "Stopped." } },
};

interface ChatSpec {
  readonly parts?: readonly PartView[];
  readonly execution?: Execution;
  readonly below?: readonly {
    readonly name: string;
    readonly title: string;
    readonly state?: BackgroundItem["state"];
    readonly kind?: BackgroundItem["kind"];
  }[];
  readonly loadsLater?: true;
}

interface Row {
  readonly name: string;
  readonly open: "questions" | "approvals";
  readonly chats: Readonly<Record<string, ChatSpec>>;
  readonly asks: readonly string[];
  readonly loaded?: readonly string[];
}

const ROWS: readonly Row[] = [
  {
    name: "own only",
    open: "questions",
    chats: { root: { parts: [question("q")], execution: onPart("q") } },
    asks: ["root/q"],
  },
  {
    name: "a descendant only, with its title",
    open: "questions",
    chats: {
      root: { execution: onChild("child"), below: [{ name: "child", title: "Child" }] },
      child: { parts: [question("q")], execution: onPart("q") },
    },
    asks: ["child/q from Child"],
  },
  {
    name: "own before a descendant's",
    open: "questions",
    chats: {
      root: {
        parts: [question("own")],
        execution: onPart("own"),
        below: [{ name: "child", title: "Child" }],
      },
      child: { parts: [question("theirs")], execution: onPart("theirs") },
    },
    asks: ["root/own", "child/theirs from Child"],
  },
  {
    name: "two descendants in the background's order",
    open: "questions",
    chats: {
      root: {
        execution: onChild("b"),
        below: [
          { name: "b", title: "B" },
          { name: "a", title: "A" },
        ],
      },
      a: { parts: [question("qa")], execution: onPart("qa") },
      b: { parts: [question("qb1"), question("qb2")], execution: onPart("qb1") },
    },
    asks: ["b/qb1 from B", "b/qb2 from B", "a/qa from A"],
  },
  {
    name: "a grandchild under a child that waits on it; the child's own open question is left out",
    open: "questions",
    chats: {
      root: { execution: onChild("child"), below: [{ name: "child", title: "Child" }] },
      child: {
        parts: [question("mine")],
        execution: onChild("grand"),
        below: [{ name: "grand", title: "Grand" }],
      },
      grand: { parts: [question("q")], execution: onPart("q") },
    },
    asks: ["grand/q from Grand"],
  },
  {
    name: "only waiting child chats are walked",
    open: "questions",
    chats: {
      root: {
        execution: LIVE,
        below: [
          { name: "working", title: "Working", state: "working" },
          { name: "job", title: "Job", kind: "job" },
        ],
      },
      working: { parts: [question("q")], execution: onPart("q") },
      job: { parts: [question("q")], execution: onPart("q") },
    },
    asks: [],
  },
  {
    name: "a waiting child whose view hasn't loaded is absent until it loads",
    open: "questions",
    chats: {
      root: { execution: onChild("child"), below: [{ name: "child", title: "Child" }] },
      child: { parts: [question("q")], execution: onPart("q"), loadsLater: true },
    },
    asks: [],
    loaded: ["child/q from Child"],
  },
  {
    name: "a late question stays on its own chat but drops from its parent once the child's run goes on",
    open: "questions",
    chats: {
      root: {
        parts: [late("own")],
        execution: LIVE,
        below: [
          { name: "waiting", title: "Waiting" },
          { name: "working", title: "Working", state: "working" },
        ],
      },
      waiting: { parts: [late("q")], execution: LIVE },
      working: { parts: [late("q")], execution: LIVE },
    },
    asks: ["root/own late"],
  },
  {
    name: "stopped and answered questions are absent, and so is another kind of ask",
    open: "questions",
    chats: {
      root: {
        parts: [
          question("stopped", STOPPED),
          question("answered", {
            state: {
              questions: [{ header: "Pick", question: "q", options: [] }],
              call: "call",
              phase: { kind: "answered", answers: [["Yes"]], head: null },
            },
          }),
          approval("approval"),
        ],
        execution: onPart("approval"),
      },
    },
    asks: [],
  },
  {
    name: "approvals: own first, so the tray's first pick is its own",
    open: "approvals",
    chats: {
      root: {
        parts: [approval("own")],
        execution: onPart("own"),
        below: [{ name: "child", title: "Child" }],
      },
      child: { parts: [approval("c1"), approval("c2")], execution: onPart("c1") },
    },
    asks: ["root/own", "child/c1 from Child", "child/c2 from Child"],
  },
  {
    name: "approvals: answered and stopped are absent, leaving a descendant's first",
    open: "approvals",
    chats: {
      root: {
        parts: [
          approval("answered", "once"),
          { ...approval("stopped"), ...STOPPED },
          question("q"),
        ],
        execution: onChild("child"),
        below: [{ name: "child", title: "Child" }],
      },
      child: { parts: [approval("c1"), approval("c2")], execution: onPart("c1") },
    },
    asks: ["child/c1 from Child", "child/c2 from Child"],
  },
];

function view(spec: ChatSpec, prefix: string): SessionView {
  return {
    revision: asId<"revision">("r1"),
    seq: asSeq(1),
    activation: { kind: "active" },
    messages: [],
    queue: [],
    leadingPrompt: null,
    parts: spec.parts ?? [],
    turns: [],
    usage: USAGE,
    execution: spec.execution ?? LIVE,
    reportsHeld: false,
    seenThrough: null,
    background: (spec.below ?? []).map((child) => ({
      kind: child.kind ?? "child",
      id: `${prefix}${child.name}`,
      title: child.title,
      state: child.state ?? "waiting",
      startedBy: null,
    })),
    configuration: { selected: null, effective: null },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

function source(first: SessionView | undefined): ViewStream {
  let latest = first;
  const listeners = new Set<() => void>();

  return {
    latest: () => latest,
    push: (next) => {
      latest = next;

      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    watch: async function* () {
      yield* [];
    },
  };
}

async function settled(ids: readonly SessionId[]): Promise<void> {
  await Promise.all(ids.map((id) => chatStore(id).first()));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("a chat's open asks are its own, then each waiting descendant's in walk order", async () => {
  for (const [index, row] of ROWS.entries()) {
    const prefix = `${String(index)}-`;
    const id = (name: string): SessionId => asId<"session">(`${prefix}${name}`);
    const names = Object.keys(row.chats);

    const sources = new Map(
      Object.entries(row.chats).map(([name, spec]) => [
        id(name),
        source(spec.loadsLater === true ? undefined : view(spec, prefix)),
      ]),
    );

    installScripted(scriptedConnection({ views: sources }));
    const root = id("root");
    const walk = waitingWalk(root);
    const leave = walk.subscribe(() => undefined);
    const open = row.open === "questions" ? openQuestions : openApprovals;

    const read = (): readonly string[] =>
      openAsks<{ readonly part: string; readonly late?: boolean }>(
        open,
        { sessionId: root, parts: chatStore(root).value?.parts },
        walk.getSnapshot(),
      ).map((ask) => {
        const name = ask.sessionId.slice(prefix.length);

        const from =
          ask.origin === undefined
            ? ""
            : ` from ${ask.origin.title}${ask.origin.sessionId === ask.sessionId ? "" : " elsewhere"}`;

        return `${name}/${ask.request.part}${ask.request.late === true ? " late" : ""}${from}`;
      });

    await settled(names.filter((name) => row.chats[name]?.loadsLater !== true).map(id));
    assert.deepEqual(read(), row.asks, row.name);
    assert.equal(waitingWalk(root), walk, `${row.name}: one walk per root`);
    assert.equal(walk.getSnapshot(), walk.getSnapshot(), `${row.name}: a stable snapshot`);

    if (row.loaded !== undefined) {
      for (const [name, spec] of Object.entries(row.chats))
        if (spec.loadsLater === true) sources.get(id(name))?.push(view(spec, prefix));
      await settled(names.map(id));
      assert.deepEqual(read(), row.loaded, `${row.name}, once loaded`);
    }

    leave();
    assert.notEqual(waitingWalk(root), walk, `${row.name}: the walk ends with its last listener`);
  }
});
