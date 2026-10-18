import { DatabaseSync } from "node:sqlite";
import fc from "fast-check";
import { envelope, STORE_VERSION, STORED_RECORD_TYPES } from "@nyte-ai/core/store";
import type { RecordKind } from "@nyte-ai/core/store";
import {
  cyclicWithJson,
  DurableEventType,
  FileStatusType,
  HunkType,
  isJsonObject,
  JsonType,
  ToolClassType,
  WaitOutcomeType,
  WaitTargetType,
  withJson,
} from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import type { TSchema } from "typebox";
import { sqliteStore } from "../../src/sqlite.ts";
import { ID, schemaArbitrary } from "./arbitrary.ts";

type JsonObject = { readonly [key: string]: Json };

function body(kind: Exclude<RecordKind, "kv">): fc.Arbitrary<JsonObject> {
  return schemaArbitrary(
    cyclicWithJson({ Root: STORED_RECORD_TYPES[kind], WaitOutcome: WaitOutcomeType }, "Root"),
  ).filter(isJsonObject);
}

function variant(kind: string, change: string): TSchema {
  const found = DurableEventType.anyOf.find(
    (schema) =>
      schema.properties.kind.const === kind &&
      "change" in schema.properties &&
      schema.properties.change.const === change,
  );

  if (found === undefined) throw new TypeError(`No ${kind}/${change} event.`);

  return withJson(found);
}

const json = schemaArbitrary(withJson(JsonType), 4);

const jsonObject = json.filter(isJsonObject);

const waitTarget = schemaArbitrary(withJson(WaitTargetType));

/** What an unsettled call waits on: one target, or several with input waking it too. */
const waiting = fc.oneof(
  waitTarget,
  fc.record({
    kind: fc.constantFrom("any", "all"),
    targets: fc.array(waitTarget, { minLength: 1, maxLength: 3 }),
    untilInput: fc.constant(true),
  }),
);

/** An edit tool's output as Nyte wrote it before patches were text. */
const legacyPatch = fc.record({
  path: fc.constantFrom("a.ts", "src/b.ts", "c d.md"),
  status: fc.constantFrom(...FileStatusType.enum),
  kind: fc.constant("text"),
  hunks: fc.array(schemaArbitrary(withJson(HunkType)), { maxLength: 3 }),
  digest: fc.string({ maxLength: 4 }),
});

const legacyOutcome = fc.record({
  kind: fc.constant("ok"),
  content: fc.constant([]),
  output: legacyPatch,
  parts: fc.constant([]),
});

/** Whether a store stamped `from` can still hold what the step reaching `version` rewrites. */
function older(from: number, version: number): boolean {
  return from < version;
}

interface Entry {
  readonly name: string;
  readonly record: Json;
}

function entry(kind: RecordKind, name: string, value: Json, at: number): Entry {
  return { name, record: envelope(kind, value, at) };
}

function records(from: number): fc.Arbitrary<Entry> {
  const at = fc.integer({ min: 0, max: 2_000_000_000_000 });

  return fc.oneof(
    fc
      .tuple(ID, body("session"), at)
      .map(([session, value, time]) => entry("session", `sessions/${session}`, value, time)),
    fc
      .tuple(
        ID,
        ID,
        fc.boolean(),
        body("run"),
        at,
        fc.constantFrom("parked", "lastSnapshot", "both"),
      )
      .map(([session, other, own, value, time, dropped]) => {
        const view = isJsonObject(value.view) ? value.view : {};
        const run = own && typeof view.id === "string" ? view.id : other;

        const legacy = older(from, 2)
          ? Object.fromEntries(
              Object.entries(value).filter(
                ([key]) =>
                  !(
                    key === dropped ||
                    (dropped === "both" && (key === "parked" || key === "lastSnapshot"))
                  ),
              ),
            )
          : value;

        return entry("run", `sessions/${session}/runs/${run}`, legacy, time);
      }),
    fc
      .tuple(
        ID,
        ID,
        fc.boolean(),
        body("call"),
        at,
        fc.record({
          reran: fc.boolean(),
          patch: fc.boolean(),
          pairing: fc.constantFrom("as generated", "tool", "intent", "hook"),
          intent: jsonObject,
          args: json,
          nested: fc.dictionary(
            fc.constantFrom("codemode:edit:0", "codemode:edit:1", "x"),
            legacyOutcome,
            {
              maxKeys: 2,
            },
          ),
          outcome: legacyOutcome,
          waiting: fc.oneof(
            { arbitrary: fc.constant(null), weight: 3 },
            { arbitrary: waiting, weight: 1 },
          ),
          modify: fc.oneof(
            {
              arbitrary: fc.record({
                call: ID,
                name: fc.constantFrom("bash", "edit"),
                args: json,
                class: schemaArbitrary(withJson(ToolClassType)),
              }),
              weight: 3,
            },
            { arbitrary: fc.record({ args: json, other: json }, { requiredKeys: [] }), weight: 1 },
          ),
        }),
      )
      .map(([session, other, own, value, time, legacy]) => {
        let call: JsonObject = value;

        if (older(from, 2) && legacy.reran)
          call = Object.fromEntries(Object.entries(call).filter(([key]) => key !== "reran"));

        if (older(from, 7) && legacy.patch)
          call = { ...call, result: legacy.outcome, nested: legacy.nested };

        if (older(from, 11) && legacy.pairing === "tool")
          call = {
            ...call,
            kind: "tool",
            intent: { ...legacy.intent, name: "edit", args: legacy.args },
          };

        if (older(from, 12) && legacy.pairing === "intent")
          call = {
            ...call,
            kind: "intent",
            intent: Object.fromEntries(
              Object.entries(legacy.intent).filter(([key]) => key !== "position"),
            ),
          };

        if (older(from, 14) && legacy.pairing === "hook")
          call = {
            ...call,
            kind: "hook",
            id: `hook:before_tool:${other}`,
            intent: { ...legacy.intent, args: legacy.args },
            result: legacy.patch
              ? { action: "modify", value: legacy.modify }
              : (call.result ?? null),
          };
        if (older(from, 10) && legacy.waiting !== null)
          call = {
            ...call,
            result: null,
            waiting: legacy.waiting,
            partial: [],
            head: typeof call.head === "string" ? call.head : "main",
          };
        const id =
          (own || (older(from, 10) && legacy.waiting !== null)) && typeof call.id === "string"
            ? call.id
            : other;

        return entry("call", `sessions/${session}/calls/${id}`, call, time);
      }),
    fc
      .tuple(ID, body("part"), at, fc.boolean(), legacyOutcome, jsonObject)
      .map(([session, value, time, patch, outcome, state]) =>
        entry(
          "part",
          `sessions/${session}/parts/${typeof value.id === "string" ? value.id : "p"}`,
          older(from, 7) && patch ? { ...value, state: { ...state, outcome } } : value,
          time,
        ),
      ),
    fc
      .tuple(ID, ID, body("inbox"), at, fc.boolean())
      .map(([session, name, value, time, drop]) =>
        entry(
          "inbox",
          `sessions/${session}/inbox/${name}`,
          older(from, 2) && drop
            ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "pendingInput"))
            : value,
          time,
        ),
      ),
    fc
      .tuple(body("principals"), at, fc.boolean(), fc.boolean(), fc.integer())
      .map(([value, time, dated, dropCodes, seen]) => {
        const principals = Array.isArray(value.principals) ? value.principals : [];

        const legacy = older(from, 2)
          ? {
              ...Object.fromEntries(
                Object.entries(value).filter(([key]) => !(dropCodes && key === "codes")),
              ),
              principals: dated
                ? principals.map((item) =>
                    isJsonObject(item) ? { ...item, lastSeenAt: seen } : item,
                  )
                : principals,
            }
          : value;

        return entry("principals", "host/principals", legacy, time);
      }),
    fc
      .tuple(
        ID,
        body("workspace"),
        at,
        fc.option(fc.constantFrom("/work/a", "/work/a/", "/work/a/b", "/work/c"), {
          nil: null,
        }),
        older(from, 6) ? fc.boolean() : fc.constantFrom(true, false, null),
      )
      .map(([id, value, time, folder, trusted]) => {
        const placed =
          folder === null ? value : { ...value, target: { kind: "local", path: folder } };

        const legacy = older(from, 16)
          ? Object.fromEntries(Object.entries(placed).filter(([key]) => key !== "isolation"))
          : placed;

        return entry(
          "workspace",
          `workspaces/${id}`,
          older(from, 19) ? { ...legacy, projectResources: trusted } : legacy,
          time,
        );
      }),
    fc
      .tuple(ID, ID, body("commit"), at)
      .map(([session, head, value, time]) =>
        entry("commit", `sessions/${session}/heads/${head}`, value, time),
      ),
    fc
      .tuple(ID, ID, body("receipt"), at)
      .map(([session, id, value, time]) =>
        entry("receipt", `sessions/${session}/receipts/${id}`, value, time),
      ),
    fc
      .tuple(ID, ID, body("seen"), at)
      .map(([session, id, value, time]) =>
        entry("seen", `sessions/${session}/seen/${id}`, value, time),
      ),
    fc
      .tuple(ID, ID, body("lease"), at)
      .map(([session, id, value, time]) =>
        entry("lease", `sessions/${session}/leases/${id}`, value, time),
      ),
    fc
      .tuple(body("identity"), at)
      .map(([value, time]) => entry("identity", "host/identity", value, time)),
    fc.tuple(ID, json, at).map(([id, value, time]) => entry("kv", `kv/${id}`, value, time)),
    fc
      .tuple(ID, ID, fc.constantFrom("live", "woken"), body("seen"), at)
      .map(([session, id, index, value, time]) =>
        entry(
          "seen",
          index === "live" ? `sessions/${session}/live/${id}` : `waits/woken/${session}/${id}`,
          value,
          time,
        ),
      ),
  );
}

const durableEvent = schemaArbitrary(withJson(DurableEventType));

const partCreated = schemaArbitrary(variant("part", "created")).filter(isJsonObject);

const callSettled = schemaArbitrary(variant("call", "settled")).filter(isJsonObject);

function events(from: number): fc.Arbitrary<readonly Json[]> {
  const intentPair = fc
    .tuple(
      partCreated,
      ID,
      ID,
      jsonObject,
      fc.record({ name: fc.constantFrom("edit", "bash"), args: json, class: json }),
      fc.constantFrom("same", "differs", "missing class", "part after", "state not object"),
    )
    .map(([created, part, call, state, tool, pairing]): readonly Json[] => {
      const opened = {
        ...created,
        part,
        state:
          pairing === "state not object"
            ? "text"
            : pairing === "same"
              ? { ...state, ...tool }
              : { ...state, name: "read", args: null },
      };

      const intent = {
        head: null,
        kind: "call",
        change: "intent",
        call,
        part,
        ...(pairing === "missing class" ? { name: tool.name, args: tool.args } : tool),
      };

      return pairing === "part after" ? [intent, opened] : [opened, intent];
    });

  return fc
    .array(
      fc.oneof(
        durableEvent.map((event) => [event]),
        ...(older(from, 8) ? [intentPair] : []),
        ...(older(from, 7)
          ? [
              fc
                .tuple(callSettled, legacyOutcome)
                .map(([event, outcome]) => [{ ...event, outcome }]),
            ]
          : []),
      ),
      { maxLength: 6 },
    )
    .map((groups) => groups.flat());
}

/** A run an older Nyte ended before it kept the run's last record: the run's records, which no ref reaches, and whether its session ref and its `runs/` ref are still there. */
interface EndedRun {
  readonly session: string;
  readonly run: string;
  readonly records: readonly Json[];
  readonly sessionRecord: Json | null;
  readonly live: boolean;
}

const endedRun: fc.Arbitrary<EndedRun> = fc
  .record({
    session: ID,
    run: ID,
    records: fc.array(
      fc.record({
        body: body("run"),
        at: fc.integer({ min: 0, max: 20 }),
        snapshot: fc.option(fc.constantFrom("git:a", "git:b"), { nil: null }),
        lastSnapshot: fc.option(fc.constantFrom("git:b", "git:c"), { nil: null }),
        legacy: fc.boolean(),
      }),
      { minLength: 1, maxLength: 3 },
    ),
    sessionRecord: fc.option(body("session"), { nil: null }),
    live: fc.boolean(),
  })
  .map(({ session, run, records: written, sessionRecord, live }) => ({
    session,
    run,
    sessionRecord: sessionRecord === null ? null : envelope("session", sessionRecord, 0),
    live,
    records: written.map(({ body: value, at, snapshot, lastSnapshot, legacy }) => {
      const view = isJsonObject(value.view) ? value.view : {};
      const record = { ...value, view: { ...view, id: run }, snapshot, lastSnapshot };

      return envelope(
        "run",
        legacy
          ? Object.fromEntries(Object.entries(record).filter(([key]) => key !== "lastSnapshot"))
          : record,
        at,
      );
    }),
  }));

/** A store an older Nyte could have written: its stamp, its refs and their records, its sessions' logged events, each in a form the stamp still allows, and the runs it ended before it kept their last records. */
export const scenario = fc.integer({ min: 0, max: STORE_VERSION }).chain((from) =>
  fc.record({
    from: fc.constant(from),
    records: fc.uniqueArray(records(from), { selector: (item) => item.name, maxLength: 14 }),
    logs: fc.dictionary(ID, events(from), { maxKeys: 3 }),
    ended: older(from, 15) ? fc.array(endedRun, { maxLength: 3 }) : fc.constant([]),
  }),
);

/** Writes `input` as the store an older Nyte stamped `input.from` left at `path`: the records through this checkout's store, with the host identity every opened store holds, then the log, the stamp, and no table or index the stamp predates. */
export async function writeStore(
  path: string,
  input: {
    readonly from: number;
    readonly records: readonly Entry[];
    readonly logs: Readonly<Record<string, readonly Json[]>>;
    readonly ended: readonly EndedRun[];
  },
): Promise<void> {
  const store = sqliteStore({ path });
  const connection = await store.open();

  const identity = {
    name: "host/identity",
    record: envelope("identity", { id: "host", createdAt: 0 }, 0),
  };

  for (const item of input.records.some((entry) => entry.name === identity.name)
    ? input.records
    : [identity, ...input.records]) {
    const target = await connection.objects.put(item.record);
    const outcome = await connection.refs.set([{ name: item.name, target, expect: "absent" }]);

    if (outcome.kind !== "set") throw new Error(`Writing ${item.name} was ${outcome.kind}.`);
  }

  const logs = new Map(Object.entries(input.logs));

  for (const ended of input.ended) {
    for (const record of ended.records) await connection.objects.put(record);
    const [first] = ended.records;

    if (ended.sessionRecord !== null)
      await connection.refs.set([
        {
          name: `sessions/${ended.session}`,
          target: await connection.objects.put(ended.sessionRecord),
          expect: "absent",
        },
      ]);

    if (ended.live && isJsonObject(first) && isJsonObject(first.body))
      await connection.refs.set([
        {
          name: `sessions/${ended.session}/runs/${ended.run}`,
          target: await connection.objects.put({
            ...first,
            body: { lastSnapshot: null, ...first.body },
          }),
          expect: "absent",
        },
      ]);
    logs.set(ended.session, [
      ...(logs.get(ended.session) ?? []),
      { head: "main", kind: "run", run: ended.run, change: "ended", end: { kind: "stopped" } },
    ]);
  }

  await store.close();
  const database = new DatabaseSync(path);
  const append = database.prepare("INSERT INTO log (session, seq, at, event) VALUES (?, ?, ?, ?)");

  for (const [session, logged] of logs)
    for (const [index, event] of logged.entries())
      append.run(session, index + 1, 1_000 + index, JSON.stringify(event));

  if (input.from <= 2) database.exec("DROP TABLE session_index; DROP TABLE pending_work");

  if (input.from <= 4) database.exec("DROP INDEX log_kind");
  database.prepare("UPDATE store_meta SET version = ? WHERE id = 1").run(input.from);
  database.close();
}
