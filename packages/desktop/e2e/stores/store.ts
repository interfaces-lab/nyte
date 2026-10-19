import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Type } from "typebox";
import { Value } from "typebox/value";

function read<T>(path: string, query: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(path, { readOnly: true, timeout: 5_000 });

  try {
    return query(database);
  } finally {
    database.close();
  }
}

const EnvelopeSchema = Type.Object({ kind: Type.String(), body: Type.Unknown() });

function body(database: DatabaseSync, ref: string): unknown {
  const row = database
    .prepare(
      "SELECT objects.body FROM refs JOIN objects ON objects.id = refs.target WHERE refs.name = ?",
    )
    .get(ref);

  const text = row?.body;

  if (typeof text !== "string") return null;
  const parsed: unknown = JSON.parse(text);

  return Value.Check(EnvelopeSchema, parsed) ? parsed.body : null;
}

const LeaseSchema = Type.Object({ instance: Type.String() });

const ProcessSchema = Type.Object({ pid: Type.Union([Type.Number(), Type.Null()]) });

export function leaseHolder(store: string, session: string): string | null {
  return read(store, (database) => {
    const lease = body(database, `sessions/${session}/leases/main`);

    return Value.Check(LeaseSchema, lease) ? lease.instance : null;
  });
}

export function presencePid(store: string, instance: string): number | null {
  return read(store, (database) => {
    const record = body(database, `processes/${instance}`);

    return Value.Check(ProcessSchema, record) ? record.pid : null;
  });
}

export function ownerPid(store: string): number | null {
  const file = `${store}.owner`;

  if (!existsSync(file)) return null;

  return read(file, (database) => {
    const row = database.prepare("SELECT pid FROM owner WHERE id = 1").get();

    return typeof row?.pid === "number" ? row.pid : null;
  });
}

export function drivingPid(store: string, session: string): number | null {
  const holder = leaseHolder(store, session);
  const pid = holder === null ? null : presencePid(store, holder);

  return pid ?? ownerPid(store);
}

export interface RunEnd {
  readonly run: string;
  readonly kind: string;
}

const EndedSchema = Type.Object({
  run: Type.String(),
  end: Type.Object({ kind: Type.String() }),
});

export function endedRuns(store: string, session: string): readonly RunEnd[] {
  return read(store, (database) =>
    database
      .prepare(
        "SELECT event FROM log WHERE session = ? AND json_extract(event, '$.kind') = 'run' AND json_extract(event, '$.change') = 'ended' ORDER BY seq",
      )
      .all(session)
      .flatMap((row) => {
        const parsed: unknown = typeof row.event === "string" ? JSON.parse(row.event) : null;

        return Value.Check(EndedSchema, parsed) ? [{ run: parsed.run, kind: parsed.end.kind }] : [];
      }),
  );
}

export function storeVersion(store: string): number {
  return read(store, (database) => {
    const row = database.prepare("SELECT version FROM store_meta WHERE id = 1").get();

    return typeof row?.version === "number" ? row.version : 0;
  });
}

export function integrity(store: string): string {
  return read(store, (database) => {
    const row = database.prepare("PRAGMA integrity_check").get();

    return typeof row?.integrity_check === "string" ? row.integrity_check : "unknown";
  });
}

export function sessionIds(store: string): readonly string[] {
  return read(store, (database) =>
    database
      .prepare("SELECT DISTINCT session FROM log ORDER BY session")
      .all()
      .flatMap((row) => (typeof row.session === "string" ? [row.session] : [])),
  );
}

export function parkerPid(store: string, session: string): number | null {
  return read(store, (database) => {
    const row = database
      .prepare(
        "SELECT store_audit.pid AS pid FROM store_audit JOIN objects ON objects.id = store_audit.target WHERE store_audit.name LIKE ? AND json_extract(objects.body, '$.body.waiting') IS NOT NULL ORDER BY store_audit.id DESC LIMIT 1",
      )
      .get(`sessions/${session}/calls/%`);

    return typeof row?.pid === "number" ? row.pid : null;
  });
}

export function jobReports(store: string, session: string): readonly string[] {
  return read(store, (database) =>
    database
      .prepare(
        "SELECT json_extract(event, '$.content') AS content FROM log WHERE session = ? AND json_extract(event, '$.kind') = 'input' AND json_extract(event, '$.change') = 'admitted' AND json_extract(event, '$.source.kind') = 'job'",
      )
      .all(session)
      .flatMap((row) => (typeof row.content === "string" ? [row.content] : [])),
  );
}

export function firstEventAfter(store: string, session: string, at: number): number | null {
  return read(store, (database) => {
    const row = database
      .prepare("SELECT min(at) AS at FROM log WHERE session = ? AND at > ?")
      .get(session, at);

    return typeof row?.at === "number" ? row.at : null;
  });
}
