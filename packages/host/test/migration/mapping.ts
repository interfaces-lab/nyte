import { decodeCallRecord, decodeRunRecord, parseSessionRef, trustRef } from "@nyte-ai/core/store";
import type { CallRecord } from "@nyte-ai/core/store";
import {
  compile,
  FileStatusType,
  HunkType,
  isJsonObject,
  JsonType,
  ToolCallType,
  withJson,
  WorkspaceTargetType,
  writePatch,
} from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";

type JsonObject = { readonly [key: string]: Json };

/**
 * What migrating a store changes, one row per store step: `version` is the
 * stamp a store holds once the step has run, so a store stamped below it runs
 * it. Every field a row does not name is kept as it was, every object row is
 * kept (content addressing never deletes one), and every logged event keeps
 * its session, seq and time. `covers` names the tallies a property run must
 * count at least once to have exercised the row: the store stamp just below
 * the row's version, and each field or ref the row changes (`call/*` for a
 * call of any kind).
 */
export const MAPPING = [
  {
    version: 1,
    step: "baseline",
    target: "tables",
    change: "creates objects, refs, log and store_meta",
    covers: ["from 0"],
  },
  {
    version: 2,
    step: "2026-10-12-record-fields",
    target: "call, inbox, run and principals records",
    change:
      "call gains `reran: null`, inbox `pendingInput: []`, run `waitedBy: []`, `parked: []` and `lastSnapshot: null`, each only where absent; principals drops each entry's `lastSeenAt` and gains `codes: []` where absent, unless no entry has `lastSeenAt` and `codes` exists (a missing `principals` list becomes [])",
    covers: [
      "from 1",
      "field call/* /body/reran",
      "field inbox /body/pendingInput",
      "field run /body/waitedBy",
      "field run /body/parked",
      "field run /body/lastSnapshot",
      "field principals /body/codes",
      "field principals /body/principals/*/lastSeenAt",
    ],
  },
  {
    version: 3,
    step: "2026-10-14-session-index",
    target: "tables",
    change: "creates session_index and pending_work",
    covers: ["from 2"],
  },
  {
    version: 4,
    step: "2026-10-14-session-index-order",
    target: "tables",
    change: "recreates session_index and pending_work and rebuilds both from every ref",
    covers: ["from 3"],
  },
  {
    version: 5,
    step: "2026-10-15-log-kind-index",
    target: "tables",
    change: "creates the log_kind index",
    covers: ["from 4"],
  },
  {
    version: 6,
    step: "2026-10-15-workspace-trust",
    target: "workspace records",
    change: "`projectResources: true` becomes null; false and null are kept",
    covers: ["from 5", "field workspace /body/projectResources"],
  },
  {
    version: 7,
    step: "2026-10-16-patch-text",
    target:
      "call `result.output` and `nested.<key>.output`, part `state.outcome.output`, logged call/settled `outcome.output`",
    change:
      'an output `{ path, status, kind: "text", hunks, ...rest }` becomes `{ path, status, kind: "text", ...rest, patch: writePatch(path, status, hunks) }`; any other output is kept',
    covers: [
      "from 6",
      "field call/* /body/result/output/patch",
      "field call/* /body/nested/*/output/patch",
      "field part /body/state/outcome/output/patch",
      "field log call/settled /outcome/output/patch",
    ],
  },
  {
    version: 8,
    step: "2026-10-16-call-intent-once",
    target: "logged call/intent and part/created events",
    change:
      "a call/intent event holding `name`, `args` and `class`, whose part has an earlier part/created event with an object `state`, keeps every other field; that part/created event's `state` takes the intent's `name`, `args` and `class` where any of them differs",
    covers: ["from 7", "field log call/intent /name", "field log part/created /state/name"],
  },
  {
    version: 9,
    step: "2026-10-16-live-refs",
    target: "refs",
    change:
      "adds `sessions/<s>/live/<run>` at the record of `sessions/<s>/runs/<run>` for each run record whose `view.id` is `<run>` and that is not stopping, unless the ref exists",
    covers: ["from 8", "added sessions/*/live"],
  },
  {
    version: 10,
    step: "2026-10-16-wait-index",
    target: "refs",
    change:
      "adds the `waits/` index refs of each unsettled call record at `sessions/<s>/calls/<call>`, at that record, unless they exist",
    covers: [
      "from 9",
      "added waits/run",
      "added waits/part",
      "added waits/job",
      "added waits/time",
      "added waits/input",
    ],
  },
  {
    version: 11,
    step: "2026-10-16-tool-args-in-part",
    target: "call records of kind tool",
    change: "an object `intent` drops `name` and `args`",
    covers: ["from 10", "field call/tool /body/intent/name", "field call/tool /body/intent/args"],
  },
  {
    version: 12,
    step: "2026-10-16-intent-position",
    target: "call records of kind intent",
    change: "an object `intent` without `position` gains `position: 0`",
    covers: ["from 11", "field call/intent /body/intent/position"],
  },
  {
    version: 13,
    step: "2026-10-16-woken-index",
    target: "refs",
    change:
      "adds `waits/woken/<s>/<call>` at the record of each call at `sessions/<s>/calls/<call>` with no result, no current wait and at least one finished wait, unless the ref exists",
    covers: ["from 12", "added waits/woken"],
  },
  {
    version: 14,
    step: "2026-10-16-hook-tool-args",
    target: "call records of kind hook whose id starts `hook:before_tool:`",
    change:
      'an object `intent` holding `args` becomes `{ principal }` (null where absent); a `modify` result whose value is a ToolCall, the only one the old decoder read, becomes `{ action: "modify", value: <value.args> }`; any other result is kept',
    covers: [
      "from 13",
      "field call/hook /body/intent/args",
      "field call/hook /body/intent/principal",
      "field call/hook /body/result/value",
      "hook decisions read alike",
      "hook decisions kept unreadable",
    ],
  },
  {
    version: 15,
    step: "2026-10-16-ended-run-records",
    target: "refs",
    change:
      "adds `sessions/<s>/ended/<run>` for each run that only session `<s>`'s log ended, whose `sessions/<s>` ref exists and whose `runs/` and `ended/` refs don't, at the run's latest record holding a snapshot (greatest `at`, then id) when that record reads as today's run record",
    covers: ["from 14", "added sessions/*/ended"],
  },
  {
    version: 16,
    step: "2026-10-16-workspace-isolation",
    target: "workspace records",
    change: "gains `isolation: null` where absent",
    covers: ["from 15", "field workspace /body/isolation"],
  },
  {
    version: 17,
    step: "2026-10-16-fold-checkpoints",
    target: "tables",
    change: "creates fold_checkpoints (sqlite only)",
    covers: ["from 16"],
  },
  {
    version: 18,
    step: "2026-10-17-folder-trust",
    target: "refs",
    change:
      "adds `trust/<folder key>` for each folder a workspace record without `isolation` decided with a boolean `projectResources` (as the record reads once step 6 ran), unless the ref exists: a trust record `{ target, trusted }` with a local path's trailing slashes dropped, written at the deciding record's `at`; among records of one folder the greatest `at` wins, then a decline",
    covers: ["from 17", "added trust/*/"],
  },
  {
    version: 19,
    step: "2026-10-17-workspace-trust-moved",
    target: "workspace records",
    change: "`projectResources` is removed",
    covers: ["from 18", "field workspace /body/projectResources"],
  },
  {
    version: 20,
    step: "2026-10-18-session-snapshot-dropped",
    target: "tables",
    change: "nothing",
    covers: ["from 19"],
  },
  {
    version: 21,
    step: "2026-10-20-changes-as-whole-list",
    target: "logged changes events",
    change:
      "`files` becomes the list a session's earlier `changes` events merged into, in seq order across heads: each entry with a string `path` replaces the listed entry of that path in its place or joins the end; an event already holding that list is kept",
    covers: ["from 20", "field log changes /files"],
  },
  {
    version: 22,
    step: "2026-10-20-fold-checkpoints-cleared",
    target: "tables",
    change: "empties fold_checkpoints (sqlite only)",
    covers: ["from 21"],
  },
  {
    version: 23,
    step: "2026-10-26-models-per-request",
    target: "logged part, request and input events",
    change:
      "a text, thinking or tool part's `created` event without `model` gains the model of its run's `started` view, when that view names one; a `request` event without `model` gains the model of the latest run started on its head before it, or null; an input event's schedule with reason `configuration` takes reason `run-ended`",
    covers: [
      "from 22",
      "field log part/created /model",
      "field log request /model",
      "field log input/scheduled /schedule/reason",
    ],
  },
] as const;

function decisionType<T extends TSchema>(value: T) {
  return Type.Union([
    Type.Object({ action: Type.Literal("continue") }),
    Type.Object({ action: Type.Literal("modify"), value }),
    Type.Object({ action: Type.Literal("reject"), reason: Type.String() }),
    Type.Object({ action: Type.Literal("error"), message: Type.String() }),
  ]);
}

const WORKSPACE_TARGET = compile(withJson(WorkspaceTargetType));

/** A before_tool hook call's result as store version 13 decoded it: a `modify` holds the whole changed ToolCall. */
const OLD_TOOL_DECISION = compile(withJson(decisionType(ToolCallType)));

/** A before_tool hook call's result as today's store decodes it: a `modify` holds the changed args alone. */
const TOOL_DECISION = compile(withJson(decisionType(JsonType)));

/** The decision a before_tool hook call's stored result held for store version 13, or null when that decoder could not read it. */
export function readOldToolDecision(result: Json | undefined) {
  return result !== undefined && OLD_TOOL_DECISION.Check(result)
    ? OLD_TOOL_DECISION.Decode(result)
    : null;
}

/** The decision a before_tool hook call's stored result holds today, or null when it can't be read. */
export function readToolDecision(result: Json | undefined) {
  return result !== undefined && TOOL_DECISION.Check(result) ? TOOL_DECISION.Decode(result) : null;
}

/** Whether the step a store reaches `version` with runs on a store stamped `from`. */
function runs(from: number, version: number): boolean {
  return from < version;
}

const LEGACY_PATCH = compile(
  Type.Object({
    path: Type.String(),
    status: FileStatusType,
    kind: Type.Literal("text"),
    hunks: Type.Array(HunkType),
  }),
);

function unifiedOutcome(outcome: Json | undefined): Json | undefined {
  if (!isJsonObject(outcome)) return outcome;
  const output = outcome.output;

  if (!isJsonObject(output) || !LEGACY_PATCH.Check(output)) return outcome;
  const { hunks, ...entry } = output;

  return { ...outcome, output: { ...entry, patch: writePatch(output.path, output.status, hunks) } };
}

function without(object: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
}

function withDefaults(body: JsonObject, defaults: JsonObject): JsonObject {
  return { ...defaults, ...body };
}

function migrateCall(from: number, body: JsonObject): JsonObject {
  let next = body;

  if (runs(from, 2)) next = withDefaults(next, { reran: null });

  if (runs(from, 7)) {
    const nested = isJsonObject(next.nested) ? next.nested : null;
    next = {
      ...next,
      ...("result" in next && { result: unifiedOutcome(next.result) ?? null }),
      ...(nested !== null && {
        nested: Object.fromEntries(
          Object.entries(nested).map(([key, outcome]) => [key, unifiedOutcome(outcome) ?? null]),
        ),
      }),
    };
  }

  const intent = next.intent;

  if (runs(from, 11) && next.kind === "tool" && isJsonObject(intent))
    next = { ...next, intent: without(intent, ["name", "args"]) };

  if (
    runs(from, 12) &&
    next.kind === "intent" &&
    isJsonObject(next.intent) &&
    !("position" in next.intent)
  )
    next = { ...next, intent: { ...next.intent, position: 0 } };

  if (
    runs(from, 14) &&
    next.kind === "hook" &&
    typeof next.id === "string" &&
    next.id.startsWith("hook:before_tool:")
  ) {
    const hookIntent = next.intent;
    const result = next.result;

    if (isJsonObject(hookIntent) && "args" in hookIntent)
      next = { ...next, intent: { principal: hookIntent.principal ?? null } };

    const decision = readOldToolDecision(result);

    if (decision?.action === "modify")
      next = { ...next, result: { action: "modify", value: decision.value.args } };
  }

  return next;
}

function migratePrincipals(body: JsonObject): JsonObject {
  const principals = Array.isArray(body.principals) ? body.principals : [];

  if (!principals.some((entry) => isJsonObject(entry) && "lastSeenAt" in entry) && "codes" in body)
    return body;

  return {
    ...withDefaults(body, { codes: [] }),
    principals: principals.map((entry) =>
      isJsonObject(entry) ? without(entry, ["lastSeenAt"]) : entry,
    ),
  };
}

function migrateBody(from: number, kind: Json | undefined, body: JsonObject): JsonObject {
  switch (kind) {
    case "call":
      return migrateCall(from, body);
    case "inbox":
      return runs(from, 2) ? withDefaults(body, { pendingInput: [] }) : body;
    case "run":
      return runs(from, 2)
        ? withDefaults(body, { waitedBy: [], parked: [], lastSnapshot: null })
        : body;
    case "principals":
      return runs(from, 2) ? migratePrincipals(body) : body;
    case "workspace": {
      const trusted = workspaceTrustAt6(from, body);
      const isolated = runs(from, 16) ? withDefaults(trusted, { isolation: null }) : trusted;

      return runs(from, 19) ? without(isolated, ["projectResources"]) : isolated;
    }
    case "part": {
      const state = body.state;

      return runs(from, 7) && isJsonObject(state)
        ? {
            ...body,
            state: {
              ...state,
              ...("outcome" in state && { outcome: unifiedOutcome(state.outcome) ?? null }),
            },
          }
        : body;
    }

    default:
      return body;
  }
}

function workspaceTrustAt6(from: number, body: JsonObject): JsonObject {
  return runs(from, 6) && body.projectResources === true
    ? { ...body, projectResources: null }
    : body;
}

/**
 * The `trust/` refs a store stamped `from` adds by `MAPPING`'s step 18, each
 * with the record it points at, from the store's workspace records as they
 * stood before migration.
 */
export async function folderTrustRecords(
  from: number,
  workspaces: readonly Json[],
): Promise<ReadonlyMap<string, Json>> {
  const chosen = new Map<string, { readonly at: number; readonly record: Json }>();

  if (!runs(from, 18)) return chosen;

  for (const object of workspaces) {
    if (!isJsonObject(object) || object.kind !== "workspace" || !isJsonObject(object.body))
      continue;
    const body = workspaceTrustAt6(from, object.body);
    const { target, projectResources } = body;

    if (
      typeof projectResources !== "boolean" ||
      (body.isolation ?? null) !== null ||
      !isJsonObject(target) ||
      typeof target.kind !== "string"
    )
      continue;

    const folder =
      typeof target.path === "string"
        ? { kind: target.kind, path: target.path.replace(/\/+$/u, "") }
        : target;

    if (!WORKSPACE_TARGET.Check(folder)) continue;
    const name = await trustRef(WORKSPACE_TARGET.Decode(folder));
    const at = typeof object.at === "number" ? object.at : 0;
    const kept = chosen.get(name);

    if (kept === undefined || at > kept.at || (at === kept.at && !projectResources))
      chosen.set(name, {
        at,
        record: { kind: "trust", at, body: { target: folder, trusted: projectResources } },
      });
  }

  return new Map([...chosen].map(([name, { record }]) => [name, record]));
}

/** The record a stored record becomes when a store stamped `from` migrates, by `MAPPING`. */
export function migratedRecord(from: number, record: Json): Json {
  if (!isJsonObject(record) || !isJsonObject(record.body)) return record;
  const body = migrateBody(from, record.kind, record.body);

  return Value.Equal(body, record.body) ? record : { ...record, body };
}

/** One session's logged events, in seq order, as a store stamped `from` holds them once it migrates, by `MAPPING`. */
export function migratedLog(from: number, events: readonly Json[]): readonly Json[] {
  const unified = events.map((event) =>
    runs(from, 7) && isJsonObject(event) && event.kind === "call" && event.change === "settled"
      ? { ...event, outcome: unifiedOutcome(event.outcome) ?? null }
      : event,
  );

  const paired = runs(from, 8) ? intentsInParts(unified) : unified;
  const listed = runs(from, 21) ? wholeChangeLists(paired) : paired;

  return runs(from, 23) ? requestModels(listed) : listed;
}

function requestModels(events: readonly Json[]): readonly Json[] {
  const byRun = new Map<Json, Json>();
  const byHead = new Map<Json, Json>();
  const next: Json[] = [];

  for (const event of events) {
    if (!isJsonObject(event)) {
      next.push(event);
      continue;
    }

    const view: JsonObject = isJsonObject(event.view) ? event.view : {};
    const configuration: JsonObject = isJsonObject(view.configuration) ? view.configuration : {};
    const schedule: JsonObject = isJsonObject(event.schedule) ? event.schedule : {};
    const model = configuration.model;

    if (event.kind === "run" && event.change === "started" && isJsonObject(model)) {
      byRun.set(event.run ?? null, model);
      byHead.set(event.head ?? null, model);
      next.push(event);
    } else if (
      event.kind === "part" &&
      event.change === "created" &&
      !("model" in event) &&
      (event.partKind === "text" || event.partKind === "thinking" || event.partKind === "tool") &&
      byRun.has(event.run ?? null)
    )
      next.push({ ...event, model: byRun.get(event.run ?? null) ?? null });
    else if (event.kind === "request" && !("model" in event))
      next.push({ ...event, model: byHead.get(event.head ?? null) ?? null });
    else if (event.kind === "input" && schedule.reason === "configuration")
      next.push({ ...event, schedule: { ...schedule, reason: "run-ended" } });
    else next.push(event);
  }

  return next;
}

function intentsInParts(events: readonly Json[]): readonly Json[] {
  const next = [...events];
  const created = new Map<Json, number>();

  for (const [index, event] of events.entries()) {
    if (!isJsonObject(event)) continue;

    if (event.kind === "part" && event.change === "created") created.set(event.part ?? null, index);

    if (event.kind !== "call" || event.change !== "intent") continue;
    const at = created.get(event.part ?? null);
    const opened = at === undefined ? undefined : next[at];

    if (!("name" in event && "args" in event && "class" in event)) continue;

    if (at === undefined || !isJsonObject(opened) || !isJsonObject(opened.state)) continue;
    next[index] = without(event, ["name", "args", "class"]);
    const state = opened.state;

    if (
      !Value.Equal(state.name, event.name) ||
      !Value.Equal(state.args, event.args) ||
      !Value.Equal(state.class, event.class)
    )
      next[at] = {
        ...opened,
        state: { ...state, name: event.name, args: event.args, class: event.class },
      };
  }

  return next;
}

function wholeChangeLists(events: readonly Json[]): readonly Json[] {
  const listed = new Map<string, Json>();

  return events.map((event) => {
    if (!isJsonObject(event) || event.kind !== "changes" || !Array.isArray(event.files))
      return event;

    for (const file of event.files)
      if (isJsonObject(file) && typeof file.path === "string") listed.set(file.path, file);
    const files = [...listed.values()];

    return Value.Equal(files, event.files) ? event : { ...event, files };
  });
}

function waitNames(session: string, call: CallRecord): readonly string[] {
  const waiting = call.waiting;

  if (waiting === null) return [];

  const slot = (name: number | "deadline" | "input") =>
    `${session}/${call.id}/${call.waits.length}/${name}`;

  const time = (at: number) => String(Math.max(0, Math.floor(at))).padStart(16, "0");
  const targets = "targets" in waiting ? waiting.targets : [waiting];

  const deadlines = [
    waiting.deadline,
    ...("targets" in waiting ? waiting.targets.map((target) => target.deadline) : []),
  ].flatMap((deadline) => (deadline === undefined ? [] : [deadline]));

  return [
    ...targets.flatMap((target, index) => {
      if ((call.partial.at(index) ?? null) !== null) return [];

      switch (target.kind) {
        case "run":
          return [`waits/run/${target.session}/${target.run}/${slot(index)}`];
        case "part":
          return [`waits/part/${session}/${target.part}/${slot(index)}`];
        case "job":
          return [`waits/job/${target.job}/${slot(index)}`];
        case "timer":
          return [`waits/time/${time(target.until)}/${slot(index)}`];
      }
    }),
    ...(deadlines.length === 0
      ? []
      : [`waits/time/${time(Math.min(...deadlines))}/${slot("deadline")}`]),
    ...("targets" in waiting && waiting.untilInput === true && call.head !== null
      ? [`waits/input/${session}/${call.head}/${slot("input")}`]
      : []),
  ];
}

/** The refs a store stamped `from` adds for the ref `name` once its record has migrated to `record`, by `MAPPING`; each points where `name` does. */
export function derivedRefs(from: number, name: string, record: Json): readonly string[] {
  const session = parseSessionRef(name);

  if (session === null) return [];
  const run = decodeRunRecord(record);
  const call = decodeCallRecord(record);

  return [
    ...(runs(from, 9) &&
    run !== null &&
    !run.stopping &&
    name === `sessions/${session}/runs/${run.view.id}`
      ? [`sessions/${session}/live/${run.view.id}`]
      : []),
    ...(call !== null && call.result === null && name === `sessions/${session}/calls/${call.id}`
      ? [
          ...(runs(from, 10) ? waitNames(session, call) : []),
          ...(runs(from, 13) && call.waiting === null && call.waits.length > 0
            ? [`waits/woken/${session}/${call.id}`]
            : []),
        ]
      : []),
  ];
}

/** The JSON paths at which two values differ, for a report that names the fields a migration changed. */
export function changedPaths(
  before: Json | undefined,
  after: Json | undefined,
  path = "",
): readonly string[] {
  if (isJsonObject(before) && isJsonObject(after))
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) =>
      changedPaths(before[key], after[key], `${path}/${key}`),
    );

  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length)
    return before.flatMap((item, index) => changedPaths(item, after[index], `${path}/${index}`));

  return Value.Equal(before, after) ? [] : [path === "" ? "/" : path];
}
