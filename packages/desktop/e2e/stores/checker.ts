import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export interface HarnessEvent {
  readonly kind: "launch" | "exit" | "kill" | "pause" | "resume" | "quiesce" | "stop";
  readonly at: number;
  readonly pid?: number;
  readonly role?: "member" | "sender";
  readonly session?: string;
  readonly text?: string;
  readonly code?: number | null;
  readonly signal?: string | null;
  readonly ms?: number;
  readonly output?: string;
}

export const ORPHAN_BOUND_MS = 30_000;

interface AuditRow {
  readonly id: number;
  readonly at: number;
  readonly pid: number;
  readonly writer: string | null;
  readonly name: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly target: string | null;
}

export interface Report {
  readonly summary: Record<string, number | string>;
  readonly violations: readonly string[];
  readonly takeovers: readonly { readonly lease: string; readonly afterKillMs: number }[];
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function record(body: string | null): Record<string, unknown> | null {
  if (body === null) return null;
  const parsed: unknown = JSON.parse(body);

  if (typeof parsed !== "object" || parsed === null || !("body" in parsed)) return null;
  const inner: unknown = parsed.body;

  return typeof inner === "object" && inner !== null && !Array.isArray(inner)
    ? Object.fromEntries(Object.entries(inner))
    : null;
}

function writerInstance(writer: string | null): string | null {
  return writer?.startsWith("processes/") === true ? writer.slice("processes/".length) : null;
}

export function checkHistory(input: {
  readonly store: string;
  readonly marks: string;
  readonly history: readonly HarnessEvent[];
  readonly seed: number;
}): Report {
  const violations: string[] = [];
  const database = new DatabaseSync(input.store, { readOnly: true, timeout: 10_000 });

  try {
    const bodies = new Map<string, string | null>();

    const objectBody = (id: string | null): string | null => {
      if (id === null) return null;

      if (!bodies.has(id)) {
        const row = database.prepare("SELECT body FROM objects WHERE id = ?").get(id);
        bodies.set(id, text(row?.body));
      }

      return bodies.get(id) ?? null;
    };

    const rows: AuditRow[] = database
      .prepare(
        "SELECT id, at, pid, writer, name, before, after, target FROM store_audit ORDER BY id",
      )
      .all()
      .map((row) => ({
        id: number(row.id),
        at: number(row.at),
        pid: number(row.pid),
        writer: text(row.writer),
        name: text(row.name) ?? "",
        before: text(row.before),
        after: text(row.after),
        target: text(row.target),
      }));

    const runHeads = new Map<string, string>();

    for (const row of database
      .prepare(
        "SELECT session, json_extract(event, '$.run') AS run, json_extract(event, '$.view.head') AS head FROM log WHERE json_extract(event, '$.kind') = 'run' AND json_extract(event, '$.change') = 'started'",
      )
      .all())
      runHeads.set(`${text(row.session) ?? ""}/${text(row.run) ?? ""}`, text(row.head) ?? "main");

    const leases = new Map<string, string | null>();
    const lastTarget = new Map<string, string | null>();
    const lastAfter = new Map<string, string | null>();
    const pidOf = new Map<string, number>();
    const leaseWrites = new Map<string, AuditRow[]>();
    let advancements = 0;
    let unfenced = 0;

    const requireHolder = (row: AuditRow, session: string, head: string, what: string): void => {
      advancements += 1;
      const lease = `sessions/${session}/leases/${head}`;
      const holder = leases.get(lease) ?? null;
      const writer = writerInstance(row.writer);

      if (writer === null) {
        unfenced += 1;
        violations.push(
          `audit ${String(row.id)}: ${what} ${row.name} written without a presence fence`,
        );

        return;
      }

      if (holder !== writer)
        violations.push(
          `audit ${String(row.id)}: ${what} ${row.name} by ${writer} (pid ${String(row.pid)}) while ${holder ?? "nobody"} held ${lease}`,
        );
    };

    let zombies = 0;

    for (const row of rows) {
      const previous = lastAfter.has(row.name) ? (lastAfter.get(row.name) ?? null) : null;
      const author = writerInstance(row.writer);

      if (author !== null && (lastAfter.get(`processes/${author}`) ?? null) === null) {
        zombies += 1;
        violations.push(
          `audit ${String(row.id)}: ${row.name} written by ${author} (pid ${String(row.pid)}) after its presence was gone`,
        );
      }

      if (row.before !== previous)
        violations.push(
          `audit ${String(row.id)}: ${row.name} moved from ${row.before ?? "absent"} but the history holds ${previous ?? "absent"}`,
        );
      lastAfter.set(row.name, row.after);
      const parts = row.name.split("/");

      if (parts[0] === "processes" && row.before === null && row.target !== null) {
        const body = record(objectBody(row.target));
        const pid = body?.pid;

        if (typeof pid === "number") pidOf.set(parts[1] ?? "", pid);
      }

      if (parts[0] === "sessions" && parts[2] === "leases") {
        const body = record(objectBody(row.target));
        const holder = row.target === null ? null : text(body?.instance);
        leases.set(row.name, holder);
        leaseWrites.set(row.name, [...(leaseWrites.get(row.name) ?? []), row]);

        if (holder !== null && holder !== writerInstance(row.writer))
          violations.push(
            `audit ${String(row.id)}: ${row.name} claimed for ${holder} by ${row.writer ?? "an unfenced writer"}`,
          );
      }

      const session = parts[1] ?? "";

      if (parts[0] === "sessions" && parts[2] === "heads" && row.before !== null)
        requireHolder(row, session, parts[3] ?? "", "head move");

      if (parts[0] === "sessions" && parts[2] === "calls") {
        const before = record(objectBody(lastTarget.get(row.name) ?? null));
        const after = record(objectBody(row.target));
        const run = text(after?.run) ?? text(before?.run);
        const opened = after?.kind === "tool" && (before === null || before.kind === "intent");

        const settled =
          after !== null && after.result !== null && (before === null || before.result === null);

        if (run !== null && (opened || settled))
          requireHolder(
            row,
            session,
            runHeads.get(`${session}/${run}`) ?? "main",
            settled ? "call settle" : "call open",
          );
      }

      if (parts[0] === "sessions" && parts[2] === "runs" && row.before !== null) {
        const before = record(objectBody(lastTarget.get(row.name) ?? null));
        const after = record(objectBody(row.target));

        if (after === null || before?.phase !== after.phase)
          requireHolder(
            row,
            session,
            runHeads.get(`${session}/${parts[3] ?? ""}`) ?? "main",
            after === null ? "run end" : "run phase",
          );
      }

      lastTarget.set(row.name, row.target);
    }

    for (const row of database.prepare("SELECT name, revision FROM refs").all()) {
      const name = text(row.name) ?? "";

      if (!lastAfter.has(name)) violations.push(`ref ${name} exists but no audited write made it`);
      else if (lastAfter.get(name) !== text(row.revision))
        violations.push(
          `ref ${name} is at ${text(row.revision) ?? "?"} but its last audited write left ${lastAfter.get(name) ?? "absent"}`,
        );
    }

    const present = new Set(
      database
        .prepare("SELECT name FROM refs")
        .all()
        .map((row) => text(row.name) ?? ""),
    );

    for (const [name, after] of lastAfter)
      if (after !== null && !present.has(name))
        violations.push(`ref ${name} was committed at ${after} and is gone`);

    const tokens = new Map<string, number>();

    for (const line of readFileSync(input.marks, "utf8").split("\n"))
      if (line.startsWith("T")) tokens.set(line, (tokens.get(line) ?? 0) + 1);

    for (const [token, count] of tokens)
      if (count > 1) violations.push(`non-replayable command ${token} ran ${String(count)} times`);

    const instancesRunBy = (pid: number): string[] =>
      [...pidOf].flatMap(([instance, owner]) => (owner === pid ? [instance] : []));

    const takeovers: { lease: string; afterKillMs: number }[] = [];

    const runnersAt = (at: number): boolean => {
      const state = new Map<number, "alive" | "paused" | "gone">();

      for (const event of input.history) {
        if (event.at > at || event.pid === undefined) continue;

        if (event.kind === "launch" || event.kind === "resume") state.set(event.pid, "alive");
        else if (event.kind === "pause") state.set(event.pid, "paused");
        else if (event.kind === "kill" || event.kind === "exit" || event.kind === "stop")
          state.set(event.pid, "gone");
      }

      return [...state.values()].includes("alive");
    };

    let conditional = 0;

    for (const kill of input.history) {
      if (kill.kind !== "kill" || kill.pid === undefined) continue;
      const mine = new Set(instancesRunBy(kill.pid));

      for (const [lease, writes] of leaseWrites) {
        const held = writes.findLast((row) => row.at <= kill.at);

        const holder = held === undefined ? null : text(record(objectBody(held.target))?.instance);

        if (held === undefined || holder === null || !mine.has(holder)) continue;
        const next = writes.find((row) => row.id > held.id);

        const covered = [0, 5_000, 10_000, 15_000, 20_000, 25_000].every((offset) =>
          runnersAt(kill.at + offset),
        );

        if (next === undefined) {
          if (covered)
            violations.push(
              `${lease}, held by killed pid ${String(kill.pid)}, was never taken over`,
            );
          else conditional += 1;
          continue;
        }

        const afterKillMs = next.at - kill.at;
        takeovers.push({ lease, afterKillMs });

        if (afterKillMs > ORPHAN_BOUND_MS) {
          if (covered)
            violations.push(
              `${lease}, held by killed pid ${String(kill.pid)}, was taken over after ${String(afterKillMs)} ms`,
            );
          else conditional += 1;
        }
      }
    }

    const live = database
      .prepare("SELECT count(*) AS n FROM refs WHERE name LIKE 'sessions/%/live/%'")
      .get();

    if (number(live?.n) > 0)
      violations.push(`${String(number(live?.n))} runs are still live after the quiesce`);
    const check = text(database.prepare("PRAGMA integrity_check").get()?.integrity_check);

    if (check !== "ok") violations.push(`integrity_check: ${check ?? "no answer"}`);

    const ended = database
      .prepare(
        "SELECT json_extract(event, '$.end.kind') AS kind, json_extract(event, '$.end.failure.message') AS message FROM log WHERE json_extract(event, '$.kind') = 'run' AND json_extract(event, '$.change') = 'ended'",
      )
      .all();

    const parked = ended.filter((row) =>
      (text(row.message) ?? "").startsWith("Stopped after Nyte was interrupted"),
    ).length;

    const interrupted = number(
      database
        .prepare(
          "SELECT count(*) AS n FROM log WHERE json_extract(event, '$.kind') = 'call' AND json_extract(event, '$.change') = 'settled' AND json_extract(event, '$.outcome.kind') = 'interrupted'",
        )
        .get()?.n,
    );

    const sorted = takeovers.map((entry) => entry.afterKillMs).sort((left, right) => left - right);

    return {
      summary: {
        seed: input.seed,
        auditRows: rows.length,
        advancementsChecked: advancements,
        unfenced,
        zombies,
        processes: pidOf.size,
        kills: input.history.filter((event) => event.kind === "kill").length,
        pauses: input.history.filter((event) => event.kind === "pause").length,
        launches: input.history.filter((event) => event.kind === "launch").length,
        runsEnded: ended.length,
        runsCompleted: ended.filter((row) => text(row.kind) === "completed").length,
        runsParked: parked,
        callsInterrupted: interrupted,
        commandsRun: tokens.size,
        takeoversAfterKill: takeovers.length,
        takeoverMaxMs: sorted.at(-1) ?? 0,
        takeoverP50Ms: sorted[Math.floor(sorted.length / 2)] ?? 0,
        orphansWithoutRunners: conditional,
        integrity: check ?? "none",
        violations: violations.length,
      },
      violations,
      takeovers,
    };
  } finally {
    database.close();
  }
}
