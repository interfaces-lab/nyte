import { directorySessions, projectSessionIndex, sessionIndexRef } from "@nyte-ai/core/store";
import type { SessionIndex, SessionIndexRow } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import type {
  Json,
  ParentFilter,
  RefUpdate,
  Revision,
  SessionId,
  SetOutcome,
} from "@nyte-ai/schema";
import { parseNumber, parseRef, parseText } from "./store-rows.ts";

type Binding = string | number | null;

type Rows = readonly Readonly<Record<string, unknown>>[];

interface Statement {
  readonly text: string;
  readonly values: readonly Binding[];
}

export type HostStamp = Extract<SetOutcome, { kind: "set" }>["host"];

export const READ_HOST_SEQ = "SELECT seq FROM host_seq WHERE id = 1";

export const WRITE_HOST_SEQ = "UPDATE host_seq SET seq = ? WHERE id = 1";

export function sessionIndexChanges(
  name: string,
  object: Json | null,
  revision: Revision,
): readonly Statement[] {
  const ref = sessionIndexRef(name);

  if (ref === null) return [];
  const entry = projectSessionIndex(name, object);

  if (ref.kind === "session") {
    return entry?.kind === "session"
      ? [
          {
            text: "INSERT INTO session_index (name, session, parent, sort_at, version) VALUES (?, ?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET session = excluded.session, parent = excluded.parent, sort_at = excluded.sort_at, version = excluded.version",
            values: [name, entry.session, entry.parent, -entry.at, revision],
          },
        ]
      : [{ text: "DELETE FROM session_index WHERE name = ?", values: [name] }];
  }

  return entry !== null && entry.kind !== "session"
    ? [
        {
          text: "INSERT INTO pending_work (name, session, kind) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET session = excluded.session, kind = excluded.kind",
          values: [name, entry.session, entry.kind],
        },
      ]
    : [{ text: "DELETE FROM pending_work WHERE name = ?", values: [name] }];
}

export function sqlSessionIndex(
  read: (text: string, values: readonly Binding[]) => Promise<Rows>,
): SessionIndex {
  return {
    async list({ parents, after, limit }) {
      const filter = selection(parents, after);

      return (
        await read(
          `SELECT r.name, r.target, r.revision, s.version, s.seq FROM session_index s JOIN refs r ON r.name = s.name${filter.where} ORDER BY s.sort_at, s.session LIMIT ?`,
          [...filter.values, limit],
        )
      ).map(indexRow);
    },
    async changed({ since, parents, limit }) {
      const filter = selection(parents, undefined);

      const rows = await read(
        `SELECT m.seq AS host_seq, x.session, x.name, x.target, x.revision, x.version, x.seq FROM host_seq m LEFT JOIN (SELECT s.session, s.sort_at, r.name, r.target, r.revision, s.version, s.seq FROM session_index s JOIN refs r ON r.name = s.name${filter.where} ORDER BY s.sort_at, s.session LIMIT ?) x ON 1 = 1 WHERE m.id = 1 ORDER BY x.sort_at, x.session`,
        [...filter.values, limit],
      );

      const listed = rows.flatMap((row) => {
        const session = parseText(row.session);

        return session === null ? [] : [{ id: asId<"session">(session), row: indexRow(row) }];
      });

      return {
        seq: parseNumber(rows[0]?.host_seq ?? 0),
        ids: listed.map((entry) => entry.id),
        rows: listed.flatMap((entry) => (entry.row.seq > since ? [entry.row] : [])),
      };
    },
    async work({ after, limit }) {
      return (
        await read(
          `SELECT r.name, r.target, r.revision FROM (SELECT DISTINCT session FROM pending_work${after === undefined ? "" : " WHERE session > ?"}) p JOIN session_index s ON s.session = p.session JOIN refs r ON r.name = s.name ORDER BY p.session LIMIT ?`,
          after === undefined ? [limit] : [after, limit],
        )
      ).map(parseRef);
    },
    async pending({ kind, sessions }) {
      if (sessions?.length === 0) return [];

      return (
        await read(
          `SELECT r.name, r.target, r.revision FROM pending_work p JOIN refs r ON r.name = p.name WHERE p.kind = ?${sessions === undefined ? "" : ` AND p.session IN (${sessions.map(() => "?").join(", ")})`} ORDER BY p.name`,
          [kind, ...(sessions ?? [])],
        )
      ).map(parseRef);
    },
  };
}

export function stampDirectory(
  updates: readonly RefUpdate[],
  run: (text: string, values: readonly Binding[]) => Rows,
): () => HostStamp {
  const directory = directorySessions(updates);
  const before = removedRoots(directory.removed);
  const removed = before === null ? [] : run(before.text, before.values);

  return () => {
    if (directory.changed.length === 0) return null;
    const next = parseNumber(run(READ_HOST_SEQ, [])[0]?.seq ?? 0) + 1;
    const stamp = stampRows(next, directory.changed, removed);
    const stamped = run(stamp.text, stamp.values);
    const sessions = stampedSessions(stamped, removed);

    if (sessions.length === 0) return null;
    run(WRITE_HOST_SEQ, [next]);

    return { seq: next, sessions };
  };
}

export function removedRoots(removed: readonly SessionId[]): Statement | null {
  return removed.length === 0
    ? null
    : {
        text: `SELECT session, parent FROM session_index WHERE session IN (${marks(removed)})`,
        values: removed,
      };
}

export function lockStamped(changed: readonly SessionId[]): Statement {
  return {
    text: `SELECT session FROM session_index WHERE session IN (${marks(changed)}) OR session IN (SELECT parent FROM session_index WHERE session IN (${marks(changed)})) ORDER BY session FOR UPDATE`,
    values: [...changed, ...changed],
  };
}

export function stampRows(next: number, changed: readonly SessionId[], removed: Rows): Statement {
  const orphaned = removed.flatMap((row) => {
    const parent = parseText(row.parent);

    return parent === null ? [] : [parent];
  });

  return {
    text: `UPDATE session_index SET seq = ? WHERE session IN (${marks(changed)}) OR session IN (SELECT parent FROM session_index WHERE session IN (${marks(changed)}))${orphaned.length === 0 ? "" : ` OR session IN (${marks(orphaned)})`} RETURNING session`,
    values: [next, ...changed, ...changed, ...orphaned],
  };
}

export function stampedSessions(stamped: Rows, removed: Rows): readonly SessionId[] {
  return [
    ...new Set(
      [...stamped, ...removed].flatMap((row) => {
        const session = parseText(row.session);

        return session === null ? [] : [asId<"session">(session)];
      }),
    ),
  ].toSorted();
}

function selection(
  parents: ParentFilter,
  after: { readonly at: number; readonly id: SessionId } | undefined,
): { readonly where: string; readonly values: readonly Binding[] } {
  const conditions: string[] = [];
  const values: Binding[] = [];

  if (parents.kind === "roots") conditions.push("s.parent IS NULL");
  if (parents.kind === "children") {
    conditions.push("s.parent = ?");
    values.push(parents.session);
  }
  if (after !== undefined) {
    conditions.push("(s.sort_at, s.session) > (?, ?)");
    values.push(-after.at, after.id);
  }

  return { where: conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`, values };
}

function indexRow(row: Readonly<Record<string, unknown>>): SessionIndexRow {
  return {
    ref: parseRef(row),
    version: asId<"revision">(parseText(row.version) ?? ""),
    seq: parseNumber(row.seq ?? 0),
  };
}

function marks(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

export function postgresSessionIndexQuery(text: string): string {
  let parameter = 0;

  return text.replaceAll("?", () => `$${++parameter}`);
}
