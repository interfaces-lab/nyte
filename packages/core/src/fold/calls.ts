import type {
  CallId,
  HeadName,
  Json,
  PartId,
  ToolClass,
  ToolOutcome,
  TurnInfo,
} from "@nyte-ai/schema";
import type { Draft, FoldTurn, Logged } from "../contract/fold.ts";
import { isJsonObject } from "../util/json-schema.ts";
import { liveRun, setTurn, updatePart } from "./draft.ts";

export function applyCall(draft: Draft, event: Logged<"call">): void {
  const call = draft.calls.get(event.call);

  switch (event.change) {
    case "intent": {
      draft.calls.set(event.call, {
        part: event.part,
        class: event.class,
        waiting: null,
        settled: false,
      });

      updatePart(draft, event.part, (part) => ({
        ...part,
        state: {
          call: event.call,
          name: event.name,
          args: event.args,
          class: event.class,
          phase: "running",
          progress: null,
        },
        version: part.version + 1,
      }));
      const turn = callTurn(draft, event.part, event.head);

      if (turn !== undefined)
        setTurn(
          draft,
          withActivity(draft, {
            ...turn,
            live: [...turn.live.filter((id) => id !== event.call), event.call],
          }),
        );

      return;
    }

    case "waiting":
      if (call !== undefined) draft.calls.set(event.call, { ...call, waiting: event.on });

      return updatePart(draft, event.part, (part) =>
        (part.status.kind === "live" || part.status.kind === "waiting") && part.status.run !== null
          ? { ...part, status: { kind: "waiting", run: part.status.run, on: event.on } }
          : part,
      );
    case "settled": {
      if (call !== undefined)
        draft.calls.set(event.call, { ...call, waiting: null, settled: true });

      updatePart(draft, event.part, (part) => ({
        ...part,
        state: settledState(part.state, event.outcome, event.changes),
        version: part.version + 1,
        status:
          part.status.kind === "waiting" ? { kind: "live", run: part.status.run } : part.status,
      }));
      const turn = callTurn(draft, event.part, event.head);

      if (turn === undefined) return;

      const summary =
        call === undefined
          ? turn.info.summary
          : summarise(turn.info.summary, call.class, event.outcome, event.changes);

      setTurn(
        draft,
        withActivity(draft, {
          ...turn,
          live: turn.live.filter((id) => id !== event.call),
          info: { ...turn.info, summary },
        }),
      );
    }
  }
}

function callTurn(draft: Draft, part: PartId, head: HeadName | null): FoldTurn | undefined {
  const record = draft.parts.get(part);

  const run =
    record !== undefined && record.run !== null
      ? draft.runs.get(record.run)
      : head === null
        ? undefined
        : liveRun(draft, head);

  return run === undefined ? undefined : draft.turns.get(run.turn);
}

function withActivity(draft: Draft, turn: FoldTurn): FoldTurn {
  if (turn.info.state.kind !== "working") return turn;
  const activity = describeLiveActivity(draft, turn.live);

  if (turn.info.state.activity === activity) return turn;

  return { ...turn, info: { ...turn.info, state: { kind: "working", activity } } };
}

export function describeLiveActivity(draft: Draft, live: readonly CallId[]): string | null {
  const newest = live.at(-1);
  const call = newest === undefined ? undefined : draft.calls.get(newest);

  if (call === undefined) return null;

  switch (call.class.kind) {
    case "read":
    case "list":
      return "Exploring";
    case "edit":
      return "Editing";
    case "shell":
      return "Running";
    case "delegate":
      return "Delegating";
    case "custom":
      return call.class.label;
  }
}

function summarise(
  summary: TurnInfo["summary"],
  tool: ToolClass,
  outcome: ToolOutcome,
  changes: {
    readonly added: number;
    readonly removed: number;
    readonly paths: readonly string[];
  } | null,
): TurnInfo["summary"] {
  const added = summary.added + (changes?.added ?? 0);
  const removed = summary.removed + (changes?.removed ?? 0);

  if (outcome.kind === "stopped")
    return { ...summary, stopped: summary.stopped + 1, added, removed };

  if (outcome.kind !== "ok") return { ...summary, failed: summary.failed + 1, added, removed };
  const kind = tool.kind;

  const entry = summary.byClass[kind];
  const touched = ["path" in tool ? [tool.path] : [], changes?.paths ?? []].flat();

  const paths = [
    ...entry.paths,
    ...[...new Set(touched)].filter((path) => !entry.paths.includes(path)),
  ];

  return {
    ...summary,
    added,
    removed,
    byClass: { ...summary.byClass, [kind]: { count: entry.count + 1, paths } },
  };
}

function settledState(
  state: Json,
  outcome: ToolOutcome,
  changes: {
    readonly added: number;
    readonly removed: number;
    readonly paths: readonly string[];
  } | null,
): Json {
  const fields = isJsonObject(state)
    ? Object.fromEntries(Object.entries(state).filter(([key]) => key !== "progress"))
    : {};

  return { ...fields, phase: "settled", outcome, changes };
}
