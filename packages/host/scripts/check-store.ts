import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  decodeCallRecord,
  decodeCommitRecord,
  decodeHostIdentity,
  decodeInboxRecord,
  decodeLease,
  decodeObject,
  decodePartRecord,
  decodePrincipalRecord,
  decodeReceiptRecord,
  decodeRunRecord,
  decodeSeenRecord,
  decodeSessionRecord,
  decodeTrustRecord,
  decodeWorkspaceRecord,
  loggedEvent,
  STORE_VERSION,
} from "@nyte-ai/core/store";
import type { RecordKind } from "@nyte-ai/core/store";
import { compile, isJsonObject, SessionEventType, withJson } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";

type Decode = (object: Json | null) => object | null;

const decoders = new Map<Json, { readonly kind: string; readonly decode: Decode }>(
  Object.entries({
    session: decodeSessionRecord,
    commit: decodeCommitRecord,
    inbox: decodeInboxRecord,
    run: decodeRunRecord,
    part: decodePartRecord,
    receipt: decodeReceiptRecord,
    seen: decodeSeenRecord,
    workspace: decodeWorkspaceRecord,
    trust: decodeTrustRecord,
    lease: decodeLease,
    call: decodeCallRecord,
    principals: decodePrincipalRecord,
    identity: decodeHostIdentity,
  } satisfies Record<Exclude<RecordKind, "kv">, Decode>).map(([kind, decode]) => [
    kind,
    { kind, decode },
  ]),
);

interface Failure {
  count: number;
  readonly sessions: Set<string>;
  readonly sample: string;
  readonly reasons: readonly string[];
}

const path = process.argv[2] ?? join(homedir(), ".nyte", "nyte.db");

const database = new DatabaseSync(path, { readOnly: true });

const failures = new Map<string, Failure>();

const unchecked = new Map<string, number>();

const checkedObjects = new Set<string>();

let events = 0;

function fail(
  group: string,
  session: string | null,
  sample: string,
  reasons: () => readonly string[],
) {
  const found = failures.get(group) ?? {
    count: 0,
    sessions: new Set(),
    sample,
    reasons: reasons(),
  };

  found.count += 1;

  if (session !== null) found.sessions.add(session);

  failures.set(group, found);
}

function findVariants(event: { readonly [key: string]: Json }) {
  return SessionEventType.anyOf.filter(
    (variant) =>
      variant.properties.kind.const === event.kind &&
      (!("change" in variant.properties) || variant.properties.change.const === event.change),
  );
}

function explainEvent(event: Json, variants: ReturnType<typeof findVariants>): readonly string[] {
  if (variants.length === 0) return ["no event variant has this kind and change"];

  return [
    ...new Set(
      variants.flatMap((variant) =>
        [...compile(withJson(variant)).Errors(event)].map(
          (error) => `${error.instancePath || "/"} ${error.message}`,
        ),
      ),
    ),
  ];
}

for (const row of database
  .prepare("SELECT session, seq, at, event FROM log ORDER BY session, seq")
  .iterate()) {
  events += 1;
  const session = String(row.session);
  const seq = Number(row.seq);
  const body = decodeObject(String(row.event));

  try {
    loggedEvent(seq, Number(row.at), body);
  } catch {
    const event = isJsonObject(body) ? { ...body, seq, at: Number(row.at) } : null;
    const variants = event === null ? [] : findVariants(event);
    const variant = variants[0];

    const label =
      variant === undefined
        ? "of unknown kind"
        : "change" in variant.properties
          ? `${variant.properties.kind.const}/${variant.properties.change.const}`
          : variant.properties.kind.const;

    fail(`log ${label}`, session, `session ${session} seq ${seq}`, () =>
      explainEvent(event, variants),
    );
  }
}

function checkObject(id: string, text: string, location: string, session: string | null) {
  if (checkedObjects.has(id)) return;

  checkedObjects.add(id);
  const object = decodeObject(text);
  const kind = isJsonObject(object) ? (object.kind ?? null) : null;
  const record = decoders.get(kind);

  if (record === undefined) {
    const label = kind === null ? "no kind" : JSON.stringify(kind);

    unchecked.set(label, (unchecked.get(label) ?? 0) + 1);

    return;
  }

  if (record.decode(object) === null)
    fail(`record ${record.kind}`, session, location, () => ["does not decode as a stored record"]);
}

for (const row of database
  .prepare(
    "SELECT refs.name, objects.id, objects.body FROM refs JOIN objects ON objects.id = refs.target WHERE objects.body IS NOT NULL",
  )
  .iterate()) {
  const name = String(row.name);
  checkObject(
    String(row.id),
    String(row.body),
    `ref ${name}`,
    name.startsWith("sessions/") ? (name.split("/")[1] ?? null) : null,
  );
}

for (const row of database
  .prepare("SELECT id, body FROM objects WHERE json_extract(body, '$.kind') = 'commit'")
  .iterate())
  checkObject(String(row.id), String(row.body), `commit ${String(row.id)}`, null);

const stamp = database
  .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'store_meta'")
  .get()
  ? Number(database.prepare("SELECT version FROM store_meta WHERE id = 1").get()?.version ?? 0)
  : 0;

database.close();

console.log(`Checked ${events} log events and ${checkedObjects.size} records in ${path}.`);

if (stamp < STORE_VERSION)
  console.log(
    `\nThe store is at version ${stamp}; this checkout migrates it to ${STORE_VERSION} when it opens, and rows read here are unmigrated. \`node scripts/migrate-proof.ts ${path}\` checks the migration on a copy.`,
  );

for (const [group, failure] of failures) {
  const spread = failure.sessions.size > 0 ? ` in ${failure.sessions.size} sessions` : "";
  console.log(`\n✗ ${group}: ${failure.count} unreadable${spread}, first at ${failure.sample}`);

  for (const reason of failure.reasons) console.log(`    ${reason}`);
}

if (unchecked.size > 0)
  console.log(
    `\nNot checked (no stored schema): ${[...unchecked].map(([kind, count]) => `${kind} ${count}`).join(", ")}`,
  );

if (failures.size > 0) {
  console.log("\nThis store holds rows the current schemas reject. Backfill them before shipping.");
  process.exitCode = 1;
}
