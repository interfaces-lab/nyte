import { asId } from "@nyte-ai/schema";
import type { Execution } from "@nyte-ai/sdk";
import {
  INTERRUPTED,
  NEEDS_INPUT,
  RUNNING,
  RUN_VIEW,
  WORKING,
  call,
  custom,
  executing,
  ok,
  part,
  read,
  responding,
  said,
  shell,
  thought,
  touched,
  turn,
  user,
} from "../../../src/messages/build";
import type { Scene } from "../../../src/messages/build";
import { staged } from "../app/staging";
import type { Staged } from "../app/staging";
import { beats } from "./timeline";

export const prompt = "Migrate stored runs on open.";
export const edited = "Migrate stored runs on open. Keep the old format readable.";

const asking: Execution = { kind: "waiting", run: RUN_VIEW, on: { kind: "part", part: asId<"part">("film-question") } };

const LIVE_THOUGHT = { kind: "live", run: RUN_VIEW.id } as const;

/** Every message the session ever shows, built once so ids hold still between frames. */
const m = {
  ask: user(prompt, 0),
  reading: thought("Reading the store", 2, LIVE_THOUGHT),
  read: thought("Reading the store", 2),
  store: call(read("packages/core/src/store.ts"), ok(), 3),
  migrations: call(read("packages/core/src/store/migrations.ts"), ok(), 4),
  edit: call(touched("packages/core/src/store/migrations.ts"), ok(), 6),
  testing: call(shell("pnpm --dir packages/core test"), RUNNING, 8),
  interrupted: call(shell("pnpm --dir packages/core test"), INTERRUPTED, 8),
  retest: call(shell("pnpm --dir packages/core test"), ok(), 40, "212 passed"),
  done: said("212 of 212 tests pass. Stored runs migrate the first time a session opens.", 44),

  edit2: user(edited, 60),
  summary: part("branchSummary", "note", { markdown: "The first branch migrated every stored run in place and dropped the old format." }, 60),
  thinking2: thought("Keeping both formats", 62, LIVE_THOUGHT),
  thought2: thought("Keeping both formats", 62),
  records: call(read("packages/core/src/contract/records.ts"), ok(), 63),
  question: call(custom("Ask user"), NEEDS_INPUT, 64),
  answered: call(custom("Ask user"), ok(), 64),
  edit3: call(touched("packages/core/src/contract/records.ts"), ok(), 200),
  edit4: call(touched("packages/core/src/store/migrations.ts"), ok(), 201),
  done2: said("Old runs stay readable. New runs write the new format, and 214 of 214 tests pass.", 204),
};

interface Snapshot {
  readonly from: number;
  readonly scene: Scene;
}

const snapshots: readonly Snapshot[] = [
  { from: 0, scene: { turns: [] } },
  { from: beats.send, scene: { turns: [turn([m.ask], WORKING)], execution: responding() } },
  { from: beats.send + 15, scene: { turns: [turn([m.ask, m.reading], WORKING)], execution: responding() } },
  { from: beats.send + 30, scene: { turns: [turn([m.ask, m.read, m.store], WORKING)], execution: executing() } },
  { from: beats.send + 45, scene: { turns: [turn([m.ask, m.read, m.store, m.migrations], WORKING)], execution: executing() } },
  { from: beats.send + 60, scene: { turns: [turn([m.ask, m.read, m.store, m.migrations, m.edit], WORKING)], execution: executing() } },
  { from: beats.send + 75, scene: { turns: [turn([m.ask, m.read, m.store, m.migrations, m.edit, m.testing], WORKING)], execution: executing() } },
  { from: beats.reopen, scene: { turns: [turn([m.ask, m.read, m.store, m.migrations, m.edit, m.interrupted], WORKING)], execution: executing() } },
  { from: beats.reopen + 45, scene: { turns: [turn([m.ask, m.read, m.store, m.migrations, m.edit, m.interrupted, m.retest], WORKING)], execution: executing() } },
  { from: beats.reopen + 75, scene: { turns: [turn([m.ask, m.read, m.store, m.migrations, m.edit, m.interrupted, m.retest, m.done])] } },
  { from: beats.branch, scene: { turns: [turn([m.edit2, m.summary], WORKING)], execution: responding() } },
  { from: beats.branch + 15, scene: { turns: [turn([m.edit2, m.summary, m.thinking2], WORKING)], execution: responding() } },
  { from: beats.branch + 30, scene: { turns: [turn([m.edit2, m.summary, m.thought2, m.records], WORKING)], execution: executing() } },
  { from: beats.ask, scene: { turns: [turn([m.edit2, m.summary, m.thought2, m.records, m.question], WORKING)], execution: asking } },
  { from: beats.answer + 10, scene: { turns: [turn([m.edit2, m.summary, m.thought2, m.records, m.answered], WORKING)], execution: executing() } },
  { from: beats.answer + 30, scene: { turns: [turn([m.edit2, m.summary, m.thought2, m.records, m.answered, m.edit3, m.edit4], WORKING)], execution: executing() } },
  { from: beats.answer + 55, scene: { turns: [turn([m.edit2, m.summary, m.thought2, m.records, m.answered, m.edit3, m.edit4, m.done2])] } },
];

const stages = snapshots.map((snapshot) => ({ from: snapshot.from, stage: staged(snapshot.scene) }));

/** The session as the app would show it on this frame. */
export function sessionAt(frame: number): Staged {
  const found = stages.filter((entry) => entry.from <= frame).at(-1) ?? stages[0];
  if (!found) throw new Error("The film has no session snapshots");
  return found.stage;
}

/** Where the session stands, for its sidebar row and its glyph. */
export function markAt(frame: number): "working" | "waiting" | "done" {
  if (frame >= beats.ask && frame < beats.answer + 10) return "waiting";
  if (frame >= beats.answer + 55 || (frame >= beats.reopen + 75 && frame < beats.branch)) return "done";
  if (frame < beats.send) return "done";
  return "working";
}
