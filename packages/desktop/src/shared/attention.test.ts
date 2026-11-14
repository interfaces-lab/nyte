import { expect, test } from "vitest";
import { DEFAULT_DESKTOP_SETTINGS } from "@nyte-ai/app/contract/desktop-settings.ts";
import type { Execution, SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { findViewer, planAttention, reconcileReminders, stepWindowAttention } from "./attention.ts";
import type {
  AttentionDelivery,
  AttentionPlan,
  AttentionReminder,
  AttentionSettings,
  WindowAttention,
  WindowAttentionEvent,
} from "./attention.ts";

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

const asking: Execution = { kind: "waiting", run: RUN, on: { kind: "part", part: asId("p1") } };

const askingAgain: Execution = {
  kind: "waiting",
  run: RUN,
  on: { kind: "part", part: asId("p2") },
};

const onSubagent: Execution = {
  kind: "waiting",
  run: RUN,
  on: { kind: "run", session: asId("child"), run: asId("child-run") },
};

const running: Execution = { kind: "live", run: RUN, phase: "responding", stopping: false };

const retrying: Execution = { kind: "retrying", run: RUN, until: 5, reason: "Overloaded" };

const completed: Execution = {
  kind: "idle",
  lastRun: { id: asId("run"), end: { kind: "completed", usage: USAGE }, endedAt: 2 },
};

const failed: Execution = {
  kind: "idle",
  lastRun: {
    id: asId("run"),
    end: { kind: "failed", failure: { class: "provider", message: "Rate  limited.\n" } },
    endedAt: 2,
  },
};

const stopped: Execution = {
  kind: "idle",
  lastRun: { id: asId("run"), end: { kind: "stopped" }, endedAt: 2 },
};

const fresh: Execution = { kind: "idle", lastRun: null };

function chat(
  id: string,
  execution: Execution,
  head: { readonly unread?: boolean; readonly working?: number; readonly waiting?: number } = {},
  session: Partial<SessionInfo> = {},
): SessionInfo {
  return {
    id: asId<"session">(id),
    name: id,
    parent: null,
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
        unread: head.unread ?? false,
        background: { working: head.working ?? 0, waiting: head.waiting ?? 0 },
      },
    ],
    createdAt: 10,
    lastActivityAt: 10,
    ...session,
  };
}

const child = { parent: asId<"session">("parent") };

/** A delivery as one line: session, state, title, body, then the channels it reaches. */
function line(delivery: AttentionDelivery): string {
  const channels = (["notify", "sound", "bounce"] as const).filter((channel) => delivery[channel]);

  return `${delivery.session} ${delivery.state} "${delivery.title}": ${delivery.body} [${channels.join(" ")}]`;
}

function summarise(plan: AttentionPlan) {
  return {
    seen: [...plan.seen].map(
      (entry) => `${entry[0]}=${entry[1].key}${entry[1].fresh ? " fresh" : ""}`,
    ),
    deliveries: plan.deliveries.map(line),
    badge: plan.badge,
    reminders: plan.reminders.map((reminder) => `${reminder.id} ${line(reminder.delivery)}`),
  };
}

test.each<{
  readonly name: string;
  readonly settings?: Partial<AttentionSettings>;
  readonly previous: readonly (readonly [string, string, boolean])[] | undefined;
  readonly rows: readonly SessionInfo[];
  readonly since?: number;
  readonly plan: ReturnType<typeof summarise>;
}>([
  {
    name: "the first plan delivers nothing and starts no reminder, but badges",
    previous: undefined,
    rows: [chat("own", asking)],
    plan: { seen: ["own=waiting:p1"], deliveries: [], badge: 1, reminders: [] },
  },
  {
    name: "a chat's own question delivers, badges and reminds",
    previous: [],
    rows: [chat("own", asking)],
    plan: {
      seen: ["own=waiting:p1 fresh"],
      deliveries: ['own waiting "own": Needs your answer [notify sound bounce]'],
      badge: 1,
      reminders: ['own:waiting:p1 own waiting "own": Still needs your answer [notify sound]'],
    },
  },
  {
    name: "a chat created before the plans began doesn't deliver",
    previous: [],
    since: 11,
    rows: [chat("own", asking)],
    plan: { seen: ["own=waiting:p1"], deliveries: [], badge: 1, reminders: [] },
  },
  {
    name: "the same question again keeps its reminder and delivers nothing",
    previous: [["own", "waiting:p1", true]],
    rows: [chat("own", asking)],
    plan: {
      seen: ["own=waiting:p1 fresh"],
      deliveries: [],
      badge: 1,
      reminders: ['own:waiting:p1 own waiting "own": Still needs your answer [notify sound]'],
    },
  },
  {
    name: "a question seen on the first plan never reminds",
    previous: [["own", "waiting:p1", false]],
    rows: [chat("own", asking)],
    plan: { seen: ["own=waiting:p1"], deliveries: [], badge: 1, reminders: [] },
  },
  {
    name: "a new question in the same run delivers again",
    previous: [["own", "waiting:p1", true]],
    rows: [chat("own", askingAgain)],
    plan: {
      seen: ["own=waiting:p2 fresh"],
      deliveries: ['own waiting "own": Needs your answer [notify sound bounce]'],
      badge: 1,
      reminders: ['own:waiting:p2 own waiting "own": Still needs your answer [notify sound]'],
    },
  },
  {
    name: "a parent whose run waits on its subagent's approval waits, delivers, badges and reminds",
    previous: [["parent", "working:run", true]],
    rows: [chat("parent", onSubagent, { waiting: 1 }), chat("child", asking, {}, child)],
    plan: {
      seen: ["parent=working:run:asking fresh", "child=waiting:p1 fresh"],
      deliveries: ['parent waiting "parent": Needs your answer [notify sound bounce]'],
      badge: 1,
      reminders: [
        'parent:working:run:asking parent waiting "parent": Still needs your answer [notify sound]',
      ],
    },
  },
  {
    name: "with notifySubagents a question its parent alerts for alerts once, on the parent",
    settings: { notifySubagents: true },
    previous: [["parent", "working:run", true]],
    rows: [chat("parent", onSubagent, { waiting: 1 }), chat("child", asking, {}, child)],
    plan: {
      seen: ["parent=working:run:asking fresh", "child=waiting:p1 fresh"],
      deliveries: ['parent waiting "parent": Needs your answer [notify sound bounce]'],
      badge: 1,
      reminders: [
        'parent:working:run:asking parent waiting "parent": Still needs your answer [notify sound]',
      ],
    },
  },
  {
    name: "with notifySubagents a grandchild's question alerts once, at the top of the chain",
    settings: { notifySubagents: true },
    previous: [],
    rows: [
      chat("parent", onSubagent, { waiting: 1 }),
      chat("child", onSubagent, { waiting: 1 }, child),
      chat("grandchild", asking, {}, { parent: asId("child") }),
    ],
    plan: {
      seen: [
        "parent=working:run:asking fresh",
        "child=working:run:asking fresh",
        "grandchild=waiting:p1 fresh",
      ],
      deliveries: ['parent waiting "parent": Needs your answer [notify sound bounce]'],
      badge: 1,
      reminders: [
        'parent:working:run:asking parent waiting "parent": Still needs your answer [notify sound]',
      ],
    },
  },
  {
    name: "a parent waiting on a subagent that works is working",
    previous: [],
    rows: [chat("parent", onSubagent, { working: 1 })],
    plan: { seen: ["parent=working:run fresh"], deliveries: [], badge: 0, reminders: [] },
  },
  {
    name: "a parent's answered subagent goes back to working and delivers nothing",
    previous: [["parent", "working:run:asking", true]],
    rows: [chat("parent", onSubagent, { working: 1 })],
    plan: { seen: ["parent=working:run fresh"], deliveries: [], badge: 0, reminders: [] },
  },
  {
    name: "a waiting subagent whose parent isn't listed alerts on itself without notifySubagents",
    previous: [],
    rows: [chat("child", asking, {}, child)],
    plan: {
      seen: ["child=waiting:p1 fresh"],
      deliveries: ['child waiting "child": Needs your answer [notify sound bounce]'],
      badge: 1,
      reminders: ['child:waiting:p1 child waiting "child": Still needs your answer [notify sound]'],
    },
  },
  {
    name: "without notifySubagents a running parent's background subagent's question alerts once, on the parent",
    previous: [["parent", "working:run", true]],
    rows: [chat("parent", running, { waiting: 1 }), chat("child", asking, {}, child)],
    plan: {
      seen: ["parent=working:run:asking fresh", "child=waiting:p1 fresh"],
      deliveries: ['parent waiting "parent": Needs your answer [notify sound bounce]'],
      badge: 1,
      reminders: [
        'parent:working:run:asking parent waiting "parent": Still needs your answer [notify sound]',
      ],
    },
  },
  {
    name: "without notifySubagents an idle parent's background subagent's question alerts once, on the parent",
    previous: [["parent", "ended:run", false]],
    rows: [chat("parent", completed, { waiting: 1 }), chat("child", asking, {}, child)],
    plan: {
      seen: ["parent=ended:run:asking fresh", "child=waiting:p1 fresh"],
      deliveries: ['parent waiting "parent": Needs your answer [notify sound bounce]'],
      badge: 1,
      reminders: [
        'parent:ended:run:asking parent waiting "parent": Still needs your answer [notify sound]',
      ],
    },
  },
  {
    name: "without notifySubagents a grandchild's question below an idle chat alerts once, at the top of the chain",
    previous: [],
    rows: [
      chat("parent", completed, { waiting: 1 }),
      chat("child", onSubagent, { waiting: 1 }, child),
      chat("grandchild", asking, {}, { parent: asId("child") }),
    ],
    plan: {
      seen: [
        "parent=ended:run:asking fresh",
        "child=working:run:asking fresh",
        "grandchild=waiting:p1 fresh",
      ],
      deliveries: ['parent waiting "parent": Needs your answer [notify sound bounce]'],
      badge: 1,
      reminders: [
        'parent:ended:run:asking parent waiting "parent": Still needs your answer [notify sound]',
      ],
    },
  },
  {
    name: "an idle parent whose subagent's question is answered doesn't deliver its end again",
    settings: { notifySubagents: true },
    previous: [
      ["parent", "ended:run:asking", true],
      ["child", "waiting:p1", true],
    ],
    rows: [
      chat("parent", completed, { unread: true, working: 1 }),
      chat("child", running, {}, child),
    ],
    plan: {
      seen: ["parent=ended:run fresh", "child=working:run fresh"],
      deliveries: [],
      badge: 1,
      reminders: [],
    },
  },
  {
    name: "a subagent below an archived parent alerts for its question itself",
    previous: [],
    rows: [
      chat("parent", completed, { waiting: 1 }, { archived: true }),
      chat("child", asking, {}, child),
    ],
    plan: {
      seen: ["parent=ended:run:asking fresh", "child=waiting:p1 fresh"],
      deliveries: ['child waiting "child": Needs your answer [notify sound bounce]'],
      badge: 1,
      reminders: ['child:waiting:p1 child waiting "child": Still needs your answer [notify sound]'],
    },
  },
  {
    name: "a side chat's old question alerts on the side chat without notifySubagents",
    previous: [],
    rows: [chat("parent", completed), chat("side", asking, {}, { ...child, side: true })],
    plan: {
      seen: ["parent=ended:run fresh", "side=waiting:p1 fresh"],
      deliveries: [
        'parent done "parent": Done [notify]',
        'side waiting "side": Needs your answer [notify sound bounce]',
      ],
      badge: 1,
      reminders: ['side:waiting:p1 side waiting "side": Still needs your answer [notify sound]'],
    },
  },
  {
    name: "the waiting subagent delivers, badges and reminds with notifySubagents",
    settings: { notifySubagents: true },
    previous: [],
    rows: [chat("child", asking, {}, child)],
    plan: {
      seen: ["child=waiting:p1 fresh"],
      deliveries: ['child waiting "child": Needs your answer [notify sound bounce]'],
      badge: 1,
      reminders: ['child:waiting:p1 child waiting "child": Still needs your answer [notify sound]'],
    },
  },
  {
    name: "a running chat is quiet",
    previous: [["live", "none", false]],
    rows: [chat("live", running)],
    plan: { seen: ["live=working:run fresh"], deliveries: [], badge: 0, reminders: [] },
  },
  {
    name: "a retrying chat is working in the same run",
    previous: [["retry", "working:run", true]],
    rows: [chat("retry", retrying)],
    plan: { seen: ["retry=working:run fresh"], deliveries: [], badge: 0, reminders: [] },
  },
  {
    name: "a chat that never ran is quiet",
    previous: [],
    rows: [chat("new", fresh, { unread: true })],
    plan: { seen: ["new=none fresh"], deliveries: [], badge: 0, reminders: [] },
  },
  {
    name: "an unread reply delivers done and badges",
    previous: [["done", "working:run", false]],
    rows: [chat("done", completed, { unread: true })],
    plan: {
      seen: ["done=ended:run fresh"],
      deliveries: ['done done "done": Done [notify]'],
      badge: 1,
      reminders: [],
    },
  },
  {
    name: "a settled unread reply badges and delivers nothing",
    previous: [["done", "ended:run", false]],
    rows: [chat("done", completed, { unread: true })],
    plan: { seen: ["done=ended:run"], deliveries: [], badge: 1, reminders: [] },
  },
  {
    name: "a read chat delivers done on the change and doesn't badge",
    previous: [["read", "working:run", false]],
    rows: [chat("read", completed)],
    plan: {
      seen: ["read=ended:run fresh"],
      deliveries: ['read done "read": Done [notify]'],
      badge: 0,
      reminders: [],
    },
  },
  {
    name: "an unread failure delivers its reason on one line and badges",
    previous: [],
    rows: [chat("failed", failed, { unread: true })],
    plan: {
      seen: ["failed=ended:run fresh"],
      deliveries: ['failed failed "failed": Failed: Rate limited. [notify sound]'],
      badge: 1,
      reminders: [],
    },
  },
  {
    name: "a read failure delivers and doesn't badge",
    previous: [],
    rows: [chat("failed", failed)],
    plan: {
      seen: ["failed=ended:run fresh"],
      deliveries: ['failed failed "failed": Failed: Rate limited. [notify sound]'],
      badge: 0,
      reminders: [],
    },
  },
  {
    name: "a stopped run says nothing, even unread",
    previous: [],
    rows: [chat("stopped", stopped, { unread: true })],
    plan: { seen: ["stopped=ended:run fresh"], deliveries: [], badge: 0, reminders: [] },
  },
  {
    name: "a side chat's reply counts for nothing without notifySubagents",
    previous: [],
    rows: [chat("side", completed, { unread: true }, { ...child, side: true })],
    plan: { seen: ["side=ended:run fresh"], deliveries: [], badge: 0, reminders: [] },
  },
  {
    name: "a side chat's reply delivers and badges with notifySubagents",
    settings: { notifySubagents: true },
    previous: [],
    rows: [chat("side", completed, { unread: true }, { ...child, side: true })],
    plan: {
      seen: ["side=ended:run fresh"],
      deliveries: ['side done "side": Done [notify]'],
      badge: 1,
      reminders: [],
    },
  },
  {
    name: "an idle parent whose subagent waits delivers, badges and reminds",
    previous: [],
    rows: [chat("idle-parent", completed, { waiting: 1 })],
    plan: {
      seen: ["idle-parent=ended:run:asking fresh"],
      deliveries: ['idle-parent waiting "idle-parent": Needs your answer [notify sound bounce]'],
      badge: 1,
      reminders: [
        'idle-parent:ended:run:asking idle-parent waiting "idle-parent": Still needs your answer [notify sound]',
      ],
    },
  },
  {
    name: "with notifySubagents an idle parent's background subagent's question alerts once, on the parent",
    settings: { notifySubagents: true },
    previous: [["parent", "ended:run", false]],
    rows: [chat("parent", completed, { waiting: 1 }), chat("child", asking, {}, child)],
    plan: {
      seen: ["parent=ended:run:asking fresh", "child=waiting:p1 fresh"],
      deliveries: ['parent waiting "parent": Needs your answer [notify sound bounce]'],
      badge: 1,
      reminders: [
        'parent:ended:run:asking parent waiting "parent": Still needs your answer [notify sound]',
      ],
    },
  },
  {
    name: "a project chat with working background agents isn't done yet",
    previous: [],
    rows: [chat("lead", completed, { unread: true, working: 1 }, { project: asId("p") })],
    plan: { seen: ["lead=ended:run:agents fresh"], deliveries: [], badge: 0, reminders: [] },
  },
  {
    name: "a chat outside a project with working background agents is done",
    previous: [],
    rows: [chat("solo", completed, { unread: true, working: 1 })],
    plan: {
      seen: ["solo=ended:run fresh"],
      deliveries: ['solo done "solo": Done [notify]'],
      badge: 1,
      reminders: [],
    },
  },
  {
    name: "an archived chat never counts",
    previous: [],
    rows: [chat("archived", asking, {}, { archived: true })],
    plan: { seen: ["archived=waiting:p1 fresh"], deliveries: [], badge: 0, reminders: [] },
  },
  {
    name: "an unnamed chat is titled New chat",
    previous: [],
    rows: [chat("unnamed", completed, {}, { name: null })],
    plan: {
      seen: ["unnamed=ended:run fresh"],
      deliveries: ['unnamed done "New chat": Done [notify]'],
      badge: 0,
      reminders: [],
    },
  },
  {
    name: "with notifications off a question only bounces and badges",
    settings: { notifications: false },
    previous: [],
    rows: [chat("own", asking), chat("done", completed, { unread: true })],
    plan: {
      seen: ["own=waiting:p1 fresh", "done=ended:run fresh"],
      deliveries: ['own waiting "own": Needs your answer [bounce]'],
      badge: 2,
      reminders: [],
    },
  },
  {
    name: "with the dock badge off nothing badges or bounces",
    settings: { dockBadge: false },
    previous: [],
    rows: [chat("own", asking), chat("done", completed, { unread: true })],
    plan: {
      seen: ["own=waiting:p1 fresh", "done=ended:run fresh"],
      deliveries: [
        'own waiting "own": Needs your answer [notify sound]',
        'done done "done": Done [notify]',
      ],
      badge: 0,
      reminders: ['own:waiting:p1 own waiting "own": Still needs your answer [notify sound]'],
    },
  },
  {
    name: "without remind a question starts no reminder",
    settings: { alertsWaiting: ["notification", "badge"] },
    previous: [],
    rows: [chat("own", asking)],
    plan: {
      seen: ["own=waiting:p1 fresh"],
      deliveries: ['own waiting "own": Needs your answer [notify]'],
      badge: 1,
      reminders: [],
    },
  },
  {
    name: "a chat with no channel for its state is quiet but still tracked",
    settings: { alertsDone: [] },
    previous: [],
    rows: [chat("done", completed, { unread: true })],
    plan: { seen: ["done=ended:run fresh"], deliveries: [], badge: 0, reminders: [] },
  },
])("$name", (row) => {
  const plan = planAttention({
    previous:
      row.previous === undefined
        ? undefined
        : new Map(
            row.previous.map((entry) => [
              asId<"session">(entry[0]),
              { key: entry[1], fresh: entry[2] },
            ]),
          ),
    rows: row.rows,
    settings: { ...DEFAULT_DESKTOP_SETTINGS, ...row.settings },
    since: row.since ?? 0,
  });

  expect(summarise(plan)).toEqual(row.plan);
});

const opening = asId<"session">("opening");

const viewed = asId<"session">("viewed");

test.each<{
  readonly name: string;
  readonly before: readonly (readonly [number, WindowAttention])[];
  readonly event: WindowAttentionEvent;
  readonly after: readonly (readonly [number, WindowAttention])[];
  readonly reveal?: number;
  readonly open?: { readonly window: number; readonly session: string };
}>([
  {
    name: "a new window viewing a chat is ready, last in order",
    before: [[1, { kind: "ready", viewed: null }]],
    event: { kind: "viewing", window: 2, viewed: "viewed" },
    after: [
      [1, { kind: "ready", viewed: null }],
      [2, { kind: "ready", viewed: "viewed" }],
    ],
  },
  {
    name: "a ready window that views another chat keeps its place",
    before: [
      [1, { kind: "ready", viewed: "viewed" }],
      [2, { kind: "ready", viewed: null }],
    ],
    event: { kind: "viewing", window: 1, viewed: null },
    after: [
      [1, { kind: "ready", viewed: null }],
      [2, { kind: "ready", viewed: null }],
    ],
  },
  {
    name: "a loading window that reports opens the chat it was loading for",
    before: [[1, { kind: "loading", opening }]],
    event: { kind: "viewing", window: 1, viewed: null },
    after: [[1, { kind: "ready", viewed: null }]],
    open: { window: 1, session: "opening" },
  },
  {
    name: "a reload forgets a ready window",
    before: [
      [1, { kind: "ready", viewed: "viewed" }],
      [2, { kind: "ready", viewed: null }],
    ],
    event: { kind: "ended", window: 1, end: "navigated" },
    after: [[2, { kind: "ready", viewed: null }]],
  },
  {
    name: "a reload keeps a loading window loading",
    before: [[1, { kind: "loading", opening }]],
    event: { kind: "ended", window: 1, end: "navigated" },
    after: [[1, { kind: "loading", opening }]],
  },
  {
    name: "a crash forgets a ready window",
    before: [[1, { kind: "ready", viewed: "viewed" }]],
    event: { kind: "ended", window: 1, end: "crashed" },
    after: [],
  },
  {
    name: "a crash keeps a loading window loading",
    before: [[1, { kind: "loading", opening }]],
    event: { kind: "ended", window: 1, end: "crashed" },
    after: [[1, { kind: "loading", opening }]],
  },
  {
    name: "a reload of an unknown window changes nothing",
    before: [[1, { kind: "ready", viewed: null }]],
    event: { kind: "ended", window: 2, end: "navigated" },
    after: [[1, { kind: "ready", viewed: null }]],
  },
  {
    name: "a closed ready window is forgotten",
    before: [[1, { kind: "ready", viewed: "viewed" }]],
    event: { kind: "ended", window: 1, end: "closed" },
    after: [],
  },
  {
    name: "a closed loading window is forgotten",
    before: [[1, { kind: "loading", opening }]],
    event: { kind: "ended", window: 1, end: "closed" },
    after: [],
  },
  {
    name: "a click on a ready window reveals it and opens the chat",
    before: [[1, { kind: "ready", viewed: null }]],
    event: { kind: "clicked", window: 1, session: opening },
    after: [[1, { kind: "ready", viewed: null }]],
    reveal: 1,
    open: { window: 1, session: "opening" },
  },
  {
    name: "a click on a window that hasn't reported reveals it and waits for its load",
    before: [[1, { kind: "ready", viewed: null }]],
    event: { kind: "clicked", window: 2, session: opening },
    after: [
      [1, { kind: "ready", viewed: null }],
      [2, { kind: "loading", opening }],
    ],
    reveal: 2,
  },
  {
    name: "a focused window moves last, so it views a chat most recently",
    before: [
      [1, { kind: "ready", viewed: "viewed" }],
      [2, { kind: "ready", viewed: "viewed" }],
    ],
    event: { kind: "focused", window: 1 },
    after: [
      [2, { kind: "ready", viewed: "viewed" }],
      [1, { kind: "ready", viewed: "viewed" }],
    ],
  },
  {
    name: "focusing a window that hasn't reported changes nothing",
    before: [[1, { kind: "ready", viewed: null }]],
    event: { kind: "focused", window: 2 },
    after: [[1, { kind: "ready", viewed: null }]],
  },
  {
    name: "a second click while loading wins",
    before: [
      [1, { kind: "loading", opening: viewed }],
      [2, { kind: "ready", viewed: null }],
    ],
    event: { kind: "clicked", window: 1, session: opening },
    after: [
      [1, { kind: "loading", opening }],
      [2, { kind: "ready", viewed: null }],
    ],
    reveal: 1,
  },
])("$name", (row) => {
  const step = stepWindowAttention(new Map(row.before), row.event);

  expect({ windows: [...step.windows], reveal: step.reveal, open: step.open }).toEqual({
    windows: row.after,
    reveal: row.reveal,
    open: row.open,
  });
});

test.each<{
  readonly name: string;
  readonly windows: readonly (readonly [number, WindowAttention])[];
  readonly viewer: number | undefined;
}>([
  {
    name: "no window views the chat",
    windows: [[1, { kind: "ready", viewed: null }]],
    viewer: undefined,
  },
  {
    name: "the most recently focused viewer wins",
    windows: [
      [3, { kind: "ready", viewed: null }],
      [2, { kind: "ready", viewed: "viewed" }],
      [1, { kind: "ready", viewed: "viewed" }],
    ],
    viewer: 1,
  },
  {
    name: "a loading window isn't a viewer, even loading the chat",
    windows: [
      [2, { kind: "ready", viewed: "viewed" }],
      [1, { kind: "loading", opening: viewed }],
    ],
    viewer: 2,
  },
])("finding the viewer: $name", (row) => {
  expect(findViewer(new Map(row.windows), viewed)).toBe(row.viewer);
});

function reminding(id: string, title = id): AttentionReminder {
  return {
    id,
    delivery: {
      session: asId<"session">(id),
      state: "waiting",
      title,
      body: "Still needs your answer",
      notify: true,
      sound: true,
      bounce: false,
    },
  };
}

interface Reminding {
  readonly every: number;
  readonly reminders: readonly (readonly [string, string?])[];
}

test.each<{
  readonly name: string;
  readonly before: Reminding;
  readonly after: Reminding;
  readonly stop: readonly string[];
  readonly start: readonly string[];
}>([
  {
    name: "a new reminder starts",
    before: { every: 60_000, reminders: [] },
    after: { every: 60_000, reminders: [["a"]] },
    stop: [],
    start: ['a "a"'],
  },
  {
    name: "an unchanged reminder runs on",
    before: { every: 60_000, reminders: [["a"]] },
    after: { every: 60_000, reminders: [["a"]] },
    stop: [],
    start: [],
  },
  {
    name: "a changed interval starts the reminder again",
    before: { every: 120_000, reminders: [["a"]] },
    after: { every: 60_000, reminders: [["a"]] },
    stop: ["a"],
    start: ['a "a"'],
  },
  {
    name: "a changed delivery starts the reminder again",
    before: { every: 60_000, reminders: [["a", "Old name"]] },
    after: { every: 60_000, reminders: [["a", "New name"]] },
    stop: ["a"],
    start: ['a "New name"'],
  },
  {
    name: "a reminder no longer wanted stops",
    before: { every: 60_000, reminders: [["a"], ["b"]] },
    after: { every: 60_000, reminders: [["b"]] },
    stop: ["a"],
    start: [],
  },
  {
    name: "stops follow the held order and starts the plan's",
    before: { every: 60_000, reminders: [["b"], ["a", "Old name"], ["c"]] },
    after: { every: 60_000, reminders: [["d"], ["a", "New name"], ["b"]] },
    stop: ["a", "c"],
    start: ['d "d"', 'a "New name"'],
  },
])("reminders: $name", (row) => {
  const wanted = (plan: Reminding) => plan.reminders.map((entry) => reminding(entry[0], entry[1]));

  const held = new Map(
    reconcileReminders(new Map(), wanted(row.before), row.before.every).start.map((reminder) => [
      reminder.id,
      reminder,
    ]),
  );

  const changes = reconcileReminders(held, wanted(row.after), row.after.every);

  expect({
    stop: changes.stop,
    start: changes.start.map((reminder) => `${reminder.id} "${reminder.delivery.title}"`),
  }).toEqual({ stop: row.stop, start: row.start });

  for (const id of changes.stop) held.delete(id);

  for (const reminder of changes.start) held.set(reminder.id, reminder);
  expect(reconcileReminders(held, wanted(row.after), row.after.every)).toEqual({
    stop: [],
    start: [],
  });
});
