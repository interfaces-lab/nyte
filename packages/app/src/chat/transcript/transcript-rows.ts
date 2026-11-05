import type { Message, SessionView } from "@nyte-ai/sdk";
import {
  showsAnswer,
  showsReport,
  showsThinking,
  showsTool,
} from "@nyte-ai/plugin/client/presentation";
import type {
  failureNotice,
  TextMessage,
  ToolMessage,
  UserMessage,
} from "@nyte-ai/plugin/client/presentation";
import type { ToolCallDensity } from "../../preferences/index.ts";
import type { WatchStore } from "../../data/watch-store.ts";
import type { HeadView } from "@nyte-ai/sdk/client";
import { CHANGES_VISIBLE_FILES } from "../../diff/change-tree.ts";
import { conversationTurns } from "./turns.ts";
import type { TurnMessages } from "./turns.ts";
import { displayTranscriptParts, transcriptSlot } from "./transcript-presentation.ts";
import type {
  StepMessage,
  TranscriptDisplayPart,
  TranscriptSlot,
} from "./transcript-presentation.ts";
import type { Reply } from "./transcript-unread.ts";

export interface RowLayout {
  readonly key: string;
  readonly group: string | null;
  readonly leads: boolean;
  readonly sticky: boolean;
}

const OUTSIDE = { group: null, leads: true, sticky: false } as const;

type Failure = Parameters<typeof failureNotice>[0];

export type TurnItemRow =
  | (RowLayout & { readonly kind: "part"; readonly message: Message })
  | (RowLayout & {
      readonly kind: "step";
      readonly messages: readonly StepMessage[];
      readonly added: number;
      readonly removed: number;
      readonly running: boolean;
    })
  | (RowLayout & { readonly kind: "agents"; readonly messages: readonly ToolMessage[] })
  | (RowLayout & ResponseRow)
  | (RowLayout & { readonly kind: "failure"; readonly failure: Failure });

type ResponseRow = { readonly kind: "response"; readonly messages: readonly TextMessage[] } & (
  | { readonly ended: false }
  | {
      readonly ended: true;
      readonly latest: boolean;
      readonly workedMs: number | undefined;
    }
);

/** Marks the steps of a turn between its prompt and its first loaded message as not loaded. */
type EarlierRow = RowLayout & { readonly kind: "earlier" };

export type PromptRow = RowLayout & {
  readonly kind: "prompt";
  readonly message: UserMessage;
  readonly pending: boolean;
  readonly held: boolean;
};

export type TranscriptRow =
  | (RowLayout & { readonly kind: "skeleton" })
  | (RowLayout & { readonly kind: "error" })
  | TurnItemRow
  | EarlierRow
  | PromptRow
  | (RowLayout & { readonly kind: "retry"; readonly message: string })
  | (RowLayout & { readonly kind: "live"; readonly state: LiveRowState })
  | (RowLayout & {
      readonly kind: "changes";
      readonly state: "pending" | "ready";
      readonly files: SessionView["changes"];
    });

/** A `grouped` live row says nothing until planning runs slow, because the turn's active step group already shows the run working. */
export type LiveRowState = "idle" | "planning" | "grouped";

/** Belongs to the reader's visit, not the view, so the transcript inserts it into the projected rows. */
export type DividerRow = RowLayout & { readonly kind: "divider" };

const NO_USERS: readonly never[] = [];

function present<T extends UserMessage>(messages: readonly T[]): readonly T[] {
  return messages.length === 0 ? NO_USERS : messages;
}

function runState(view: ProjectedView | undefined) {
  const execution = view?.execution;

  return {
    running: execution !== undefined && execution.kind !== "idle",
    retrying: execution?.kind === "retrying" ? execution.reason : undefined,
  };
}

function readWorking(running: boolean, held: boolean, prompts: readonly UserMessage[]): boolean {
  return (
    running || prompts.some((message) => !held || (!showsReport(message) && !showsAnswer(message)))
  );
}

export function conversationMessages(view: ProjectedView | undefined) {
  const { running } = runState(view);
  const held = view?.reportsHeld ?? false;
  const turns = new Set(view?.turns.map((turn) => turn.id));
  const queue = view?.queue ?? [];

  const prompts = (view?.messages ?? []).filter(
    (message): message is UserMessage => message.kind === "user" && !turns.has(message.turn),
  );

  return {
    running,
    held,
    working: readWorking(running, held, prompts),
    prompts: present(prompts),
    queued: present(queue.filter((message) => message.status.kind === "pending")),
    unsent: present(queue.filter((message) => message.status.kind === "unsent")),
  };
}

/** A user's prompt is drawn sticky from the moment it is sent, so its row keeps one DOM shape when it joins its turn; only inside a turn does it stick. */
function sticksToTop(message: Message): boolean {
  return message.kind === "user" && !showsReport(message) && !showsAnswer(message);
}

/** A prompt joining a running run lands in that run's turn, so only a prompt that opens its own turn takes the footer. */
function opensTurn(message: UserMessage): boolean {
  const { status } = message;

  return (
    status.kind !== "pending" ||
    (status.schedule.kind !== "joined" && status.schedule.kind !== "attached")
  );
}

/** The last step group stays active through the gap before its run's next step. A waiting or retrying run keeps it active only for a call still in flight, such as one awaiting approval. */
function turnRows(
  turn: TurnMessages,
  place: {
    readonly group: string;
    readonly leads: boolean;
    readonly working: boolean;
    readonly retrying: boolean;
    readonly latest: boolean;
  },
) {
  const rows: (TurnItemRow | EarlierRow)[] = [];
  const { state } = turn.info;

  const at = (): Pick<RowLayout, "group" | "leads"> => ({
    group: place.group,
    leads: place.leads && rows.length === 0,
  });

  if (turn.messages.length === 0 && state.kind !== "ended") return rows;
  const display = displayTranscriptParts(turn.messages);
  const stepping = state.kind === "working" && !place.retrying;

  for (const [index, item] of display.entries()) {
    if (item.kind === "part") {
      const { message } = item;

      rows.push({
        kind: "part",
        key: message.kind === "user" ? `prompt:${message.id}` : message.id,
        ...at(),
        sticky: sticksToTop(message),
        message,
      });

      if (turn.clipped && index === 0)
        rows.push({
          kind: "earlier",
          key: `earlier:${turn.info.id}`,
          ...at(),
          sticky: false,
        });
      continue;
    }

    const [first] = item.messages;

    if (first === undefined) continue;
    const ends = index === display.length - 1;
    const layout = { ...at(), sticky: false };

    switch (item.kind) {
      case "step":
        rows.push({
          kind: "step",
          key: `step:${first.id}`,
          ...layout,
          messages: item.messages,
          ...stepChanges(item.messages),
          running: ends && place.working && (stepping || item.messages.some(inFlight)),
        });
        break;
      case "agents":
        rows.push({
          kind: "agents",
          key: `agents:${first.id}`,
          ...layout,
          messages: item.messages,
        });
        break;
      case "response":
        rows.push({
          kind: "response",
          key: `response:${first.id}`,
          ...layout,
          messages: item.messages,
          ...(ends && state.kind === "ended"
            ? {
                ended: true,
                latest: place.latest,
                workedMs: workedMs(
                  turn,
                  display.slice(0, index).flatMap(displayMessages),
                  first.at,
                ),
              }
            : { ended: false }),
        });
        break;
      default: {
        const _exhaustive: never = item;

        return _exhaustive;
      }
    }
  }

  if (state.kind === "ended" && state.end.kind === "failed")
    rows.push({
      kind: "failure",
      key: `failure:${turn.info.id}`,
      ...at(),
      sticky: false,
      failure: state.end.failure,
    });

  return rows;
}

/** A group counts only its own calls' changes; the turn's summary also holds the turn's earlier groups. */
function stepChanges(messages: readonly StepMessage[]) {
  const changes = messages.flatMap((message) =>
    showsTool(message) && message.state.phase === "settled" && message.state.changes !== null
      ? [message.state.changes]
      : [],
  );

  return {
    added: changes.reduce((sum, change) => sum + change.added, 0),
    removed: changes.reduce((sum, change) => sum + change.removed, 0),
  };
}

function inFlight(message: StepMessage): boolean {
  return message.status.kind === "live" || message.status.kind === "waiting";
}

function displayMessages(item: TranscriptDisplayPart): readonly Message[] {
  if (item.kind !== "part") return item.messages;

  return item.message.kind === "user" ? [] : [item.message];
}

/** A clipped turn's earlier work isn't loaded but did happen, so this counts from the turn's start. */
function workedMs(
  turn: TurnMessages,
  work: readonly Message[],
  replyAt: number,
): number | undefined {
  if (work.length === 0 && !turn.clipped) return undefined;

  const end = Math.max(
    replyAt,
    ...work.map((message) =>
      message.kind === "part" && message.status.kind === "settled"
        ? message.status.endedAt
        : message.at,
    ),
  );

  const ms = end - turn.info.startedAt;

  return ms > 0 ? ms : undefined;
}

export function transcriptRows({
  loading,
  failed,
  turns,
  changes,
  prompts,
  running,
  held,
  retrying,
}: {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly turns: readonly TurnMessages[];
  readonly changes: SessionView["changes"];
  readonly prompts: readonly UserMessage[];
  readonly running: boolean;
  readonly held: boolean;
  readonly retrying: string | undefined;
}): TranscriptRow[] {
  const rows: TranscriptRow[] = [];

  if (loading && turns.length === 0 && prompts.length === 0)
    rows.push({ kind: "skeleton", key: "row:skeleton", ...OUTSIDE });

  if (failed) rows.push({ kind: "error", key: "row:error", ...OUTSIDE });
  const last = turns.at(-1);
  const working = readWorking(running, held, prompts);
  let group: string | null = null;
  let leads = true;
  let owner: string | undefined;

  for (const turn of turns) {
    if (group === null || turn.info.prompt !== null) {
      group = turn.info.id;
      leads = true;
      owner = turn.info.prompt ?? turn.info.id;
    }

    const own = turnRows(turn, {
      group,
      leads,
      working: working && turn === last,
      retrying: retrying !== undefined,
      latest: turn === last,
    });

    rows.push(...own);

    if (own.length > 0) leads = false;
  }

  for (const message of prompts) {
    if (opensTurn(message)) owner = message.id;
    rows.push({
      kind: "prompt",
      key: `prompt:${message.id}`,
      ...OUTSIDE,
      sticky: sticksToTop(message),
      message,
      pending: running,
      held,
    });
  }

  if (retrying !== undefined)
    rows.push({ kind: "retry", key: "row:retry", ...OUTSIDE, message: retrying });

  rows.push({
    kind: "live",
    key: "row:live",
    ...OUTSIDE,
    state: !working
      ? "idle"
      : rows.some((row) => row.kind === "step" && row.running)
        ? "grouped"
        : "planning",
  });

  if (owner !== undefined)
    rows.push({
      kind: "changes",
      key: `changes:${owner}`,
      ...OUTSIDE,
      state: working ? "pending" : "ready",
      files: changes,
    });

  return rows;
}

type ProjectedView = HeadView & { readonly seq: number };

type SessionState = ReturnType<WatchStore<ProjectedView>["getState"]>;

type ConversationMessages = ReturnType<typeof conversationMessages>;

export interface TranscriptProjector {
  /** Whether thinking parts get rows; without them the live row says the run is thinking. */
  readonly thinking: boolean;
  readonly rows: (state: SessionState) => readonly RowLayout[];
  readonly row: (state: SessionState, key: string) => TranscriptRow | undefined;
  readonly messages: (state: SessionState) => ConversationMessages;
  readonly replies: (state: SessionState) => readonly Reply[];
}

interface Projection {
  readonly state: SessionState;
  readonly layouts: readonly RowLayout[];
  readonly rows: Map<string, TranscriptRow>;
  readonly rowKeys: ReadonlyMap<string, string>;
  readonly messages: ConversationMessages;
  readonly replies: readonly Reply[];
}

function rowMessages(row: TranscriptRow): readonly Message[] {
  switch (row.kind) {
    case "part":
      return [row.message];
    case "step":
    case "agents":
    case "response":
      return row.messages;
    default:
      return [];
  }
}

/** A row whose fields and messages are the ones its previous projection carried keeps that row, so its view skips rendering. */
function sameRow(known: TranscriptRow, row: TranscriptRow): boolean {
  const fields = new Map<string, unknown>(Object.entries(known));
  const entries: readonly [string, unknown][] = Object.entries(row);
  const messages = rowMessages(known);
  const next = rowMessages(row);

  return (
    entries.length === fields.size &&
    entries.every(([field, value]) => field === "messages" || value === fields.get(field)) &&
    next.length === messages.length &&
    next.every((message, index) => message === messages[index])
  );
}

function project(
  state: SessionState,
  previous: Projection | undefined,
  thinking: boolean,
): Projection {
  const view = state.value;
  const fresh = conversationMessages(view);
  const kept = previous?.messages;

  const messages =
    kept !== undefined &&
    kept.running === fresh.running &&
    kept.held === fresh.held &&
    kept.prompts === fresh.prompts &&
    kept.queued === fresh.queued &&
    kept.unsent === fresh.unsent
      ? kept
      : fresh;

  const rows = transcriptRows({
    loading: view === undefined && state.error === undefined,
    failed: state.error !== undefined,
    turns:
      view === undefined
        ? []
        : conversationTurns(view).map((turn) =>
            thinking
              ? turn
              : { ...turn, messages: turn.messages.filter((message) => !showsThinking(message)) },
          ),
    changes: view?.changes ?? [],
    prompts: messages.prompts,
    running: messages.running,
    held: messages.held,
    retrying: runState(view).retrying,
  }).map((row) => {
    const known = previous?.rows.get(row.key);

    return known !== undefined && sameRow(known, row) ? known : row;
  });

  const layouts = rows.map(({ key, group, leads, sticky }) => ({
    key,
    group,
    leads,
    sticky,
  }));

  const known = previous?.layouts;

  const unchanged =
    known?.length === layouts.length &&
    layouts.every((layout, index) => {
      const other = known[index];

      return (
        other !== undefined &&
        layout.key === other.key &&
        layout.group === other.group &&
        layout.leads === other.leads &&
        layout.sticky === other.sticky
      );
    });

  const rowKeys = new Map<string, string>();

  for (const row of rows) for (const message of rowMessages(row)) rowKeys.set(message.id, row.key);

  const replies = rows.flatMap((row) =>
    row.kind === "response"
      ? row.messages.map((message) => ({ id: message.id, at: message.at, row: row.key }))
      : [],
  );

  const shown = previous?.replies;

  return {
    state,
    layouts: unchanged ? known : layouts,
    rows: new Map(rows.map((row) => [row.key, row])),
    rowKeys,
    messages,
    replies:
      shown?.length === replies.length &&
      replies.every(
        (reply, index) => reply.id === shown[index]?.id && reply.row === shown[index].row,
      )
        ? shown
        : replies,
  };
}

export function dividerKey(reply: Reply): string {
  return `unread-divider:${reply.id}`;
}

export function withDivider(
  rows: readonly RowLayout[],
  reply: Reply | undefined,
): readonly (RowLayout | DividerRow)[] {
  const at = reply === undefined ? -1 : rows.findIndex((row) => row.key === reply.row);
  const next = rows[at];

  if (reply === undefined || next === undefined) return rows;

  const divider: DividerRow = {
    kind: "divider",
    key: dividerKey(reply),
    group: next.group,
    leads: false,
    sticky: false,
  };

  return [...rows.slice(0, at), divider, ...rows.slice(at)];
}

function replaced<T extends Message>(messages: readonly T[], message: T): readonly T[] {
  return messages.map((known) => (known.id === message.id ? message : known));
}

function withMessage(row: TranscriptRow, slot: TranscriptSlot): TranscriptRow | undefined {
  if (slot.kind === "await" || slot.kind === "blank") return undefined;

  switch (row.kind) {
    case "part":
      return { ...row, message: slot.message };
    case "step":
      if (slot.kind !== "step") return undefined;
      const messages = replaced(row.messages, slot.message);

      return { ...row, messages, ...stepChanges(messages) };
    case "agents":
      return slot.kind === "agents"
        ? { ...row, messages: replaced(row.messages, slot.message) }
        : undefined;
    case "response":
      return slot.kind === "response"
        ? { ...row, messages: replaced(row.messages, slot.message) }
        : undefined;
    default:
      return undefined;
  }
}

/** A status change reprojects, since a step row's `running` reads it. */
function streamed(previous: Projection, state: SessionState): Projection | undefined {
  const before = previous.state.value;
  const after = state.value;

  if (
    before === undefined ||
    after === undefined ||
    state.error !== previous.state.error ||
    after.seq < before.seq ||
    after.turns !== before.turns ||
    after.leadingPrompt !== before.leadingPrompt ||
    after.changes !== before.changes ||
    after.queue !== before.queue ||
    after.reportsHeld !== before.reportsHeld ||
    after.messages.length !== before.messages.length
  )
    return undefined;

  const run = runState(before);
  const next = runState(after);

  if (run.running !== next.running || run.retrying !== next.retrying) return undefined;

  const changed = new Map<string, TranscriptRow>();

  for (const [index, message] of after.messages.entries()) {
    const known = before.messages[index];

    if (message === known) continue;

    if (
      known?.kind !== "part" ||
      message.kind !== "part" ||
      message.id !== known.id ||
      message.turn !== known.turn ||
      message.status.kind !== known.status.kind
    )
      return undefined;
    const slot = transcriptSlot(message);

    if (slot.kind !== transcriptSlot(known).kind) return undefined;
    const key = previous.rowKeys.get(message.id);

    if (key === undefined) continue;
    const row = changed.get(key) ?? previous.rows.get(key);
    const updated = row === undefined ? undefined : withMessage(row, slot);

    if (updated === undefined) return undefined;
    changed.set(key, updated);
  }

  for (const [key, row] of changed) previous.rows.set(key, row);

  return { ...previous, state };
}

/** Projects a chat's rows; without `thinking` its thinking parts get none. */
export function transcriptProjector({
  thinking,
}: {
  readonly thinking: boolean;
}): TranscriptProjector {
  let projection: Projection | undefined;

  const sync = (state: SessionState): Projection => {
    if (projection?.state === state) return projection;
    projection =
      (projection === undefined ? undefined : streamed(projection, state)) ??
      project(state, projection, thinking);

    return projection;
  };

  return {
    thinking,
    rows: (state) => sync(state).layouts,
    row: (state, key) => sync(state).rows.get(key),
    messages: (state) => sync(state).messages,
    replies: (state) => sync(state).replies,
  };
}

const USER_ROW_ESTIMATE = 76;

const PART_ROW_ESTIMATE = 32;

const STEP_GROUP_ESTIMATE = {
  compact: 64,
  balanced: 140,
  detailed: 240,
} as const satisfies Record<ToolCallDensity, number>;

const AGENTS_BASE_ESTIMATE = 8;

const AGENTS_HEADER_ESTIMATE = 24;

const AGENTS_ROW_ESTIMATE = 62;

const PROSE_BASE_ESTIMATE = 40;

const PROSE_LINE_HEIGHT = 24;

const PROSE_CHARS_PER_LINE = 90;

const REPLY_ACTIONS_ESTIMATE = 32;

const WORKED_LINE_ESTIMATE = 30;

const CHANGES_CARD_BASE_ESTIMATE = 56;

const CHANGES_CARD_ROW_ESTIMATE = 30;

const BANNER_ESTIMATE = 28;

const SKELETON_ESTIMATE = 240;

const ESTIMATE_FONT_SIZE = 13;

export function estimateRowSize(
  row: TranscriptRow | DividerRow | undefined,
  density: ToolCallDensity,
  uiFontSize: number,
): number {
  const scale = uiFontSize / ESTIMATE_FONT_SIZE;

  return scale * rowEstimate(row, density, scale);
}

function rowEstimate(
  row: TranscriptRow | DividerRow | undefined,
  density: ToolCallDensity,
  scale: number,
): number {
  if (row === undefined) return 0;

  switch (row.kind) {
    case "skeleton":
      return SKELETON_ESTIMATE;
    case "error":
    case "retry":
    case "failure":
    case "earlier":
    case "divider":
      return BANNER_ESTIMATE;
    case "prompt":
      return USER_ROW_ESTIMATE;
    case "live":
      return 0;
    case "part":
      return row.message.kind === "user" ? USER_ROW_ESTIMATE : PART_ROW_ESTIMATE;
    case "step":
      return STEP_GROUP_ESTIMATE[density];
    case "agents":
      return (
        AGENTS_BASE_ESTIMATE +
        (row.messages.length > 1 ? AGENTS_HEADER_ESTIMATE : 0) +
        AGENTS_ROW_ESTIMATE * row.messages.length
      );
    case "response": {
      const prose = row.messages.reduce(
        (length, message) => length + message.state.markdown.length,
        0,
      );

      const ended = row.ended
        ? REPLY_ACTIONS_ESTIMATE + (row.workedMs === undefined ? 0 : WORKED_LINE_ESTIMATE)
        : 0;

      return (
        ended +
        PROSE_BASE_ESTIMATE +
        PROSE_LINE_HEIGHT * Math.ceil((prose * scale) / PROSE_CHARS_PER_LINE)
      );
    }

    case "changes":
      return CHANGES_CARD_BASE_ESTIMATE + CHANGES_CARD_ROW_ESTIMATE * CHANGES_VISIBLE_FILES;
    default: {
      const _exhaustive: never = row;

      return _exhaustive;
    }
  }
}
