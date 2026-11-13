import type { SchemaStep } from "./migrations.ts";

export const sessionIndex: SchemaStep = {
  kind: "schema",
  name: "2026-10-14-session-index",
  sql: {
    sqlite: [
      "CREATE TABLE session_index (name TEXT PRIMARY KEY, session TEXT NOT NULL UNIQUE, parent TEXT NULL, sort_at REAL NOT NULL, version TEXT NOT NULL)",
      "CREATE INDEX session_index_activity ON session_index(sort_at, session)",
      "CREATE INDEX session_index_parent_activity ON session_index(parent, sort_at, session)",
      "CREATE TABLE pending_work (name TEXT PRIMARY KEY, session TEXT NOT NULL, kind TEXT NOT NULL)",
      "CREATE INDEX pending_work_session ON pending_work(session, kind, name)",
      "CREATE INDEX pending_work_kind ON pending_work(kind, session, name)",
    ],
    postgres: [
      'CREATE TABLE session_index (name TEXT COLLATE "C" PRIMARY KEY, session TEXT COLLATE "C" NOT NULL UNIQUE, parent TEXT COLLATE "C" NULL, sort_at DOUBLE PRECISION NOT NULL, version TEXT NOT NULL)',
      "CREATE INDEX session_index_activity ON session_index(sort_at, session)",
      "CREATE INDEX session_index_parent_activity ON session_index(parent, sort_at, session)",
      'CREATE TABLE pending_work (name TEXT COLLATE "C" PRIMARY KEY, session TEXT COLLATE "C" NOT NULL, kind TEXT NOT NULL)',
      "CREATE INDEX pending_work_session ON pending_work(session, kind, name)",
      "CREATE INDEX pending_work_kind ON pending_work(kind, session, name)",
    ],
  },
};

export const orderedSessionIndex: SchemaStep = {
  kind: "schema",
  name: "2026-10-14-session-index-order",
  sql: {
    sqlite: ["DROP TABLE session_index", "DROP TABLE pending_work", ...sessionIndex.sql.sqlite],
    postgres: ["DROP TABLE session_index", "DROP TABLE pending_work", ...sessionIndex.sql.postgres],
  },
};

const SESSION_SEQS = [
  "UPDATE session_index SET seq = ranked.place FROM (SELECT session, ROW_NUMBER() OVER (ORDER BY sort_at DESC, session DESC) AS place FROM session_index) ranked WHERE ranked.session = session_index.session",
  "INSERT INTO host_seq (id, seq) VALUES (1, (SELECT COUNT(*) FROM session_index)) ON CONFLICT (id) DO UPDATE SET seq = excluded.seq",
];

export const sessionSeqs: SchemaStep = {
  kind: "schema",
  name: "2026-11-03-session-seqs",
  sql: {
    sqlite: [
      "CREATE TABLE session_index_seq (name TEXT PRIMARY KEY, session TEXT NOT NULL UNIQUE, parent TEXT NULL, sort_at REAL NOT NULL, version TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0)",
      "INSERT INTO session_index_seq (name, session, parent, sort_at, version) SELECT name, session, parent, sort_at, version FROM session_index",
      "DROP TABLE session_index",
      "ALTER TABLE session_index_seq RENAME TO session_index",
      "CREATE INDEX session_index_activity ON session_index(sort_at, session)",
      "CREATE INDEX session_index_parent_activity ON session_index(parent, sort_at, session)",
      "CREATE TABLE IF NOT EXISTS host_seq (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL)",
    ],
    postgres: [
      "ALTER TABLE session_index ADD COLUMN IF NOT EXISTS seq BIGINT NOT NULL DEFAULT 0",
      "CREATE TABLE IF NOT EXISTS host_seq (id INTEGER PRIMARY KEY CHECK (id = 1), seq BIGINT NOT NULL)",
    ],
  },
  indexed: { sqlite: SESSION_SEQS, postgres: SESSION_SEQS },
};

/** Lets the directory select pinned roots and match a name from the index alone: `pinned` is 1 or 0 and `name_folded` the name in lower case. `session_index_pinned` leads with `pinned` and `parent` so the planner finds pinned roots by equality, in activity order, and a pinned read costs what it returns; a partial index on `pinned = 1` lost to `session_index_parent_activity`, which walks every root. SQLite rebuilds the table, as `sessionSeqs` does, because it cannot add a column only if it is missing. The migration projects every ref again to fill both, which keeps each row's `seq`. */
export const sessionIndexFilters: SchemaStep = {
  kind: "schema",
  name: "2026-11-05-session-index-filters",
  sql: {
    sqlite: [
      "CREATE TABLE session_index_filters (name TEXT PRIMARY KEY, session TEXT NOT NULL UNIQUE, parent TEXT NULL, sort_at REAL NOT NULL, version TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, name_folded TEXT NULL)",
      "INSERT INTO session_index_filters (name, session, parent, sort_at, version, seq) SELECT name, session, parent, sort_at, version, seq FROM session_index",
      "DROP TABLE session_index",
      "ALTER TABLE session_index_filters RENAME TO session_index",
      "CREATE INDEX session_index_activity ON session_index(sort_at, session)",
      "CREATE INDEX session_index_parent_activity ON session_index(parent, sort_at, session)",
      "CREATE INDEX session_index_pinned ON session_index(pinned, parent, sort_at, session)",
    ],
    postgres: [
      "ALTER TABLE session_index ADD COLUMN IF NOT EXISTS pinned INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE session_index ADD COLUMN IF NOT EXISTS name_folded TEXT NULL",
      "CREATE INDEX IF NOT EXISTS session_index_pinned ON session_index(pinned, parent, sort_at, session)",
    ],
  },
};
