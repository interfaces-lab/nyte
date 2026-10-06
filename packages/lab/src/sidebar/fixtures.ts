/**
 * One workspace's chats in every state the rail draws, and the moves a host
 * makes on them. Times count back from the moment the page loads.
 */
import { sessionId } from "@nyte-ai/protocol";
import type { RunInfo, RunPhase, SessionInfo } from "@nyte-ai/protocol";

const MINUTE = 60_000;

interface Seed {
  readonly id: string;
  readonly name?: string;
  readonly phase?: RunPhase;
  readonly question?: string;
  readonly minutesAgo: number;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  /** Opened since its last run finished. */
  readonly read?: boolean;
}

const SEEDS: readonly Seed[] = [
  {
    id: "drafts-pane",
    name: "Move composer drafts to pane state",
    phase: { kind: "waiting" },
    question: "Keep the old storage key for one release?",
    minutesAgo: 4,
  },
  {
    id: "tar-listing",
    name: "Fix tar listing on Linux",
    phase: { kind: "failed", failure: { class: "network", message: "Connection reset" } },
    minutesAgo: 12,
  },
  {
    id: "host-split",
    name: "Split host-server.ts into routes",
    phase: { kind: "tools" },
    minutesAgo: 41,
  },
  {
    id: "shadows",
    name: "Audit floating surface shadows",
    phase: { kind: "respond" },
    minutesAgo: 3,
  },
  {
    id: "cold-start",
    name: "Bench cold start on Intel",
    phase: { kind: "waiting" },
    minutesAgo: 9,
  },
  { id: "titlebar", name: "Review titlebar alignment", phase: { kind: "done" }, minutesAgo: 6 },
  {
    id: "archive-undo",
    name: "Explain archive undo in session-actions",
    phase: { kind: "done" },
    minutesAgo: 25,
  },
  { id: "untitled", minutesAgo: 2 },
  {
    id: "release",
    name: "Release checklist 0.0.16",
    phase: { kind: "done" },
    minutesAgo: 240,
    pinned: true,
    read: true,
  },
  {
    id: "update-copy",
    name: "Tighten update notice copy",
    phase: { kind: "done" },
    minutesAgo: 50,
    read: true,
  },
  {
    id: "bun-apis",
    name: "Remove Bun-only APIs from main",
    phase: { kind: "done" },
    minutesAgo: 180,
    read: true,
  },
  {
    id: "tints",
    name: "Map translucent tints to tokens",
    phase: { kind: "done" },
    minutesAgo: 1_500,
    read: true,
  },
  {
    id: "settled",
    name: "Port the settled shelf from t3code",
    phase: { kind: "aborted" },
    minutesAgo: 2_900,
  },
  {
    id: "rename",
    name: "Rename Uji to Nyte",
    phase: { kind: "done" },
    minutesAgo: 9_000,
    archived: true,
    read: true,
  },
  {
    id: "bun-build",
    name: "Try Bun for the CLI build",
    phase: { kind: "done" },
    minutesAgo: 20_000,
    archived: true,
    read: true,
  },
];

/** The same start time names the same run, so a phase change keeps its identity. */
function run(id: string, phase: RunPhase, startedAt: number, question?: string): RunInfo {
  const runId = `${id}@${String(startedAt)}`;

  const info: RunInfo = {
    runId,
    head: "main",
    origin: { kind: "user" },
    root: runId,
    phase,
    startedAt,
    attempts: 1,
    config: {},
  };

  return question === undefined ? info : { ...info, awaitingReply: true, question };
}

function chat(seed: Seed, now: number): SessionInfo {
  const at = now - seed.minutesAgo * MINUTE;

  return {
    sessionId: sessionId(`lab-${seed.id}`),
    activation: { kind: "active" },
    workspace: { kind: "local", id: "lab", cwd: "/Users/lab/nyte" },
    name: seed.name,
    createdAt: at - 30 * MINUTE,
    lastActivityAt: at,
    pinned: seed.pinned === true,
    archived: seed.archived === true,
    config: {},
    heads:
      seed.phase === undefined
        ? []
        : [{ head: "main", tip: null, run: run(seed.id, seed.phase, at, seed.question) }],
  };
}

export function seedChats(now: number) {
  const sessions = SEEDS.map((seed) => chat(seed, now));

  return {
    sessions,
    opened: sessions.filter((_session, index) => SEEDS[index]?.read === true),
  };
}

/** Unsent composer text; the rail lists it as a draft row ahead of every chat. */
export interface ComposerDraft {
  readonly id: string;
  readonly text: string;
  readonly updatedAt: number;
}

export function seedDrafts(now: number): readonly ComposerDraft[] {
  return [
    {
      id: "draft-archive",
      text: "Make archive one click on every row",
      updatedAt: now - 7 * MINUTE,
    },
  ];
}

function startedAt(session: SessionInfo, now: number): number {
  return session.heads[0]?.run?.startedAt ?? now;
}

function withRun(session: SessionInfo, info: RunInfo, now: number): SessionInfo {
  return { ...session, lastActivityAt: now, heads: [{ head: "main", tip: null, run: info }] };
}

export function finishRun(session: SessionInfo, now: number): SessionInfo {
  return withRun(session, run(session.sessionId, { kind: "done" }, startedAt(session, now)), now);
}

export function askQuestion(session: SessionInfo, question: string, now: number): SessionInfo {
  return withRun(
    session,
    run(session.sessionId, { kind: "waiting" }, startedAt(session, now), question),
    now,
  );
}

/** A message starts a new run and brings an archived chat back. */
export function sendMessage(session: SessionInfo, text: string, now: number): SessionInfo {
  return {
    ...withRun(session, run(session.sessionId, { kind: "respond" }, now), now),
    archived: false,
    preview: session.name === undefined ? (session.preview ?? text) : session.preview,
  };
}

export function blankChat(now: number): SessionInfo {
  return chat({ id: `new-${String(now)}`, minutesAgo: 0 }, now);
}

export function latestRunStart(session: SessionInfo): number {
  return session.heads.reduce((latest, head) => Math.max(latest, head.run?.startedAt ?? 0), 0);
}
