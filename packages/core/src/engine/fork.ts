import { asId, asSeq } from "@nyte-ai/schema";
import type {
  CommitId,
  DurableEvent,
  ForkOutcome,
  MessageId,
  PartId,
  RunId,
  Seq,
  SessionEvent,
  SessionId,
} from "@nyte-ai/schema";
import type { ConnectionContext } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import type { HeadRecord, SeenRecord, SessionRecord } from "../contract/records.ts";
import type { StoreConnection } from "../contract/store.ts";
import { commit } from "../fold/commit.ts";
import { walkCommitPath } from "../fold/paths.ts";
import { headRef, partRef, promptRef, seenRef, sessionRef } from "../store/refs.ts";
import {
  attempt,
  MAIN,
  put,
  readTip,
  requireSession,
  sessionEvent,
  STALE,
  toCommitObjectId,
} from "../store/session.ts";

const LOG_PAGE = 256;

interface Kept {
  readonly path: ReadonlySet<CommitId>;
  readonly prompts: ReadonlySet<MessageId>;
  readonly parts: ReadonlySet<PartId>;
  readonly runs: ReadonlySet<RunId>;
}

type History =
  | {
      readonly kind: "ready";
      readonly events: readonly DurableEvent[];
      readonly parts: readonly PartId[];
      readonly lastRun: HeadRecord["lastRun"];
    }
  | Exclude<ForkOutcome, { readonly kind: "forked" }>;

export async function forkSession(
  kernel: Kernel,
  context: ConnectionContext,
  source: SessionId,
  from: CommitId | undefined,
): Promise<ForkOutcome> {
  const id = asId<"session">(crypto.randomUUID());

  return attempt(`Forking ${source}`, async () => {
    const found = await requireSession(kernel.store, source);
    const tip = from ?? (await readTip(kernel.store, source, MAIN)).id;

    if (tip === null) return { kind: "missing-source" };
    const log = await readLog(kernel.store, source, asSeq(0));
    const history = forkHistory(log, tip);

    if (history.kind !== "ready") return history;

    const shared = await Promise.all(
      history.parts.map(async (part) => ({
        part,
        target: (await kernel.store.refs.get(partRef(source, part)))?.target ?? null,
      })),
    );

    if (shared.some((entry) => entry.target === null)) return { kind: "missing-source" };
    const read = log.at(-1)?.seq ?? asSeq(0);

    const changed = (await readLog(kernel.store, source, read)).some(
      (event) => event.kind === "part" && history.parts.includes(event.part),
    );

    if (changed) return STALE;
    const prompt = (await kernel.store.refs.get(promptRef(source, MAIN)))?.target ?? null;
    const main = found.record.heads.find((head) => head.name === MAIN);
    const at = Date.now();

    const record: SessionRecord = {
      id,
      name: found.record.name,
      parent: null,
      origin: null,
      workspace: found.record.workspace,
      pinned: false,
      archived: false,
      createdAt: at,
      lastActivityAt: at,
      heads: [
        {
          name: MAIN,
          stack: null,
          selected: main?.selected ?? null,
          lastRun: history.lastRun,
          response: main?.lastRun?.id === history.lastRun?.id ? main?.response : undefined,
        },
      ],
      prompt: found.record.prompt,
      contextFiles: found.record.contextFiles,
    };

    const seen: SeenRecord = { commit: tip };

    const outcome = await commit(kernel, [
      {
        name: sessionRef(id),
        target: await put(kernel.store, "session", record, at),
        expect: "absent",
        fences: [sessionRef(source)],
        events: [await sessionEvent(kernel, record), ...history.events],
      },
      {
        name: headRef(id, MAIN),
        target: toCommitObjectId(tip),
        expect: "absent",
        events: [{ head: MAIN, kind: "head", from: null, to: tip, reason: "created" }],
      },
      {
        name: seenRef(id, context.principal, MAIN),
        target: await put(kernel.store, "seen", seen),
        expect: "absent",
        events: [{ head: MAIN, kind: "seen", principal: context.principal, commit: tip }],
      },
      ...shared.flatMap((entry) =>
        entry.target === null
          ? []
          : [{ name: partRef(id, entry.part), target: entry.target, expect: "absent" as const }],
      ),
      ...(prompt === null
        ? []
        : [{ name: promptRef(id, MAIN), target: prompt, expect: "absent" as const }]),
    ]);

    if (outcome.kind === "fenced") return { kind: "missing-source" };

    return outcome.kind === "set" ? { kind: "forked", session: id } : STALE;
  });
}

function forkHistory(log: readonly SessionEvent[], tip: CommitId): History {
  const commits = new Map(
    log.flatMap((event) => (event.kind === "commit" ? [[event.id, event] as const] : [])),
  );

  if (!commits.has(tip)) return { kind: "missing-source" };
  const path = new Set(walkCommitPath(commits, tip));
  const bodies = [...path].flatMap((commit) => commits.get(commit)?.body ?? []);
  const parts = new Set(bodies.flatMap((body) => (body.kind === "user" ? [] : [body.part])));

  const runs = new Set(
    log.flatMap((event): readonly RunId[] => {
      if (event.kind === "commit" && path.has(event.id) && event.run !== null) return [event.run];

      return event.kind === "part" &&
        event.change === "created" &&
        parts.has(event.part) &&
        event.run !== null
        ? [event.run]
        : [];
    }),
  );

  const ends = log.flatMap((event) =>
    event.kind === "run" && event.change === "ended" && runs.has(event.run) ? [event] : [],
  );

  const live = [...runs].find((run) => !ends.some((end) => end.run === run));

  if (live !== undefined) return { kind: "busy", run: live };

  const kept: Kept = {
    path,
    prompts: new Set(bodies.flatMap((body) => (body.kind === "user" ? [body.message] : []))),
    parts,
    runs,
  };

  const last = ends.at(-1);

  return {
    kind: "ready",
    events: log.flatMap((event) => {
      const copy = keep(event, kept);

      return copy === null ? [] : [onMain(copy)];
    }),
    parts: [...parts],
    lastRun: last === undefined ? null : { id: last.run, end: last.end, endedAt: last.at },
  };
}

function keep(event: SessionEvent, kept: Kept): SessionEvent | null {
  switch (event.kind) {
    case "commit":
      if (!kept.path.has(event.id)) return null;

      return event.body.kind === "user"
        ? { ...event, body: { ...event.body, siblings: [] } }
        : event;
    case "input":
      return kept.prompts.has(event.message) ? event : null;
    case "part":
    case "call":
      return kept.parts.has(event.part) ? event : null;
    case "run":
      if (!kept.runs.has(event.run)) return null;

      return event.change === "started" ? { ...event, view: { ...event.view, head: MAIN } } : event;
    case "configured":
      return event.head === MAIN ? event : null;
    case "head":
    case "seen":
    case "background":
    case "request":
    case "changes":
    case "session":
    case "activation":
    case "catalog":
      return null;
    default: {
      const _exhaustive: never = event;

      return _exhaustive;
    }
  }
}

function onMain(event: SessionEvent): DurableEvent {
  const copy = { ...event, head: event.head === null ? null : MAIN, seq: undefined };

  return copy;
}

async function readLog(
  store: StoreConnection,
  session: SessionId,
  after: Seq,
): Promise<readonly SessionEvent[]> {
  const events: SessionEvent[] = [];

  for (;;) {
    const page = await store.refs.log(session, events.at(-1)?.seq ?? after, LOG_PAGE);
    events.push(...page);

    if (page.length < LOG_PAGE) return events;
  }
}
