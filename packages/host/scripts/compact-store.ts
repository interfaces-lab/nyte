import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { decodeObject, loggedEvent, STORE_VERSION } from "@nyte-ai/core/store";
import { isJsonObject } from "@nyte-ai/schema";
import type { FileChange, Seq } from "@nyte-ai/schema";
import { claimStore } from "../src/store-owner.ts";
import { parseNumber, parseText } from "../src/store-rows.ts";

interface Rewrite {
  readonly seq: Seq;
  readonly event: string;
}

interface Plan {
  readonly session: string;
  readonly rewrites: readonly Rewrite[];
  readonly before: number;
  readonly after: number;
}

const started = performance.now();

const path = process.argv[2] ?? join(homedir(), ".nyte", "nyte.db");

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

const fileSize = (file: string) => (existsSync(file) ? statSync(file).size : 0);

const storeSize = () => fileSize(path) + fileSize(`${path}-wal`);

function mergeFiles(kept: readonly FileChange[], files: readonly FileChange[]) {
  if (kept.length === 0) return files;
  const merged = new Map(kept.map((file) => [file.path, file]));

  for (const file of files) merged.set(file.path, file);

  return [...merged.values()];
}

function planSession(database: DatabaseSync, session: string): Plan {
  let kept: readonly FileChange[] = [];
  const rewrites: Rewrite[] = [];
  let before = 0;
  let after = 0;

  for (const row of database
    .prepare(
      "SELECT seq, at, event FROM log WHERE session = ? AND json_extract(event, '$.kind') = 'changes' ORDER BY seq",
    )
    .iterate(session)) {
    const text = parseText(row.event) ?? "";
    const body = decodeObject(text);
    const event = loggedEvent(parseNumber(row.seq), parseNumber(row.at), body);
    const bytes = Buffer.byteLength(text);
    before += bytes;

    if (event.kind !== "changes" || !isJsonObject(body)) {
      after += bytes;
      continue;
    }

    const next = mergeFiles(kept, event.files);
    const listed = new Map(kept.map((file) => [file.path, JSON.stringify(file)]));
    const delta = event.files.filter((file) => listed.get(file.path) !== JSON.stringify(file));

    if (
      delta.length < event.files.length &&
      JSON.stringify(mergeFiles(kept, delta)) === JSON.stringify(next)
    ) {
      const rewritten = JSON.stringify({ ...body, files: delta });
      rewrites.push({ seq: event.seq, event: rewritten });
      after += Buffer.byteLength(rewritten);
    } else after += bytes;

    kept = next;
  }

  return { session, rewrites, before, after };
}

function lockStore(): DatabaseSync {
  const database = new DatabaseSync(path, { timeout: 1_000 });

  try {
    database.exec("PRAGMA locking_mode = EXCLUSIVE");
    database.exec("BEGIN EXCLUSIVE");
    database.exec("COMMIT");
  } catch (cause) {
    database.close();

    throw new Error(
      `Another process has ${path} open. Quit Nyte and its service, then run this again.`,
      { cause },
    );
  }

  return database;
}

function checkVersion(database: DatabaseSync): void {
  const tables = new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => parseText(row.name)),
  );

  if (!tables.has("log") || !tables.has("store_meta"))
    throw new Error(`${path} is not a Nyte store: it has no log or store_meta table.`);

  const version = parseNumber(
    database.prepare("SELECT version FROM store_meta WHERE id = 1").get()?.version ?? 0,
  );

  if (version > STORE_VERSION)
    throw new Error(
      `${path} is at store version ${version}, newer than this checkout's ${STORE_VERSION}. Update the checkout and run this again.`,
    );
}

function compact(database: DatabaseSync): void {
  checkVersion(database);
  const sizeBefore = storeSize();

  const plans = database
    .prepare("SELECT DISTINCT session FROM log WHERE json_extract(event, '$.kind') = 'changes'")
    .all()
    .map((row) => planSession(database, parseText(row.session) ?? ""));

  const touched = plans.filter((plan) => plan.rewrites.length > 0);
  const free = parseNumber(database.prepare("PRAGMA freelist_count").get()?.freelist_count ?? 0);

  if (touched.length === 0 && free === 0) {
    console.log(`Nothing to compact in ${path}: every changes event already holds only its delta.`);

    return;
  }

  if (touched.length > 0) {
    const folder = join(dirname(path), "backups");
    mkdirSync(folder, { recursive: true, mode: 0o700 });

    const backup = join(
      folder,
      `manual-${new Date().toISOString().replaceAll(":", "-")}-before-compact-changes.db`,
    );

    database.prepare("VACUUM INTO ?").run(backup);
    chmodSync(backup, 0o600);
    console.log(`Backed up ${path} to ${backup}.`);
  }

  const hasCheckpoints =
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fold_checkpoints'")
      .get() !== undefined;

  const relog = database.prepare("UPDATE log SET event = ? WHERE session = ? AND seq = ?");

  const forget = hasCheckpoints
    ? database.prepare("DELETE FROM fold_checkpoints WHERE session = ?")
    : null;

  let forgotten = 0;

  for (const plan of touched) {
    database.exec("BEGIN IMMEDIATE");

    try {
      for (const rewrite of plan.rewrites) relog.run(rewrite.event, plan.session, rewrite.seq);
      forgotten += Number(forget?.run(plan.session).changes ?? 0);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");

      throw error;
    }
  }

  const before = plans.reduce((total, plan) => total + plan.before, 0);
  const after = plans.reduce((total, plan) => total + plan.after, 0);
  const rewritten = touched.reduce((total, plan) => total + plan.rewrites.length, 0);

  console.log(
    `Rewrote ${rewritten} changes events in ${touched.length} sessions to their deltas: ${megabytes(before)} -> ${megabytes(after)}. Dropped ${forgotten} fold checkpoints.`,
  );

  database.exec("VACUUM");
  database.exec("PRAGMA wal_checkpoint(TRUNCATE)");

  console.log(
    `Vacuumed ${path}: ${megabytes(sizeBefore)} -> ${megabytes(storeSize())} on disk in ${((performance.now() - started) / 1_000).toFixed(1)} s.`,
  );
}

function run(): void {
  if (!existsSync(path)) throw new Error(`No store at ${path}.`);
  const release = claimStore(path);

  try {
    const database = lockStore();

    try {
      compact(database);
    } finally {
      database.close();
    }
  } finally {
    release();
  }
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
