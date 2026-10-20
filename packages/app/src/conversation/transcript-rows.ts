import type { Message, SessionView } from "@nyte-ai/sdk";
import type {
  failureNotice,
  TextMessage,
  ToolMessage,
  UserMessage,
} from "@nyte-ai/plugin/client/presentation";
import type { ToolCallDensity } from "../preferences/index.ts";
import type { WatchStore } from "../sdk.tsx";
import { CHANGES_VISIBLE_FILES } from "../workbench/change-tree.ts";
import { conversationTurns } from "../view-helpers.ts";
import type { TurnMessages } from "../view-helpers.ts";
import { displayTranscriptParts, transcriptSlot } from "./transcript-presentation.ts";
import type { StepMessage, TranscriptSlot } from "./transcript-presentation.ts";

export interface RowLayout {
  readonly key: string;
  readonly scrollAnchor: boolean;
  readonly group: string | null;
  readonly leads: boolean;
  readonly sticky: boolean;
}

const OUTSIDE = { scrollAnchor: false, group: null, leads: true, sticky: false } as const;

type Failure = Parameters<typeof failureNotice>[0];

export type TurnItemRow =
  | (RowLayout & { readonly kind: "part"; readonly message: Message })
  | (RowLayout & {
      readonly kind: "step";
      readonly messages: readonly StepMessage[];
      readonly added: number;
      readonly removed: number;
      readonly trailing: boolean;
    })
  | (RowLayout & { readonly kind: "agents"; readonly messages: readonly ToolMessage[] })
  | (RowLayout & { readonly kind: "response"; readonly messages: readonly TextMessage[] })
  | (RowLayout & { readonly kind: "failure"; readonly failure: Failure });

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
  | PromptRow
  | (RowLayout & { readonly kind: "retry"; readonly message: string })
  | (RowLayout & {
      readonly kind: "live";
      readonly settledWork: boolean;
    })
  | (RowLayout & {
      readonly kind: "changes";
      readonly files: SessionView["changes"];
    });

const NO_USERS: readonly UserMessage[] = [];

function present(messages: readonly UserMessage[]): readonly UserMessage[] {
  return messages.length === 0 ? NO_USERS : messages;
}

function runState(view: SessionView | undefined) {
  const execution = view?.execution;

  return {
    running: execution !== undefined && execution.kind !== "idle",
    held: execution?.kind === "idle" && execution.lastRun?.end.kind !== "completed",
    retrying: execution?.kind === "retrying" ? execution.reason : undefined,
  };
}

export function conversationMessages(view: SessionView | undefined) {
  const { running, held } = runState(view);
  const turns = new Set(view?.turns.map((turn) => turn.id));

  const users = (view?.messages ?? []).filter(
    (message): message is UserMessage => message.kind === "user" && !turns.has(message.turn),
  );

  const prompts = users.filter((message) => {
    switch (message.status.kind) {
      case "unsent":
        return message.status.retrying === null && !running;
      case "pending":
        return (
          !running ||
          message.status.schedule.kind === "joined" ||
          message.source.kind === "child" ||
          message.source.kind === "job"
        );
      case "landed":
        return true;
      default: {
        const _exhaustive: never = message.status;

        return _exhaustive;
      }
    }
  });

  return {
    running,
    held,
    prompts: present(prompts),
    queued: present(
      users.filter(
        (message) =>
          running &&
          message.status.kind === "pending" &&
          message.status.schedule.kind !== "joined" &&
          message.source.kind !== "child" &&
          message.source.kind !== "job",
      ),
    ),
    unsent: present(
      users.filter(
        (message) =>
          message.status.kind === "unsent" && (message.status.retrying !== null || running),
      ),
    ),
  };
}

/** A user's prompt is drawn sticky from the moment it is sent, so its row keeps one DOM shape when it joins its turn; only inside a turn does it stick. */
function sticksToTop(message: Message): boolean {
  return (
    message.kind === "user" && message.source.kind !== "child" && message.source.kind !== "job"
  );
}

function turnRows(
  turn: TurnMessages,
  place: { readonly group: string; readonly leads: boolean; readonly last: boolean },
) {
  const rows: TurnItemRow[] = [];
  const { state } = turn.info;

  const at = (): Pick<RowLayout, "group" | "leads"> => ({
    group: place.group,
    leads: place.leads && rows.length === 0,
  });

  if (turn.messages.length === 0 && state.kind !== "ended") return { rows, settledWork: false };
  const display = displayTranscriptParts(turn.messages);

  for (const [index, item] of display.entries()) {
    if (item.kind === "part") {
      const { message } = item;

      rows.push({
        kind: "part",
        key: message.kind === "user" ? `prompt:${message.id}` : message.id,
        scrollAnchor: message.kind === "user",
        ...at(),
        sticky: sticksToTop(message),
        message,
      });
      continue;
    }

    const [first] = item.messages;

    if (first === undefined) continue;
    const ends = index === display.length - 1;
    const layout = { scrollAnchor: false, ...at(), sticky: false };

    switch (item.kind) {
      case "step":
        rows.push({
          kind: "step",
          key: `step:${first.id}`,
          ...layout,
          messages: item.messages,
          added: ends ? turn.info.summary.added : 0,
          removed: ends ? turn.info.summary.removed : 0,
          trailing: ends && place.last,
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
      scrollAnchor: false,
      ...at(),
      sticky: false,
      failure: state.end.failure,
    });

  return { rows, settledWork: display.at(-1)?.kind === "step" };
}

export function transcriptRows({
  loading,
  failed,
  turns,
  changes,
  prompts,
  held,
  retrying,
  running,
}: {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly turns: readonly TurnMessages[];
  readonly changes: SessionView["changes"];
  readonly prompts: readonly UserMessage[];
  readonly held: boolean;
  readonly retrying: string | undefined;
  readonly running: boolean;
}): TranscriptRow[] {
  const rows: TranscriptRow[] = [];

  if (loading && turns.length === 0 && prompts.length === 0)
    rows.push({ kind: "skeleton", key: "row:skeleton", ...OUTSIDE });

  if (failed) rows.push({ kind: "error", key: "row:error", ...OUTSIDE });
  const last = turns.at(-1);
  let group: string | null = null;
  let leads = true;
  let settledWork = false;

  for (const turn of turns) {
    if (group === null || turn.info.prompt !== null) {
      group = turn.info.id;
      leads = true;
    }

    const own = turnRows(turn, { group, leads, last: turn === last });
    rows.push(...own.rows);
    settledWork = own.settledWork;

    if (own.rows.length > 0) leads = false;
  }

  if (changes.length > 0)
    rows.push({ kind: "changes", key: "row:changes", ...OUTSIDE, files: changes });

  for (const message of prompts)
    rows.push({
      kind: "prompt",
      key: `prompt:${message.id}`,
      ...OUTSIDE,
      scrollAnchor: true,
      sticky: sticksToTop(message),
      message,
      pending: running,
      held,
    });

  if (retrying !== undefined)
    rows.push({ kind: "retry", key: "row:retry", ...OUTSIDE, message: retrying });

  rows.push({ kind: "live", key: "row:live", ...OUTSIDE, settledWork });

  return rows;
}

type SessionState = ReturnType<WatchStore<SessionView>["getState"]>;

type ConversationMessages = ReturnType<typeof conversationMessages>;

export interface TranscriptProjector {
  readonly rows: (state: SessionState) => readonly RowLayout[];
  readonly row: (state: SessionState, key: string) => TranscriptRow | undefined;
  readonly messages: (state: SessionState) => ConversationMessages;
}

interface Projection {
  readonly state: SessionState;
  readonly layouts: readonly RowLayout[];
  readonly rows: Map<string, TranscriptRow>;
  readonly rowKeys: ReadonlyMap<string, string>;
  readonly messages: ConversationMessages;
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

function project(state: SessionState, previous: Projection | undefined): Projection {
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
    turns: view === undefined ? [] : conversationTurns(view),
    changes: view?.changes ?? [],
    prompts: messages.prompts,
    held: messages.held,
    retrying: runState(view).retrying,
    running: messages.running,
  });

  const layouts = rows.map(({ key, scrollAnchor, group, leads, sticky }) => ({
    key,
    scrollAnchor,
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
        layout.scrollAnchor === other.scrollAnchor &&
        layout.group === other.group &&
        layout.leads === other.leads &&
        layout.sticky === other.sticky
      );
    });

  const rowKeys = new Map<string, string>();

  for (const row of rows) for (const message of rowMessages(row)) rowKeys.set(message.id, row.key);

  return {
    state,
    layouts: unchanged ? known : layouts,
    rows: new Map(rows.map((row) => [row.key, row])),
    rowKeys,
    messages,
  };
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
      return slot.kind === "step"
        ? { ...row, messages: replaced(row.messages, slot.message) }
        : undefined;
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

function streamed(previous: Projection, state: SessionState): Projection | undefined {
  const before = previous.state.value;
  const after = state.value;

  if (
    before === undefined ||
    after === undefined ||
    state.error !== previous.state.error ||
    after.seq < before.seq ||
    after.turns !== before.turns ||
    after.changes !== before.changes ||
    after.messages.length !== before.messages.length
  )
    return undefined;

  const run = runState(before);
  const next = runState(after);

  if (run.running !== next.running || run.held !== next.held || run.retrying !== next.retrying)
    return undefined;

  const changed = new Map<string, TranscriptRow>();

  for (const [index, message] of after.messages.entries()) {
    const known = before.messages[index];

    if (message === known) continue;

    if (
      known?.kind !== "part" ||
      message.kind !== "part" ||
      message.id !== known.id ||
      message.turn !== known.turn
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

export function transcriptProjector(): TranscriptProjector {
  let projection: Projection | undefined;

  const sync = (state: SessionState): Projection => {
    if (projection?.state === state) return projection;
    projection =
      (projection === undefined ? undefined : streamed(projection, state)) ??
      project(state, projection);

    return projection;
  };

  return {
    rows: (state) => sync(state).layouts,
    row: (state, key) => sync(state).rows.get(key),
    messages: (state) => sync(state).messages,
  };
}

const USER_ROW_ESTIMATE = 76;

const PART_ROW_ESTIMATE = 32;

const STEP_GROUP_ESTIMATE = {
  compact: 64,
  balanced: 140,
  detailed: 240,
} as const satisfies Record<ToolCallDensity, number>;

const AGENTS_ESTIMATE = 64;

const PROSE_BASE_ESTIMATE = 40;

const PROSE_LINE_HEIGHT = 24;

const PROSE_CHARS_PER_LINE = 90;

const CHANGES_CARD_BASE_ESTIMATE = 50;

const CHANGES_CARD_ROW_ESTIMATE = 30;

const BANNER_ESTIMATE = 28;

const SKELETON_ESTIMATE = 240;

const ESTIMATE_FONT_SIZE = 13;

export function estimateRowSize(
  row: TranscriptRow | undefined,
  density: ToolCallDensity,
  uiFontSize: number,
): number {
  const scale = uiFontSize / ESTIMATE_FONT_SIZE;

  return scale * rowEstimate(row, density, scale);
}

function rowEstimate(
  row: TranscriptRow | undefined,
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
      return AGENTS_ESTIMATE;
    case "response": {
      const prose = row.messages.reduce(
        (length, message) => length + message.state.markdown.length,
        0,
      );

      return (
        PROSE_BASE_ESTIMATE + PROSE_LINE_HEIGHT * Math.ceil((prose * scale) / PROSE_CHARS_PER_LINE)
      );
    }

    case "changes":
      return (
        CHANGES_CARD_BASE_ESTIMATE +
        CHANGES_CARD_ROW_ESTIMATE * Math.min(row.files.length, CHANGES_VISIBLE_FILES)
      );
    default: {
      const _exhaustive: never = row;

      return _exhaustive;
    }
  }
}
