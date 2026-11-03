import type { ToolDefinition } from "@nyte-ai/core";
import { asId, asSeq, standard } from "@nyte-ai/schema";
import type {
  CommitId,
  FileChange,
  HeadName,
  SessionCatalogView,
  SessionEvent,
  SessionId,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import { fakeModels, open, until } from "./fake-models.ts";
import type { Composed, FakeModels } from "./fake-models.ts";

export interface Recorded {
  readonly name: string;
  readonly session: SessionId;
  readonly heads: readonly HeadName[];
  readonly events: readonly SessionEvent[];
}

export const MAIN: HeadName = asId("main");

const SIDE: HeadName = asId("side");

const say = standard(Type.Object({ text: Type.String() }));

const echo: ToolDefinition<{ readonly text: string }> = {
  name: "echo",
  description: "Echo the text.",
  parameters: say,
  class: () => ({ kind: "read", path: "notes.md" }),
  replay: "safe",
  effects: "none",
  execute: async (args) => ({ content: [{ kind: "text", text: `echo: ${args.text}` }] }),
};

const boom: ToolDefinition<{ readonly text: string }> = {
  name: "boom",
  description: "Fail.",
  parameters: say,
  class: () => ({ kind: "custom", label: "Failing" }),
  replay: "safe",
  effects: "none",
  execute: async () => {
    throw new Error("Boom.");
  },
};

function gated(gate: Promise<void>): ToolDefinition<{ readonly text: string }> {
  return {
    name: "wait",
    description: "Wait for the gate.",
    parameters: say,
    class: () => ({ kind: "custom", label: "Waiting" }),
    replay: "safe",
    effects: "none",
    async execute() {
      await gate;

      return { content: [{ kind: "text", text: "waited" }] };
    },
  };
}

export async function recordSessions(): Promise<readonly Recorded[]> {
  return [
    await record("tools", [MAIN], async (host, fake, id) => {
      fake.reply(
        {
          content: [
            { type: "thinking", thinking: "Plan two echoes.", signature: "sig-1" },
            { type: "toolCall", id: "a", name: "echo", arguments: { text: "a" } },
            { type: "toolCall", id: "b", name: "echo", arguments: { text: "b" } },
          ],
        },
        { content: [{ type: "text", text: "Both echoed.", signature: "sig-2" }] },
        { content: [{ type: "toolCall", id: "c", name: "boom", arguments: { text: "c" } }] },
        { content: [{ type: "text", text: "It failed." }] },
      );
      const started = await host.sessions.start({ id, content: "Echo twice." });
      await started.receipt.settled();
      await (await started.session.send("Now fail.")).settled();
    }),
    await record("queue", [MAIN], async (host, fake, id, release) => {
      fake.reply(
        { content: [{ type: "toolCall", id: "w", name: "wait", arguments: { text: "w" } }] },
        { content: [{ type: "text", text: "Saw the steer." }] },
        { content: [{ type: "text", text: "Answered the queue." }] },
      );
      const started = await host.sessions.start({ id, content: "Start." });
      const session = started.session;

      await until(async () =>
        (await session.view()).messages.some(
          (message) =>
            message.kind === "part" &&
            message.partKind === "tool" &&
            message.status.kind === "live",
        )
          ? true
          : undefined,
      );
      const queued = await session.send("Later.", { delivery: "queue" });
      const steered = await session.send("Also this.", { delivery: "steer" });
      release();
      await started.receipt.settled();
      await steered.settled();
      await queued.settled();
    }),
    await record("stop", [MAIN], async (host, fake, id) => {
      fake.reply(
        { content: [{ type: "text", text: "A partial answer" }], hold: true },
        { content: [{ type: "text", text: "A whole answer." }] },
      );
      const started = await host.sessions.start({ id, content: "Go." });
      const session = started.session;

      await until(async () =>
        (await session.view()).messages.some(
          (message) => message.kind === "part" && message.status.kind === "live",
        )
          ? true
          : undefined,
      );
      await started.receipt.stop();
      await started.receipt.settled();
      await (await session.send("Again.")).settled();
    }),
    await record("replace", [MAIN, SIDE], async (host, fake, id) => {
      fake.reply(
        { content: [{ type: "text", text: "One answer." }] },
        { content: [{ type: "text", text: "Two answer." }] },
        { content: [{ type: "text", text: "Two v2 answer." }] },
        { content: [{ type: "text", text: "Three answer." }] },
        { content: [{ type: "text", text: "Side answer." }] },
      );
      const started = await host.sessions.start({ id, content: "One." });
      const session = started.session;
      await started.receipt.settled();
      const second = await session.send("Two.");
      await second.settled();
      await (await session.send("Two v2.", { replace: second.message })).settled();
      const branch = findNode(await session.tree(), "Two answer.");
      await (await session.move({ kind: "commit", id: branch })).settled();
      const first = findNode(await session.tree(), "One answer.");
      await (await session.move({ kind: "commit", id: first })).settled();
      await (await session.send("Three.")).settled();
      await session.heads.create(SIDE);
      await (await session.head(SIDE).send("Side.")).settled();
    }),
  ];
}

export async function recordLong(turns: number): Promise<Recorded> {
  return record("long", [MAIN], async (host, fake, id) => {
    const reply = (turn: number) =>
      fake.reply(
        {
          content: [
            { type: "toolCall", id: `t${turn}`, name: "echo", arguments: { text: `${turn}` } },
          ],
        },
        { content: [{ type: "text", text: `Answer ${turn}.` }] },
      );

    reply(0);
    const started = await host.sessions.start({ id, content: "Turn 0." });
    await started.receipt.settled();

    for (let turn = 1; turn < turns; turn += 1) {
      reply(turn);
      await (await started.session.send(`Turn ${turn}.`)).settled();
    }
  });
}

async function record(
  name: string,
  heads: readonly HeadName[],
  drive: (host: Composed, fake: FakeModels, id: SessionId, release: () => void) => Promise<void>,
): Promise<Recorded> {
  const fake = fakeModels();
  const gate = Promise.withResolvers<void>();
  const session = asId<"session">(name);

  await using host = await open(fake, [
    { id: "tools", contribute: { tools: [echo, boom, gated(gate.promise)] } },
  ]);

  await drive(host, fake, session, gate.resolve);

  return {
    name,
    session,
    heads,
    events: await host.kernel.store.refs.log(session, asSeq(0), 1_000_000),
  };
}

function findNode(
  tree: { readonly nodes: readonly { readonly id: CommitId; readonly preview: string }[] },
  preview: string,
): CommitId {
  const node = tree.nodes.find((entry) => entry.preview === preview);

  if (node === undefined) throw new Error(`No commit previews ${preview}.`);

  return node.id;
}

export function random(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function interleave(
  recorded: Recorded,
  next: () => number,
  principal: string,
): readonly SessionEvent[] {
  const commits: CommitId[] = [];
  const events: SessionEvent[] = [];
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)];

  for (const event of recorded.events) {
    events.push(event);

    if (event.kind === "commit" && event.head === MAIN) commits.push(event.id);

    if (next() > 0.15) continue;
    const at = event.at;

    switch (pick(["changes", "merged", "catalog", "seen", "background", "removed"])) {
      case "changes":
        events.push({ seq: asSeq(0), at, head: null, kind: "changes", files: files(next) });
        break;
      case "merged":
        events.push({
          seq: asSeq(0),
          at,
          head: null,
          kind: "changes",
          change: "merged",
          files: files(next),
          cleared: [pick(PATHS)],
        });
        break;
      case "catalog":
        events.push({ seq: asSeq(0), at, head: null, kind: "catalog", catalog: catalog(next) });
        break;
      case "seen":
        if (commits.length > 0)
          events.push({
            seq: asSeq(0),
            at,
            head: MAIN,
            kind: "seen",
            principal: asId(principal),
            commit: pick(commits),
          });
        break;
      case "background":
        events.push({ seq: asSeq(0), at, head: MAIN, kind: "background", item: job(next) });
        break;
      case "removed":
        events.push({
          seq: asSeq(0),
          at,
          head: MAIN,
          kind: "background",
          change: "removed",
          item: job(next),
        });
    }
  }

  return events.map((event, index) => ({ ...event, seq: asSeq(index + 1) }));
}

const PATHS = ["a.ts", "b.ts", "c.ts", "d.ts"];

function files(next: () => number): FileChange[] {
  return PATHS.flatMap((path): FileChange[] =>
    next() < 0.5
      ? [
          {
            path,
            status: next() < 0.5 ? "modified" : "added",
            added: Math.floor(next() * 3),
            removed: 0,
          },
        ]
      : [],
  );
}

function catalog(next: () => number): SessionCatalogView {
  return {
    commands: ["review", "ship"].flatMap((name) =>
      next() < 0.6
        ? [
            {
              name,
              owner: "test",
              side: "core",
              title: name,
              description: next() < 0.5 ? "Old." : "New.",
              takesText: false,
              completes: false,
            } as const,
          ]
        : [],
    ),
    settings: [],
    skills: ["notes"].flatMap((name) =>
      next() < 0.6 ? [{ name, owner: "test", description: "Notes.", location: "notes.md" }] : [],
    ),
    agents: [],
    tools: [],
  };
}

function job(next: () => number) {
  return {
    kind: "job",
    id: next() < 0.5 ? "j1" : "j2",
    title: "Job",
    state: next() < 0.5 ? "working" : "done",
    startedBy: null,
  } as const;
}
