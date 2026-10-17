import { projectSessionIndex, sessionIndexRef } from "@nyte-ai/core/store";
import type { SessionIndex } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import type { Json, Revision } from "@nyte-ai/schema";
import { parseRef, parseText } from "./store-rows.ts";

type Binding = string | number | null;

interface Statement {
  readonly text: string;
  readonly values: readonly Binding[];
}

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
  read: (text: string, values: readonly Binding[]) => Promise<readonly Record<string, unknown>[]>,
): SessionIndex {
  return {
    async list({ parents, after, limit }) {
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
      values.push(limit);

      return (
        await read(
          `SELECT r.name, r.target, r.revision, s.version FROM session_index s JOIN refs r ON r.name = s.name${conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`} ORDER BY s.sort_at, s.session LIMIT ?`,
          values,
        )
      ).map((row) => ({
        ref: parseRef(row),
        version: asId<"revision">(parseText(row.version) ?? ""),
      }));
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

export function postgresSessionIndexQuery(text: string): string {
  let parameter = 0;

  return text.replaceAll("?", () => `$${++parameter}`);
}
