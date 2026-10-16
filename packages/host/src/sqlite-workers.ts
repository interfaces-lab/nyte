import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { dev } from "@nyte-ai/core";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

type Role = "reader" | "checkpoint";

const rowSchema = Type.Record(
  Type.String(),
  Type.Union([Type.Null(), Type.String(), Type.Number(), Type.BigInt()]),
);

type Row = Static<typeof rowSchema>;

const replySchema = Type.Union([
  Type.Object({ ready: Type.Literal(true) }),
  Type.Object({ id: Type.Integer(), rows: Type.Array(rowSchema), executionMs: Type.Number() }),
  Type.Object({
    id: Type.Integer(),
    error: Type.String(),
    code: Type.Optional(Type.String()),
    errcode: Type.Optional(Type.Number()),
    errstr: Type.Optional(Type.String()),
  }),
]);

const source = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(workerData.path, {
  readOnly: workerData.role === "reader",
  timeout: 5000,
});
if (String(db.prepare("PRAGMA journal_mode").get().journal_mode).toLowerCase() !== "wal")
  throw new Error("SQLite workers require WAL mode");
if (workerData.role === "checkpoint") {
  const version = db.prepare("SELECT sqlite_version() AS version").get().version;
  const [major, minor] = version.split(".").map(Number);
  if (major < 3 || (major === 3 && minor < 51))
    throw new Error("SQLite " + version + " has no NOOP checkpoint");
  db.exec("PRAGMA synchronous = NORMAL; PRAGMA checkpoint_fullfsync = ON");
}
const statements = new Map();
const frames = workerData.role === "checkpoint" ? db.prepare("PRAGMA wal_checkpoint(NOOP)") : null;
const checkpoint = workerData.role === "checkpoint" ? db.prepare("PRAGMA wal_checkpoint(PASSIVE)") : null;
let idle;
parentPort.on("message", ({ id, sql, params }) => {
  const started = performance.now();
  try {
    let rows = [];
    if (workerData.role === "checkpoint") {
      const { log, checkpointed } = frames.get();
      if (log - checkpointed >= 1000) checkpoint.get();
      clearTimeout(idle);
      idle = setTimeout(() => {
        const { log, checkpointed } = frames.get();
        if (log >= 1000 && checkpointed < log) checkpoint.get();
      }, 100);
    } else {
      const size = params.reduce((total, value) => total + (typeof value === "string" ? value.length : ArrayBuffer.isView(value) ? value.byteLength : 0), 0);
      let statement = size > 65536 ? undefined : statements.get(sql);
      if (statement === undefined) {
        statement = db.prepare(sql);
        if (size <= 65536) {
          if (statements.size >= 16) statements.delete(statements.keys().next().value);
          statements.set(sql, statement);
        }
      }
      rows = statement.all(...params);
    }
    parentPort.postMessage({ id, rows, executionMs: performance.now() - started });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error.message), code: error.code, errcode: error.errcode, errstr: error.errstr });
  }
});
parentPort.postMessage({ ready: true });
`;

class SqliteWorker {
  readonly ready: Promise<boolean>;
  private worker: Worker | null;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (rows: readonly Row[]) => void; reject: (cause: Error) => void; at: number }
  >();
  private readonly stop: (cause: Error, notify: boolean) => Promise<number> | undefined;

  constructor(path: string, role: Role, unavailable: (cause: Error, started: boolean) => void) {
    const worker = new Worker(source, { eval: true, workerData: { path, role } });
    this.worker = worker;
    let started = false;
    let announce: (ready: boolean) => void = () => undefined;
    this.ready = new Promise((resolve) => {
      announce = resolve;
    });

    const timeout = setTimeout(() => {
      void this.stop(new Error("SQLite worker did not start within 10 seconds"), true);
    }, 10_000);

    timeout.unref();

    this.stop = (cause, notify) => {
      if (this.worker === null) return;
      this.worker = null;
      clearTimeout(timeout);
      announce(false);

      for (const request of this.pending.values()) request.reject(cause);
      this.pending.clear();

      if (notify) unavailable(cause, started);

      return worker.terminate();
    };

    worker.on("message", (reply: unknown) => {
      if (!Value.Check(replySchema, reply)) {
        void this.stop(new Error("Malformed SQLite worker reply"), true);

        return;
      }

      if ("ready" in reply) {
        clearTimeout(timeout);
        started = true;
        announce(true);

        if (this.pending.size === 0) worker.unref();

        return;
      }

      const request = this.pending.get(reply.id);

      if (request === undefined) return;
      this.pending.delete(reply.id);

      if (this.pending.size === 0) worker.unref();

      if ("error" in reply) {
        request.reject(Object.assign(new Error(reply.error), reply));
      } else {
        dev("sqlite", "query", {
          connection: role,
          durationMs: performance.now() - request.at,
          executionMs: reply.executionMs,
        });
        request.resolve(reply.rows);
      }
    });
    worker.on("error", (cause: unknown) => {
      void this.stop(cause instanceof Error ? cause : new Error(String(cause)), true);
    });
    worker.on("exit", (code) => {
      void this.stop(new Error(`SQLite ${role} worker exited with code ${code}`), true);
    });

    if (role === "checkpoint") worker.unref();
  }

  async query(sql: string, params: readonly SQLInputValue[]): Promise<readonly Row[] | undefined> {
    if (!(await this.ready)) return undefined;
    const worker = this.worker;

    if (worker === null) throw new Error("SQLite worker stopped");
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, at: performance.now() });
      worker.ref();

      try {
        worker.postMessage({ id, sql, params });
      } catch (cause) {
        this.pending.delete(id);

        if (this.pending.size === 0) worker.unref();
        reject(cause);
      }
    });
  }

  async close(): Promise<void> {
    await this.stop(new Error("SQLite worker closed"), false);
  }
}

export function sqliteWorkers(database: DatabaseSync, path: string) {
  let reader: SqliteWorker | null = null;
  let readerUnavailable = false;
  let closed = false;
  let checking = false;
  let checkAgain = false;
  let checkpoint: SqliteWorker | null = null;

  const warn = (role: Role, cause: Error) => {
    process.emitWarning(
      `SQLite ${role} worker unavailable; using the main connection: ${cause.message}`,
      {
        code: "NYTE_SQLITE_WORKER_UNAVAILABLE",
      },
    );
  };

  const handBack = (cause: Error) => {
    const stopped = checkpoint;
    checkpoint = null;
    void stopped?.close();

    if (closed) return;
    database.exec("PRAGMA wal_autocheckpoint = 1000");
    warn("checkpoint", cause);
  };

  try {
    checkpoint = new SqliteWorker(path, "checkpoint", handBack);
    void checkpoint.ready.then((ready) => {
      if (ready && !closed) database.exec("PRAGMA wal_autocheckpoint = 10000");
    });
  } catch (cause) {
    warn("checkpoint", cause instanceof Error ? cause : new Error(String(cause)));
  }

  const check = () => {
    if (checkpoint === null || closed) return;

    if (checking) {
      checkAgain = true;

      return;
    }

    checking = true;
    void checkpoint
      .query("", [])
      .catch((cause: unknown) => {
        if (checkpoint !== null)
          handBack(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        checking = false;

        if (checkAgain) {
          checkAgain = false;
          check();
        }
      });
  };

  return {
    check,
    async read(sql: string, params: readonly SQLInputValue[]) {
      if (closed) throw new Error("SQLite store closed");

      if (readerUnavailable) return undefined;

      if (reader === null) {
        try {
          reader = new SqliteWorker(path, "reader", (cause, started) => {
            reader = null;
            readerUnavailable = !started;
            warn("reader", cause);
          });
        } catch (cause) {
          readerUnavailable = true;
          warn("reader", cause instanceof Error ? cause : new Error(String(cause)));

          return undefined;
        }
      }

      return reader.query(sql, params);
    },
    async close() {
      closed = true;
      await Promise.all([reader?.close(), checkpoint?.close()]);
    },
  };
}
