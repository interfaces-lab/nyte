import type { Message, SessionView, TurnInfo } from "@nyte-ai/sdk";
import { showsTool } from "@nyte-ai/plugin/client/presentation";
import type {
  failureNotice,
  TextMessage,
  ToolMessage,
  UserMessage,
} from "@nyte-ai/plugin/client/presentation";
import type { ToolCallDensity } from "../preferences/index.ts";
import { CHANGES_VISIBLE_FILES } from "../workbench/change-tree.ts";
import { conversationTurns, sameItems } from "../view-helpers.ts";
import type { ConversationTurn } from "../view-helpers.ts";
import { displayTranscriptParts } from "./transcript-presentation.ts";
import type { StepMessage } from "./transcript-presentation.ts";

export type { ConversationTurn } from "../view-helpers.ts";

interface RowPlace {
  readonly messageId: string;
  readonly scrollAnchor: boolean;
  readonly group: string | null;
  readonly leads: boolean;
  readonly sticky: boolean;
}

const OUTSIDE = { group: null, leads: true, sticky: false } as const;

export type TurnItemRow =
  | (RowPlace & { readonly kind: "part"; readonly message: Message })
  | (RowPlace & {
      readonly kind: "step";
      readonly messages: readonly StepMessage[];
      readonly added: number;
      readonly removed: number;
      readonly trailing: boolean;
    })
  | (RowPlace & { readonly kind: "agents"; readonly messages: readonly ToolMessage[] })
  | (RowPlace & { readonly kind: "response"; readonly messages: readonly TextMessage[] })
  | (RowPlace & {
      readonly kind: "failure";
      readonly failure: Failure;
    });

export type TranscriptRow =
  | (RowPlace & { readonly kind: "skeleton"; readonly messageId: "row:skeleton" })
  | (RowPlace & { readonly kind: "error"; readonly messageId: "row:error" })
  | TurnItemRow
  | (RowPlace & {
      readonly kind: "landing";
      readonly message: UserMessage;
      readonly pending: boolean;
      readonly held: boolean;
    })
  | (RowPlace & {
      readonly kind: "retry";
      readonly messageId: "row:retry";
      readonly message: string;
    })
  | (RowPlace & {
      readonly kind: "live";
      readonly messageId: "row:live";
      readonly working: boolean;
    })
  | ChangesRow;

type ChangesRow = RowPlace & {
  readonly kind: "changes";
  readonly messageId: "row:changes";
  readonly files: SessionView["changes"];
};

type LandingRow = Extract<TranscriptRow, { readonly kind: "landing" }>;

const SKELETON_ROW: TranscriptRow = {
  kind: "skeleton",
  messageId: "row:skeleton",
  scrollAnchor: false,
  ...OUTSIDE,
};

const ERROR_ROW: TranscriptRow = {
  kind: "error",
  messageId: "row:error",
  scrollAnchor: false,
  ...OUTSIDE,
};

const LIVE_ROWS = {
  working: { kind: "live", messageId: "row:live", scrollAnchor: false, working: true, ...OUTSIDE },
  idle: { kind: "live", messageId: "row:live", scrollAnchor: false, working: false, ...OUTSIDE },
} as const satisfies Record<string, TranscriptRow>;

const NO_USERS: readonly UserMessage[] = [];

const landingRows = new WeakMap<UserMessage, LandingRow>();

const changesRows = new WeakMap<SessionView["changes"], ChangesRow>();

function changesRow(files: SessionView["changes"]): ChangesRow {
  const known = changesRows.get(files);

  if (known !== undefined) return known;

  const row: ChangesRow = {
    kind: "changes",
    messageId: "row:changes",
    scrollAnchor: false,
    ...OUTSIDE,
    files,
  };

  changesRows.set(files, row);

  return row;
}

type Failure = Parameters<typeof failureNotice>[0];

const itemRows = new WeakMap<Message | Failure | TurnInfo, TurnItemRow>();

const turnRows = new WeakMap<
  ConversationTurn,
  {
    readonly group: string;
    readonly leads: boolean;
    readonly last: boolean;
    readonly rows: readonly TurnItemRow[];
  }
>();

function landingRow(message: UserMessage, pending: boolean, held: boolean): LandingRow {
  const known = landingRows.get(message);

  if (known !== undefined && known.pending === pending && known.held === held) return known;

  const row: LandingRow = {
    kind: "landing",
    messageId: `landing:${message.id}`,
    scrollAnchor: true,
    ...OUTSIDE,
    message,
    pending,
    held,
  };

  landingRows.set(message, row);

  return row;
}

function sameRow(left: TranscriptRow, right: TranscriptRow): boolean {
  const before: [string, unknown][] = Object.entries(left);
  const after: [string, unknown][] = Object.entries(right);

  return (
    before.length === after.length &&
    before.every(([key, value], index) => {
      const [otherKey, other] = after[index] ?? [];

      return (
        key === otherKey &&
        (value === other ||
          (Array.isArray(value) && Array.isArray(other) && sameItems(value, other)))
      );
    })
  );
}

function keepRow(source: Message | Failure | TurnInfo, row: TurnItemRow): TurnItemRow {
  const known = itemRows.get(source);

  if (known !== undefined && sameRow(known, row)) return known;
  itemRows.set(source, row);

  return row;
}

function readTurnRows(
  turn: ConversationTurn,
  place: { readonly group: string; readonly leads: boolean; readonly last: boolean },
): readonly TurnItemRow[] {
  const known = turnRows.get(turn);

  if (
    known !== undefined &&
    known.group === place.group &&
    known.leads === place.leads &&
    known.last === place.last
  )
    return known.rows;

  const rows: TurnItemRow[] = [];
  const { state } = turn.info;

  const at = (): Pick<RowPlace, "group" | "leads"> => ({
    group: place.group,
    leads: place.leads && rows.length === 0,
  });

  if (turn.messages.length > 0 || state.kind === "ended") {
    const display = displayTranscriptParts(turn.messages);

    for (const [index, item] of display.entries()) {
      if (item.kind === "part") {
        const { message } = item;

        const prompt =
          message.kind === "user" &&
          message.source.kind !== "child" &&
          message.source.kind !== "job";

        rows.push(
          keepRow(message, {
            kind: "part",
            messageId: message.kind === "user" ? `landing:${message.id}` : message.id,
            scrollAnchor: message.kind === "user",
            ...at(),
            sticky: prompt,
            message,
          }),
        );
        continue;
      }

      const [first] = item.messages;

      if (first === undefined) continue;
      const ends = index === display.length - 1;

      switch (item.kind) {
        case "step":
          rows.push(
            keepRow(first, {
              kind: "step",
              messageId: `step:${first.id}`,
              scrollAnchor: false,
              ...at(),
              sticky: false,
              messages: item.messages,
              added: ends ? turn.info.summary.added : 0,
              removed: ends ? turn.info.summary.removed : 0,
              trailing: ends && place.last,
            }),
          );
          break;
        case "agents":
          rows.push(
            keepRow(first, {
              kind: "agents",
              messageId: `agents:${first.id}`,
              scrollAnchor: false,
              ...at(),
              sticky: false,
              messages: item.messages,
            }),
          );
          break;
        case "response":
          rows.push(
            keepRow(first, {
              kind: "response",
              messageId: `response:${first.id}`,
              scrollAnchor: false,
              ...at(),
              sticky: false,
              messages: item.messages,
            }),
          );
          break;
        default: {
          const _exhaustive: never = item;

          return _exhaustive;
        }
      }
    }

    if (state.kind === "ended" && state.end.kind === "failed")
      rows.push(
        keepRow(state.end.failure, {
          kind: "failure",
          messageId: `failure:${turn.info.id}`,
          scrollAnchor: false,
          ...at(),
          sticky: false,
          failure: state.end.failure,
        }),
      );
  }

  turnRows.set(turn, { ...place, rows });

  return rows;
}

function present(messages: readonly UserMessage[]): readonly UserMessage[] {
  return messages.length === 0 ? NO_USERS : messages;
}

export function conversationMessages(view: SessionView | undefined) {
  const running = view !== undefined && view.execution.kind !== "idle";
  const loose = view === undefined ? [] : conversationTurns(view).loose;
  const users = loose.filter((message): message is UserMessage => message.kind === "user");

  const landing = users.filter((message) => {
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
    held: view?.execution.kind === "idle" && view.execution.lastRun?.end.kind !== "completed",
    submitted: present(landing),
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

export function transcriptRows({
  loading,
  failed,
  turns,
  changes,
  landing,
  held,
  retrying,
  working,
  running,
}: {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly turns: readonly ConversationTurn[];
  /** The chat's changes since its first run, shown in one card after the last turn once nothing is working. */
  readonly changes: SessionView["changes"];
  readonly landing: readonly UserMessage[];
  readonly held: boolean;
  readonly retrying: string | undefined;
  readonly working: boolean;
  readonly running: boolean;
}): TranscriptRow[] {
  const rows: TranscriptRow[] = [];

  if (loading && turns.length === 0 && landing.length === 0) rows.push(SKELETON_ROW);

  if (failed) rows.push(ERROR_ROW);
  const last = turns.at(-1);
  let group: string | null = null;
  let leads = true;

  for (const turn of turns) {
    if (group === null || turn.info.prompt !== null) {
      group = turn.info.id;
      leads = true;
    }

    const own = readTurnRows(turn, { group, leads, last: turn === last });
    rows.push(...own);

    if (own.length > 0) leads = false;
  }

  if (changes.length > 0 && !working) rows.push(changesRow(changes));

  for (const message of landing) rows.push(landingRow(message, running, held));

  if (retrying !== undefined) {
    rows.push({
      kind: "retry",
      messageId: "row:retry",
      scrollAnchor: false,
      ...OUTSIDE,
      message: retrying,
    });
  }

  rows.push(working ? LIVE_ROWS.working : LIVE_ROWS.idle);

  return rows;
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

const LIVE_ROW_ESTIMATE = 60;

const BANNER_ESTIMATE = 28;

const SKELETON_ESTIMATE = 240;

const ESTIMATE_FONT_SIZE = 13;

const proseLengths = new WeakMap<readonly TextMessage[], number>();

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
    case "landing":
      return USER_ROW_ESTIMATE;
    case "live":
      return row.working ? LIVE_ROW_ESTIMATE : 0;
    case "part":
      return row.message.kind === "user" ? USER_ROW_ESTIMATE : PART_ROW_ESTIMATE;
    case "step":
      return STEP_GROUP_ESTIMATE[density];
    case "agents":
      return AGENTS_ESTIMATE;
    case "response": {
      const prose =
        proseLengths.get(row.messages) ??
        row.messages.reduce((length, message) => length + message.state.markdown.length, 0);

      proseLengths.set(row.messages, prose);

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
