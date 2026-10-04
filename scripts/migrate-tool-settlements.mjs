#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { checkEventBody, checkObject } from "../packages/core/src/kernel/store-schemas.ts";
import { hashBody, objectBody } from "../packages/core/src/kernel/hash.ts";
import { delegationRecordSchema } from "../packages/core/src/kernel/delegation-record.ts";
import { isRefName } from "../packages/core/src/kernel/names.ts";
import {
  CompactionInfo,
  JobInfo,
  ToolOutcome,
  ToolResultMessage,
} from "../packages/protocol/src/schemas.ts";

const require = createRequire(new URL("../packages/core/package.json", import.meta.url));

const { Type } = require("typebox");

const { Compile } = require("typebox/compile");

const checkString = Compile(Type.String());

const checkOutcome = Compile(ToolOutcome);

const checkDelegation = Compile(delegationRecordSchema);

const checkCompaction = Compile(
  Type.Intersect([
    CompactionInfo,
    Type.Object({ leaseOwner: Type.String(), leaseFence: Type.Number() }),
  ]),
);

const jobSchema = Type.Object({
  info: JobInfo,
  result: Type.Optional(ToolResultMessage),
  settlement: Type.Optional(ToolOutcome),
  completion: Type.Union([
    Type.Object({ kind: Type.Literal("none") }),
    Type.Object({ kind: Type.Literal("owed") }),
    Type.Object({ kind: Type.Literal("claimed") }),
    Type.Object({ kind: Type.Literal("delivered"), change: Type.String() }),
  ]),
});

const checkJob = Compile(jobSchema);

const checkJobCompletion = Compile(Type.Object({ completion: jobSchema.properties.completion }));

const columns = {
  sessions: [
    ["id", "TEXT", 1],
    ["created_at", "INTEGER", 0],
    ["next_seq", "INTEGER", 0],
    ["event_floor", "INTEGER", 0],
  ],
  objects: [
    ["session_id", "TEXT", 1],
    ["oid", "TEXT", 2],
    ["kind", "TEXT", 0],
    ["body", "TEXT", 0],
    ["at", "INTEGER", 0],
  ],
  refs: [
    ["session_id", "TEXT", 1],
    ["name", "TEXT", 2],
    ["oid", "TEXT", 0],
  ],
  leases: [
    ["session_id", "TEXT", 1],
    ["name", "TEXT", 2],
    ["owner", "TEXT", 0],
    ["fence", "INTEGER", 0],
    ["expires_at", "INTEGER", 0],
  ],
  events: [
    ["session_id", "TEXT", 1],
    ["seq", "INTEGER", 2],
    ["at", "INTEGER", 0],
    ["body", "TEXT", 0],
  ],
};

function insist(condition, message) {
  if (!condition) throw new Error(message);
}

const spinner = ["|", "/", "-", "\\"];

let spinnerFrame = 0;

let spinnerAt = 0;

let spinnerLine = "";

function render(text) {
  if (!process.stderr.isTTY) return;
  process.stderr.write(`\r${" ".repeat(spinnerLine.length)}\r${text}`);
  spinnerLine = text;
}

function tick(label, count) {
  const now = Date.now();

  if (now - spinnerAt < 80) return;
  spinnerAt = now;
  spinnerFrame = (spinnerFrame + 1) % spinner.length;
  render(
    `${spinner[spinnerFrame]} ${label}${count === undefined ? "" : `: ${count.toLocaleString()}`}`,
  );
}

function finish(text) {
  if (process.stderr.isTTY) render("");
  process.stderr.write(`${text}\n`);
  spinnerLine = "";
  spinnerAt = 0;
}

function validateSchema(db) {
  insist(
    db.prepare("PRAGMA user_version").get().user_version === 4,
    "Only SQLite schema version 4 is supported.",
  );
  const schema = db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all();
  insist(
    schema.length === 5 &&
      schema.every(
        (row) =>
          row.type === "table" &&
          Object.hasOwn(columns, row.name) &&
          /WITHOUT ROWID\s*$/i.test(row.sql),
      ),
    "Unsupported SQLite tables, indexes, views, or triggers.",
  );

  for (const [table, expected] of Object.entries(columns)) {
    const actual = db.prepare(`PRAGMA table_info(${table})`).all();
    insist(
      actual.length === expected.length &&
        actual.every((row, index) => {
          const [name, type, pk] = expected[index];

          return (
            row.cid === index &&
            row.name === name &&
            row.type === type &&
            row.pk === pk &&
            row.notnull === 1 &&
            row.dflt_value === null
          );
        }),
      `Unsupported columns in ${table}.`,
    );
  }

  insist(
    db
      .prepare("PRAGMA integrity_check")
      .all()
      .every((row) => row.integrity_check === "ok"),
    "SQLite integrity_check failed.",
  );
}

function key(session, oid) {
  return JSON.stringify([session, oid]);
}

function parseName(session, name) {
  insist(checkString.Check(name) && isRefName(name), "Invalid stored ref or lease name.");

  if (name.startsWith("refs/delegations/")) {
    const parts = name.split("/");
    insist(
      parts.length === 4 && /^[a-f0-9]{64}$/.test(parts[3]),
      "Unsupported delegation ref name.",
    );

    return {
      role: "delegation",
      session: parts[2],
      oid: parts[3],
      prefix: `refs/delegations/${parts[2]}/`,
    };
  }

  if (name.startsWith("refs/cancelled/")) {
    const oid = name.slice("refs/cancelled/".length);
    insist(/^[a-f0-9]{64}$/.test(oid), "Unsupported cancellation ref name.");

    return { session, oid, prefix: "refs/cancelled/" };
  }

  if (name.startsWith("refs/jobs/")) return { role: "job" };

  if (name.startsWith("refs/compactions/")) return { role: "compaction" };

  return { role: "opaque" };
}

function renameLegacy(value, oid) {
  const toolCommit =
    value.kind === "commit" &&
    value.body?.kind === "message" &&
    value.body.message?.role === "toolResult";

  const resultEffect = value.kind === "effect" && value.state === "result";

  if (!(toolCommit || resultEffect) || !Object.hasOwn(value, "outcome")) return undefined;
  insist(!Object.hasOwn(value, "settlement"), `Both outcome and settlement on ${oid}.`);
  insist(checkOutcome.Check(value.outcome), `Invalid legacy tool outcome on ${oid}.`);
  value.settlement = value.outcome;
  delete value.outcome;

  return toolCommit ? "commit" : "effect";
}

function plan(db, pass) {
  const started = Date.now();
  tick(`${pass}: checking schema`);
  validateSchema(db);

  const sessions = new Set(
    db
      .prepare("SELECT id FROM sessions")
      .all()
      .map((row) => row.id),
  );

  const fingerprint = createHash("sha256");

  for (const [table, fields] of Object.entries(columns)) {
    fingerprint.update(table);

    const order =
      table === "sessions"
        ? "id"
        : "session_id, " + (table === "objects" ? "oid" : table === "events" ? "seq" : "name");

    let count = 0;

    for (const row of db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).iterate()) {
      count += 1;
      tick(`${pass}: hashing ${table}`, count);

      for (const [name, type] of fields) {
        insist(
          type === "TEXT" ? checkString.Check(row[name]) : Number.isSafeInteger(row[name]),
          `Invalid ${table}.${name}.`,
        );
      }

      insist(table === "sessions" || sessions.has(row.session_id), `Orphan row in ${table}.`);

      if (table === "objects")
        insist(
          hashBody(row.body) === row.oid,
          `Object hash mismatch in session ${row.session_id}, object ${row.oid}.`,
        );
      fingerprint.update(JSON.stringify(row));
      fingerprint.update("\n");
    }
  }

  const originalRefs = db.prepare("SELECT * FROM refs ORDER BY session_id, name").all();
  const originalLeases = db.prepare("SELECT * FROM leases ORDER BY session_id, name").all();
  insist(
    originalLeases.every((row) => row.expires_at <= Date.now()),
    "Unexpired leases found. Stop all Nyte processes and wait for their leases to expire.",
  );
  const roles = new Map();

  const assignRole = (session, name, oid) => {
    const parts = parseName(session, name);
    const identity = key(session, oid);

    const role = JSON.stringify({
      role: parts.role ?? "opaque",
      child: parts.role === "delegation" ? parts.session : undefined,
    });

    const existing = roles.get(identity);
    insist(existing === undefined || existing === role, `Ambiguous object ownership on ${oid}.`);
    roles.set(identity, role);
  };

  for (const row of originalRefs) assignRole(row.session_id, row.name, row.oid);

  let seen = 0;

  for (const row of db.prepare("SELECT * FROM events").iterate()) {
    seen += 1;
    tick(`${pass}: reading ref history`, seen);
    const value = JSON.parse(row.body);
    insist(
      checkEventBody.Check(value),
      `Unsupported event in session ${row.session_id}, seq ${row.seq}.`,
    );

    if (value.kind !== "ref") continue;
    parseName(row.session_id, value.name);

    for (const oid of [value.from, value.to]) {
      if (oid !== null) assignRole(row.session_id, value.name, oid);
    }
  }

  for (const row of originalLeases) parseName(row.session_id, row.name);
  const nodes = new Map();
  const unowned = [];
  const delegationContexts = new Map();

  const delegationIdentity = (session, value) =>
    JSON.stringify([
      session,
      value.runId,
      value.callId,
      value.head,
      value.at,
      value.answer.request,
    ]);

  let commits = 0;
  let effects = 0;

  const metadata = db.prepare(`SELECT session_id, oid, kind, at, json_object(
    'kind', json_extract(body, '$.kind'), 'type', json_extract(body, '$.type'),
    'state', json_extract(body, '$.state'),
    'parent', json_extract(body, '$.parent'), 'change', json_extract(body, '$.change'),
    'previous', json_extract(body, '$.previous'), 'supersedes', json_extract(body, '$.supersedes'),
    'intent', json_extract(body, '$.intent'), 'base', json_extract(body, '$.base'),
    'imports', json_extract(body, '$.imports'), 'origin', json_extract(body, '$.origin'),
    'outcome', json_extract(body, '$.outcome'), 'settlement', json_extract(body, '$.settlement'),
    'hasOutcome', json_type(body, '$.outcome') IS NOT NULL,
    'hasSettlement', json_type(body, '$.settlement') IS NOT NULL,
    'body', json_object('kind', json_extract(body, '$.body.kind'),
      'message', json_object('role', json_extract(body, '$.body.message.role')),
      'job', json_object('kind', json_extract(body, '$.body.job.kind'),
        'session', json_extract(body, '$.body.job.session'),
        'request', json_extract(body, '$.body.job.request'),
        'report', json_object('kind', json_extract(body, '$.body.job.report.kind'),
          'commit', json_extract(body, '$.body.job.report.commit')))),
    'value', json_object('runId', json_extract(body, '$.value.runId'),
      'callId', json_extract(body, '$.value.callId'), 'head', json_extract(body, '$.value.head'),
      'at', json_extract(body, '$.value.at'), 'continuation', json_extract(body, '$.value.continuation'),
      'delivery', json_extract(body, '$.value.delivery'), 'answer', json_extract(body, '$.value.answer'),
      'completion', json_extract(body, '$.value.completion'))
  ) AS metadata FROM objects`);

  for (const stored of metadata.iterate()) {
    tick(`${pass}: reading objects`, nodes.size);
    const { metadata, ...row } = stored;
    const value = JSON.parse(metadata);

    insist(
      value.kind === row.kind &&
        (value.type === "change"
          ? ["user", "answer", "passive", "report"].includes(value.kind)
          : ["commit", "effect", "run", "stack", "blob"].includes(value.kind)),
      `Unsupported object kind on ${row.oid}.`,
    );

    if (!value.hasOutcome) delete value.outcome;

    if (!value.hasSettlement) delete value.settlement;
    const renamed = renameLegacy(value, row.oid);

    if (renamed === "commit") commits += 1;

    if (renamed === "effect") effects += 1;

    const role = roles.has(key(row.session_id, row.oid))
      ? JSON.parse(roles.get(key(row.session_id, row.oid)))
      : undefined;

    const node = { row, renamed, role, edges: [], children: [], remaining: 0 };

    const add = (path, session = row.session_id) => {
      const oid = path.reduce((holder, field) => holder[field], value);

      if (oid === null || oid === undefined) return;
      node.edges.push({ path, target: key(session, oid) });
    };

    if (value.type === "change") {
      add(["previous"]);
      add(["supersedes"]);
    } else if (value.kind === "commit") {
      add(["parent"]);
      add(["change"]);

      if (value.imports) value.imports.forEach((_, index) => add(["imports", index]));
    } else if (value.kind === "effect" && value.state !== "intent") {
      add(["intent"]);
    } else if (value.kind === "stack") {
      add(["base"]);
    } else if (value.kind === "run" && value.origin.kind === "continuation") {
      add(["origin", "request", "oid"], value.origin.session);
    }

    if (
      (value.type === "change" || value.kind === "commit") &&
      value.body.kind === "completion" &&
      value.body.job.kind === "delegate"
    ) {
      add(["body", "job", "request", "oid"], value.body.job.session);

      if (value.body.job.report.kind === "text")
        add(["body", "job", "report", "commit"], value.body.job.session);
    }

    if (value.kind === "blob") {
      if (role?.role === "delegation") {
        insist(checkDelegation.Check(value.value), `Unsupported delegation blob ${row.oid}.`);

        if (value.value.delivery.kind === "delivered") add(["value", "delivery", "change"]);

        if (value.value.answer.kind === "ready") {
          const identity = delegationIdentity(row.session_id, value.value);
          const existing = delegationContexts.get(identity);
          insist(
            existing === undefined || existing === role.child,
            `Ambiguous delegation context on ${row.oid}.`,
          );
          delegationContexts.set(identity, role.child);
          add(["value", "answer", "request", "oid"], role.child);

          if (value.value.answer.source.kind === "run") add(["value", "answer", "source", "oid"]);
        }
      } else if (role?.role === "job") {
        insist(checkJobCompletion.Check(value.value), `Unsupported job completion on ${row.oid}.`);

        if (value.value.completion.kind === "delivered") add(["value", "completion", "change"]);
      } else if (!role) {
        if (checkJobCompletion.Check(value.value) && value.value.completion.kind === "delivered") {
          unowned.push({
            oid: row.oid,
            targets: [key(row.session_id, value.value.completion.change)],
            ids: [],
          });
        }

        if (checkDelegation.Check(value.value)) {
          const ids = [];

          if (value.value.delivery.kind === "delivered") ids.push(value.value.delivery.change);

          if (value.value.answer.kind === "ready") {
            ids.push(value.value.answer.request.oid);

            if (value.value.answer.source.kind === "run") ids.push(value.value.answer.source.oid);
          }

          unowned.push({ node, value: value.value, oid: row.oid, targets: [], ids });
        }
      }
    } else {
      insist(!role || role.role === "opaque", `Expected blob on ${row.oid}.`);
    }

    nodes.set(key(row.session_id, row.oid), node);
  }

  for (const blob of unowned) {
    if (!blob.node || blob.value.answer.kind !== "ready") continue;
    const child = delegationContexts.get(delegationIdentity(blob.node.row.session_id, blob.value));

    if (child === undefined) continue;
    blob.node.role = { role: "delegation", child };

    if (blob.value.delivery.kind === "delivered")
      blob.node.edges.push({
        path: ["value", "delivery", "change"],
        target: key(blob.node.row.session_id, blob.value.delivery.change),
      });
    blob.node.edges.push({
      path: ["value", "answer", "request", "oid"],
      target: key(child, blob.value.answer.request.oid),
    });

    if (blob.value.answer.source.kind === "run")
      blob.node.edges.push({
        path: ["value", "answer", "source", "oid"],
        target: key(blob.node.row.session_id, blob.value.answer.source.oid),
      });
    blob.ids = [];
  }

  for (const node of nodes.values()) {
    for (const target of new Set(node.edges.map((edge) => edge.target))) {
      const dependency = nodes.get(target);

      if (!dependency) continue;
      dependency.children.push(node);
      node.remaining += 1;
    }
  }

  const ready = [...nodes.values()].filter((node) => node.remaining === 0);
  const getBody = db.prepare("SELECT body FROM objects WHERE session_id = ? AND oid = ?");

  for (let index = 0; index < ready.length; index += 1) {
    tick(`${pass}: rewriting objects`, index);
    const node = ready[index];
    node.oid = node.row.oid;

    if (
      node.renamed ||
      node.edges.some((edge) => {
        const dependency = nodes.get(edge.target);

        return dependency && dependency.oid !== dependency.row.oid;
      })
    ) {
      const originalBody = getBody.get(node.row.session_id, node.row.oid).body;
      const value = JSON.parse(originalBody);
      insist(objectBody(value) === originalBody, `Noncanonical affected object ${node.row.oid}.`);
      renameLegacy(value, node.row.oid);
      insist(
        checkObject.Check(value) && node.row.kind === value.kind,
        `Affected object fails current schema on ${node.row.oid}.`,
      );

      for (const edge of node.edges) {
        const dependency = nodes.get(edge.target);

        if (!dependency) continue;
        const holder = edge.path.slice(0, -1).reduce((holder, field) => holder[field], value);
        holder[edge.path.at(-1)] = dependency.oid;
      }

      insist(checkObject.Check(value), `Rewritten object fails current schema on ${node.row.oid}.`);

      if (node.role?.role === "job")
        insist(
          checkJob.Check(value.value),
          `Affected job ${node.row.oid} uses an older format. Migrate that job format separately first.`,
        );

      if (node.role?.role === "delegation")
        insist(
          checkDelegation.Check(value.value),
          `Rewritten delegation fails current schema on ${node.row.oid}.`,
        );

      if (node.role?.role === "compaction")
        insist(
          checkCompaction.Check(value.value),
          `Rewritten compaction fails current schema on ${node.row.oid}.`,
        );
      node.body = objectBody(value);
      node.oid = hashBody(node.body);
    }

    for (const child of node.children) {
      child.remaining -= 1;

      if (child.remaining === 0) ready.push(child);
    }
  }

  insist(ready.length === nodes.size, "Cyclic object references are unsupported.");
  const changed = [...nodes.values()].filter((node) => node.oid !== node.row.oid);
  const changedIds = new Set(changed.map((node) => node.row.oid));

  for (const blob of unowned) {
    insist(
      !blob.ids.some((oid) => changedIds.has(oid)) &&
        !blob.targets.some((target) => {
          const node = nodes.get(target);

          return node && node.oid !== node.row.oid;
        }),
      `Unowned reference-bearing blob ${blob.oid}. Its ref history is needed to migrate safely.`,
    );
  }

  const rewriteOid = (session, oid) => nodes.get(key(session, oid))?.oid ?? oid;

  const rewriteName = (session, name) => {
    const parts = parseName(session, name);

    return parts.oid ? parts.prefix + rewriteOid(parts.session, parts.oid) : name;
  };

  const refs = originalRefs.map((row) => ({
    ...row,
    name: rewriteName(row.session_id, row.name),
    oid: rewriteOid(row.session_id, row.oid),
  }));

  const leases = originalLeases.map((row) => ({
    ...row,
    name: rewriteName(row.session_id, row.name),
  }));

  for (const records of [refs, leases]) {
    insist(
      new Set(records.map((row) => key(row.session_id, row.name))).size === records.length,
      "Rewritten ref or lease names collide.",
    );
  }

  const eventChanges = [];

  seen = 0;

  for (const row of db.prepare("SELECT * FROM events").iterate()) {
    seen += 1;
    tick(`${pass}: rewriting ref history`, seen);
    const value = JSON.parse(row.body);

    if (value.kind !== "ref") continue;
    const name = rewriteName(row.session_id, value.name);
    const from = rewriteOid(row.session_id, value.from);
    const to = rewriteOid(row.session_id, value.to);

    if (name === value.name && from === value.from && to === value.to) continue;
    const rewritten = { ...value, name, from, to };
    insist(checkEventBody.Check(rewritten), "Rewritten event fails current schema.");
    eventChanges.push({ row, value: rewritten });
  }

  const refChanges = refs.filter(
    (row, index) => row.name !== originalRefs[index].name || row.oid !== originalRefs[index].oid,
  );

  const leaseChanges = leases.filter((row, index) => row.name !== originalLeases[index].name);
  const destinations = new Map();

  for (const node of changed) {
    const destination = key(node.row.session_id, node.oid);
    const existing = destinations.get(destination) ?? nodes.get(destination);
    insist(
      !existing ||
        (existing.body ?? getBody.get(existing.row.session_id, existing.row.oid).body) ===
          node.body,
      "Rewritten object hash collision.",
    );
    destinations.set(destination, node);
  }

  finish(
    `${pass}: ${nodes.size.toLocaleString()} objects, ${changed.length.toLocaleString()} to rewrite, ${Math.round((Date.now() - started) / 1000)}s`,
  );

  return {
    fingerprint: fingerprint.digest("hex"),
    commits,
    effects,
    changed: changed.map(({ row, oid, body }) => ({ row, oid, body })),
    refs,
    leases,
    eventChanges,
    refChanges,
    leaseChanges,
    sessions: new Set(changed.map((node) => node.row.session_id)).size,
  };
}

function writePlan(db, migration) {
  const remove = db.prepare("DELETE FROM objects WHERE session_id = ? AND oid = ?");

  let written = 0;

  for (const node of migration.changed) {
    written += 1;
    tick("Writing objects", written);
    remove.run(node.row.session_id, node.row.oid);
  }

  const insert = db.prepare(
    "INSERT INTO objects (session_id, oid, kind, body, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id, oid) DO UPDATE SET at = min(at, excluded.at)",
  );

  for (const node of migration.changed)
    insert.run(node.row.session_id, node.oid, node.row.kind, node.body, node.row.at);

  if (migration.refChanges.length > 0) {
    db.exec("DELETE FROM refs");
    const ref = db.prepare("INSERT INTO refs (session_id, name, oid) VALUES (?, ?, ?)");

    for (const row of migration.refs) ref.run(row.session_id, row.name, row.oid);
  }

  if (migration.leaseChanges.length > 0) {
    db.exec("DELETE FROM leases");

    const lease = db.prepare(
      "INSERT INTO leases (session_id, name, owner, fence, expires_at) VALUES (?, ?, ?, ?, ?)",
    );

    for (const row of migration.leases)
      lease.run(row.session_id, row.name, row.owner, row.fence, row.expires_at);
  }

  const event = db.prepare("UPDATE events SET body = ? WHERE session_id = ? AND seq = ?");

  for (const { row, value } of migration.eventChanges)
    event.run(JSON.stringify(value), row.session_id, row.seq);
  finish(`Wrote ${migration.changed.length.toLocaleString()} objects`);
  const remaining = plan(db, "Validating result");
  insist(
    remaining.changed.length === 0 &&
      remaining.refChanges.length === 0 &&
      remaining.eventChanges.length === 0 &&
      remaining.leaseChanges.length === 0,
    "Post-migration validation failed.",
  );
}

function readPlan(path, pass) {
  const db = new DatabaseSync(path, { readOnly: true });

  try {
    db.exec("BEGIN");

    return plan(db, pass);
  } finally {
    db.close();
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: node scripts/migrate-tool-settlements.mjs [--apply] DATABASE\n\nDry run by default. Stop all Nyte processes before running.\n--apply creates a SQLite backup, then rewrites objects, refs, and events atomically.\nOnly schema version 4 and known reference shapes are supported.",
    );

    return;
  }

  const apply = args[0] === "--apply";
  const paths = apply ? args.slice(1) : args;
  insist(
    paths.length === 1 && !paths[0].startsWith("-"),
    "Usage: node scripts/migrate-tool-settlements.mjs [--apply] DATABASE",
  );
  const path = realpathSync(paths[0]);
  insist(statSync(path).isFile(), "Database must be an existing file.");
  console.log(`Database: ${path}\nStop all Nyte processes before running this migration.`);
  const migration = readPlan(path, "Scanning");
  console.log(
    `Planned: ${migration.commits} tool-result commits, ${migration.effects} result effects; ${migration.changed.length} objects across ${migration.sessions} sessions, ${migration.refChanges.length} refs, ${migration.eventChanges.length} events, ${migration.leaseChanges.length} expired lease names.`,
  );

  if (!apply) {
    console.log("Dry run complete. No writes. Use --apply DATABASE to migrate.");

    return;
  }

  if (
    migration.changed.length === 0 &&
    migration.refChanges.length === 0 &&
    migration.eventChanges.length === 0 &&
    migration.leaseChanges.length === 0
  ) {
    console.log("Already migrated. No writes or backup needed.");

    return;
  }

  const backupDirectory = mkdtempSync(`${path}.settlement-backup-`);
  const backupPath = join(backupDirectory, "sessions.db");
  const source = new DatabaseSync(path, { readOnly: true });

  try {
    await backup(source, backupPath, {
      rate: 1000,
      progress: ({ totalPages, remainingPages }) =>
        tick(`Backing up ${Math.round(((totalPages - remainingPages) / totalPages) * 100)}%`),
    });
    chmodSync(backupPath, 0o600);
  } finally {
    source.close();
  }

  finish("Backup complete");
  console.log(`Backup: ${backupPath}`);
  insist(
    readPlan(backupPath, "Verifying backup").fingerprint === migration.fingerprint,
    "Database changed during backup. Nothing applied. Stop all Nyte processes and run again.",
  );
  const db = new DatabaseSync(path);

  try {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL; BEGIN IMMEDIATE");
    const locked = plan(db, "Checking under lock");
    insist(
      locked.fingerprint === migration.fingerprint,
      "Database changed since dry run. Nothing applied. Stop all Nyte processes and run again.",
    );
    writePlan(db, locked);
    db.exec("COMMIT");
    console.log("Applied. Backup retained.");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
