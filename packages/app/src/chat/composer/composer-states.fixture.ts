import type {
  Configuration,
  Delivery,
  Execution,
  HeldMessage,
  Message,
  MessageId,
  PartView,
  QueuedMessage,
  ReleaseOutcome,
  ReviseOutcome,
  RunView,
  SessionView,
  StopOutcome,
  UserContent,
} from "@nyte-ai/sdk";
import { SdkError } from "@nyte-ai/sdk";
import type { Health, RefusedSend } from "@nyte-ai/sdk/client";
import { asId, asSeq } from "@nyte-ai/schema";
import { viewStream } from "../../../test/scripted-connection.ts";
import { enterBehavior } from "./composer-keys.ts";
import { windowTabs } from "../../tabs/window-tabs.ts";
import { USAGE, endedTurn } from "../../../test/view-fixtures.ts";

const configuration: Configuration = {
  kind: "exact",
  model: { provider: "test", id: "test" },
  thinking: "off",
  agent: null,
  settings: {},
  settingsVersion: "1",
};

const liveRun: RunView = {
  id: asId<"run">("run"),
  head: asId<"head">("main"),
  startedAt: 0,
  attempt: 1,
  origin: { kind: "input", message: asId<"message">("prompt") },
};

const turn = asId<"turn">("turn");

export const DRAFT =
  "Rename the session store to journal, keep the old export for one release, and update every caller in the desktop package before touching the docs.";

const prompt: Message = {
  id: asId<"message">("prompt"),
  turn,
  at: 1,
  kind: "user",
  content: "Where does the session store live?",
  source: { kind: "user" },
  delivery: "queue",
  status: { kind: "landed", commit: asId<"commit">("prompt"), run: null, replaced: null },
  siblings: { index: 0, count: 1, ids: [] },
};

const reply: Message = {
  id: asId<"message">("reply"),
  turn,
  at: 2,
  kind: "part",
  part: asId<"part">("reply"),
  partKind: "text",
  role: "answer",
  state: {
    markdown: "In `packages/core/src/store.ts`, behind the `Store` interface.",
    signature: null,
  },
  version: 1,
  status: { kind: "settled", commit: asId<"commit">("reply"), endedAt: 2 },
};

export const live = (stopping = false): Execution => ({
  kind: "live",
  run: liveRun,
  phase: "responding",
  stopping,
});

export function view(
  execution: Execution,
  queue: readonly QueuedMessage[] = [],
  parts: readonly PartView[] = [],
): SessionView {
  const busy = execution.kind !== "idle";

  return {
    revision: asId<"revision">("r1"),
    seq: asSeq(1),
    activation: { kind: "active" },
    messages: [prompt, reply],
    queue,
    leadingPrompt: null,
    parts,
    turns: [
      endedTurn([], {
        id: turn,
        prompt: prompt.id,
        run: busy ? liveRun.id : null,
        steps: 1,
        ...(busy && { state: { kind: "working", activity: null } }),
      }).info,
    ],
    usage: USAGE,
    execution,
    reportsHeld: false,
    seenThrough: null,
    background: [],
    configuration: { selected: configuration, effective: configuration },
    context: { tokens: 250, window: 1_000, lastRequest: null },
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

export function queued(
  id: string,
  content: string,
  status: QueuedMessage["status"] = {
    kind: "pending",
    schedule: { kind: "next-turn", reason: "requested" },
    covered: true,
  },
): QueuedMessage {
  return {
    id: asId<"message">(id),
    turn: asId<"turn">(`loose:${id}`),
    at: 1,
    kind: "user",
    content,
    source: { kind: "user" },
    delivery: "queue",
    status,
    siblings: { index: 0, count: 1, ids: [] },
  };
}

export const question: PartView = {
  id: asId<"part">("question"),
  partKind: "ask/question",
  placement: { kind: "modal" },
  state: {
    call: "call-question",
    questions: [
      {
        header: "Exports",
        question: "Keep the old export?",
        options: [
          { label: "Yes, for one release", description: "Keep callers working during migration." },
          { label: "No, remove it", description: "Migrate every caller now." },
        ],
      },
      {
        header: "Clients",
        question: "Which clients should change?",
        options: [
          { label: "Desktop", description: "Update the Electron question dock." },
          { label: "Web", description: "Use the same flow in the browser." },
          { label: "Mobile", description: "Keep native answer controls." },
        ],
        multiple: true,
      },
    ],
    phase: { kind: "asking" },
  },
  version: 1,
  status: { kind: "live", run: liveRun.id },
  owner: "question",
};

export interface Probe {
  readonly layer: Layer;
  readonly region: HTMLElement;
  readonly editor: HTMLElement;
  readonly button: (name: string) => HTMLButtonElement | null;
  /** The draft text the window keeps for this chat. */
  readonly stored: () => string;
  /** Opens another chat, runs `meanwhile`, comes back, and probes the composer drawn anew. */
  readonly revisit: (meanwhile: () => Promise<void>) => Promise<Probe>;
}

export const inert = (button: HTMLButtonElement | null): boolean =>
  button !== null && (button.disabled || button.getAttribute("aria-disabled") === "true");

export interface ComposerState {
  readonly name: string;
  readonly view: SessionView | undefined;
  readonly draft?: string;
  /** The unsent rows the journal no longer sends on its own, which only the lone composer can be handed. */
  readonly expired?: readonly MessageId[];
  readonly check: (probe: Probe) => readonly string[] | Promise<readonly string[]>;
}

export const QUEUED_TEXT = "Then run the tests.";

export const KEPT_DRAFT = "Keep this draft.";

let saveOutcome: ReviseOutcome["kind"] = "revised";

const saves: { readonly content: UserContent; readonly delivery: Delivery | undefined }[] = [];

export const calls: string[] = [];

export const holdAnswers: ("sent" | "missing")[] = [];

const saveGates: Promise<void>[] = [];

let loseHold: (lost: Awaited<HeldMessage["lost"]>) => void = () => undefined;

const OPEN: Health = { kind: "open", since: 0 };

export const health = viewStream<Health>(OPEN);

export const stops: PromiseWithResolvers<StopOutcome<never>>[] = [];

/** The connection's list of sends the journal replayed and the host refused. */
export const refusals = viewStream<readonly RefusedSend[]>([]);

/** How a send the composer made ends; `unsent` leaves it with the journal, as a link that closed under it or a day's wait does. */
export type SendEnding = "refused" | "unsent" | "removed";

export const sends: { readonly end: (ending: SendEnding) => void }[] = [];

export function heldMessage(message: MessageId): HeldMessage {
  const lost = Promise.withResolvers<Awaited<HeldMessage["lost"]>>();
  let released = false;

  const release = async (): Promise<ReleaseOutcome> => {
    if (!released) calls.push(`release ${message}`);
    released = true;

    return { kind: "released" };
  };

  loseHold = lost.resolve;

  return {
    kind: "held",
    message,
    lost: lost.promise,
    save: async (content, options) => {
      calls.push(`save ${message}`);
      saves.push({ content, delivery: options?.delivery });
      await saveGates.shift();
      released = true;

      return { kind: saveOutcome };
    },
    release,
    async [Symbol.asyncDispose]() {
      await release();
    },
  };
}

export async function editQueuedMessage({
  layer,
  region,
  editor,
  button,
  stored,
  revisit,
}: Probe): Promise<readonly string[]> {
  const failures: string[] = [];

  const check = (ok: boolean, failure: string): void => {
    if (!ok) failures.push(failure);
  };

  const editButton = (row: string) =>
    region.querySelector<HTMLButtonElement>(
      `[data-queue-row='${row}'] button[aria-label='Edit queued message']`,
    );

  const indicator = () => region.querySelector("[data-composer-frame] [role='status']");

  const reads = (text: string) =>
    until(
      () => (editor.innerText === text ? true : null),
      `the composer to read "${text}"`,
      () => `; it reads "${editor.innerText}"`,
    );

  const press = (key: string): void => {
    editor.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  };

  const beginEdit = async (): Promise<void> => {
    editButton("first")?.click();
    await reads(QUEUED_TEXT);
  };

  const type = async (text: string): Promise<void> => {
    const typed = `${editor.innerText}${text}`;
    document.execCommand("insertText", false, text);
    await reads(typed);
  };

  const called = (from: number, call: string, after: string) =>
    until(() => (calls.slice(from).includes(call) ? true : null), `"${call}" after ${after}`);

  const notice = () => region.querySelector("[role='alert']")?.textContent;

  saveOutcome = "revised";
  holdAnswers.length = 0;

  let mark = calls.length;
  await beginEdit();
  await called(mark, "hold first", "Edit");
  check(indicator()?.textContent === "Editing queued message", "no editing indicator");
  check(
    region.querySelector("[data-queue-row='first']")?.getAttribute("data-editing") === "true",
    "the edited row is not marked",
  );
  check(
    inert(editButton("second")) &&
      editButton("second")?.title === "Finish editing the queued message first.",
    "another row's Edit is open during an edit",
  );
  const sendTitle = button("Send message")?.title ?? "";
  check(
    sendTitle === enterBehavior({ kind: "editing-queued", delivery: "queue" }, false).title,
    `send button reads "${sendTitle}"`,
  );

  if (layer === "composer")
    check(stored() === KEPT_DRAFT, `the composer stores "${stored()}" while editing`);

  mark = calls.length;
  press("Escape");
  await reads(KEPT_DRAFT);
  check(indicator() === null, "the indicator outlives Esc");
  await called(mark, "release first", "Esc");

  await beginEdit();
  mark = calls.length;
  button("Cancel editing")?.click();
  await reads(KEPT_DRAFT);
  await called(mark, "release first", "Cancel editing");

  await beginEdit();
  await type(" Then lint.");
  let finishSave: () => void = () => undefined;
  saveGates.push(
    new Promise<void>((resolve) => {
      finishSave = resolve;
    }),
  );
  press("Enter");
  await until(
    () => (button("Send message")?.getAttribute("aria-busy") === "true" ? true : null),
    "the save to start",
  );
  document.execCommand("insertText", false, " Typed while saving.");

  for (const target of [
    region.querySelector("[data-composer-frame]"),
    layer === "session" ? document.querySelector("[aria-label='Messages']") : null,
  ]) {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" }),
    );
    target?.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  }

  await painted();
  await painted();
  await painted();
  check(
    editor.innerText === `${QUEUED_TEXT} Then lint.`,
    `typing while saving changed the edit to "${editor.innerText}"`,
  );
  check(
    region.querySelector("[aria-label='Image attachments']") === null,
    "a file dropped while saving was attached",
  );
  finishSave();
  await reads(KEPT_DRAFT);
  check(document.activeElement === editor, "the composer lost focus after saving");
  const saved = saves.at(-1);
  check(
    saved?.content === `${QUEUED_TEXT} Then lint.` && saved.delivery === "queue",
    "saving did not revise the queued message",
  );

  saveOutcome = "sent";
  const beforeSave = editor.innerText;
  await beginEdit();
  await type(" Then push.");
  press("Enter");
  await reads(`${QUEUED_TEXT} Then push.\n${beforeSave}`);
  check(notice() === "That message was already sent.", "no notice that the save found it sent");

  saveOutcome = "revised";
  const beforeLost = editor.innerText;
  await beginEdit();
  await type(" Then deploy.");
  loseHold({ kind: "sent" });
  await reads(`${QUEUED_TEXT} Then deploy.\n${beforeLost}`);
  check(notice() === "That message was already sent.", "no notice when the hold was lost");

  const beforeImage = editor.innerText;
  await beginEdit();
  const transfer = new DataTransfer();
  transfer.items.add(
    new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" }),
  );
  region
    .querySelector("[data-composer-frame]")
    ?.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  await until(
    () => region.querySelector("[aria-label='Image attachments']"),
    "the dropped image to attach",
  );
  loseHold({ kind: "lapsed" });
  await until(
    () => (notice() === "Couldn't keep the message on hold." ? true : null),
    "the lapsed notice",
  );
  check(
    editor.innerText === `${QUEUED_TEXT}\n${beforeImage}` &&
      region.querySelector("[aria-label='Image attachments']") !== null,
    `an edit with an added image ended as "${editor.innerText}"`,
  );

  for (const [answer, shown] of [
    ["missing", "That message is no longer queued."],
    ["sent", "That message was already sent."],
  ] as const) {
    holdAnswers.push(answer);
    const beforeHold = editor.innerText;
    mark = calls.length;
    editButton("first")?.click();
    await called(mark, "hold first", "Edit");
    await until(() => (notice() === shown ? true : null), `the notice "${shown}"`);
    check(
      editor.innerText === beforeHold && indicator() === null,
      `an unchanged edit of a ${answer} message left "${editor.innerText}"`,
    );
  }

  const steer = () =>
    region.querySelector<HTMLButtonElement>("[data-queue-row='second'] button[aria-label='Steer']");

  check(steer()?.title === "Sends without stopping the agent", "Steer has no tooltip");
  mark = calls.length;
  steer()?.click();
  await called(mark, "revise second", "Steer");
  await until(steer, "the revised row to leave its sending state");

  const beforeLeaving = editor.innerText;
  await beginEdit();
  const back = await revisit(async () => undefined);
  await until(
    () => (back.editor.innerText === beforeLeaving ? true : null),
    "an unchanged edit to leave the draft as it was",
    () => `; it reads "${back.editor.innerText}"`,
  );

  return failures;
}

interface Refusal {
  readonly name: string;
  readonly ends: SendEnding;
  readonly typed: string;
  readonly leave: "no" | "before it" | "for it" | "after it";
  readonly editing: boolean;
  readonly shows: string;
  readonly restored: string | undefined;
}

const SENT = "hello";

const REFUSALS: readonly Refusal[] = [
  {
    name: "an empty draft",
    ends: "refused",
    typed: "",
    leave: "no",
    editing: false,
    shows: SENT,
    restored: undefined,
  },
  {
    name: "a draft with text",
    ends: "refused",
    typed: "next",
    leave: "no",
    editing: false,
    shows: "next",
    restored: `${SENT}\nnext`,
  },
  {
    name: "a chat left and reopened before it",
    ends: "refused",
    typed: "next",
    leave: "before it",
    editing: false,
    shows: "next",
    restored: `${SENT}\nnext`,
  },
  {
    name: "an empty draft in a chat left for it",
    ends: "refused",
    typed: "",
    leave: "for it",
    editing: false,
    shows: SENT,
    restored: undefined,
  },
  {
    name: "a draft with text in a chat left for it",
    ends: "refused",
    typed: "next",
    leave: "for it",
    editing: false,
    shows: "next",
    restored: `${SENT}\nnext`,
  },
  {
    name: "a chat left after it",
    ends: "refused",
    typed: "next",
    leave: "after it",
    editing: false,
    shows: "next",
    restored: `${SENT}\nnext`,
  },
  {
    name: "a queued edit",
    ends: "refused",
    typed: "",
    leave: "no",
    editing: true,
    shows: QUEUED_TEXT,
    restored: undefined,
  },
  {
    name: "a send the journal still holds, on an empty draft",
    ends: "unsent",
    typed: "",
    leave: "no",
    editing: false,
    shows: "",
    restored: undefined,
  },
  {
    name: "a send the journal still holds, in a chat left for it",
    ends: "unsent",
    typed: "next",
    leave: "for it",
    editing: false,
    shows: "next",
    restored: undefined,
  },
  {
    name: "a send whose unsent row was removed",
    ends: "removed",
    typed: "",
    leave: "no",
    editing: false,
    shows: "",
    restored: undefined,
  },
];

/** Refuses a send in each situation of `REFUSALS` and checks where its text lands and which notice shows. */
export async function refuseSend(probe: Probe): Promise<readonly string[]> {
  const failures: string[] = [];
  let shown = probe;

  for (const row of REFUSALS) {
    const check = (ok: boolean, failure: string): void => {
      if (!ok) failures.push(`${row.name}: ${failure}`);
    };

    shown = await refuseOnce(shown, row, check);

    if (failures.length > 0) return failures;
    shown.region
      .querySelector<HTMLButtonElement>("[role='alert'] button[aria-label='Dismiss notification']")
      ?.click();
    shown.editor.focus();
    document.execCommand("selectAll");
    document.execCommand("delete");
    await painted();
  }

  return failures;
}

async function refuseOnce(
  probe: Probe,
  row: Refusal,
  check: (ok: boolean, failure: string) => void,
): Promise<Probe> {
  const reads = (shown: Probe, text: string) =>
    until(
      () => (written(shown) === text ? true : null),
      `the composer to read "${text}"`,
      () => `; it reads "${written(shown)}"`,
    );

  const type = (shown: Probe, text: string): void => {
    shown.editor.focus();
    document.execCommand("insertText", false, text);
  };

  const alert = (shown: Probe) => shown.region.querySelector("[role='alert']");

  const restore = (shown: Probe) =>
    Array.from(alert(shown)?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Restore Draft",
    );

  const refuse = async (): Promise<void> => {
    sends.shift()?.end(row.ends);
    await painted();
    await painted();
  };

  const away = (meanwhile: () => Promise<void>) => probe.revisit(meanwhile);

  type(probe, SENT);
  await reads(probe, SENT);
  await painted();
  const sent = sends.length;
  probe.editor.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  await until(() => (sends.length > sent ? true : null), "the send");
  await reads(probe, "");
  await painted();
  check(
    probe.button("Send message")?.getAttribute("aria-busy") !== "true",
    "Send stays busy once the journal holds the message",
  );
  let shown = row.leave === "before it" ? await away(async () => undefined) : probe;

  if (row.editing) {
    shown.region
      .querySelector<HTMLButtonElement>(
        "[data-queue-row='first'] button[aria-label='Edit queued message']",
      )
      ?.click();
    await reads(shown, QUEUED_TEXT);
  }

  if (row.typed !== "") {
    type(shown, row.typed);
    await reads(shown, row.typed);
  }

  if (row.leave === "for it") shown = await away(refuse);
  else await refuse();

  if (row.leave === "after it") shown = await away(async () => undefined);

  const settled = shown;
  const refused = row.ends === "refused";
  await eventually(() => (alert(settled) !== null) === refused && written(settled) === row.shows);
  check(written(shown) === row.shows, `the composer reads "${written(shown)}", not "${row.shows}"`);
  check(
    refused
      ? alert(shown)?.textContent?.startsWith("Couldn't send the message") === true
      : alert(shown) === null,
    `the notice reads "${alert(shown)?.textContent ?? ""}"`,
  );
  check(
    (restore(shown) !== undefined) === (row.restored !== undefined),
    `Restore Draft ${restore(shown) === undefined ? "is missing" : "shows"}`,
  );

  if (!row.editing) check(shown.stored() === row.shows, `the window keeps "${shown.stored()}"`);

  if (row.editing) {
    shown.editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await eventually(() => written(settled) === SENT);
    check(written(shown) === SENT, `after the edit the composer reads "${written(shown)}"`);
    check(shown.stored() === SENT, `after the edit the window keeps "${shown.stored()}"`);
  }

  if (row.restored === undefined) return shown;
  const restored = row.restored;
  restore(shown)?.click();
  await eventually(() => written(settled) === restored);
  check(written(shown) === restored, `after Restore the composer reads "${written(shown)}"`);
  check(restore(shown) === undefined, "Restore Draft outlives the restore");
  check(alert(shown) !== null, "the notice left with the restore");
  check(shown.stored() === row.restored, `after Restore the window keeps "${shown.stored()}"`);

  return shown;
}

function written(probe: Probe): string {
  const text = probe.editor.innerText;

  return text === "\n" ? "" : text;
}

async function eventually(done: () => boolean): Promise<void> {
  const deadline = performance.now() + 2_000;

  while (!done() && performance.now() < deadline) await painted();
}

/** Sends twice in a row: once the journal holds the first message, the composer is free for the next. */
export async function sendTwice(probe: Probe): Promise<readonly string[]> {
  const failures: string[] = [];
  const first = sends.length;

  for (const text of ["First.", "Second."]) {
    probe.editor.focus();
    document.execCommand("insertText", false, text);
    await until(() => (written(probe) === text ? true : null), `the composer to read "${text}"`);
    await painted();
    probe.editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    try {
      await until(() => (written(probe) === "" ? true : null), `"${text}" to leave the composer`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  await painted();

  if (sends.length !== first + 2) failures.push(`${String(sends.length - first)} sends, not 2`);

  if (probe.button("Send message")?.getAttribute("aria-busy") === "true")
    failures.push("Send stays busy while the journal holds the messages");

  for (const sent of sends.splice(first)) sent.end("unsent");

  return failures;
}

/**
 * Lists a replayed send the host refused for a chat no composer shows, over an empty draft and then
 * over text, and checks the window's draft store takes it back as a live refusal and the connection's
 * list is emptied.
 */
export async function replayRefused(): Promise<readonly string[]> {
  const failures: string[] = [];
  const drafts = windowTabs.panes().viewState;
  const chat = asId<"session">("composer-replayed-elsewhere");

  for (const [typed, shows, restore] of [
    ["", SENT, null],
    ["next", "next", SENT],
  ] as const) {
    drafts.updateDraft(chat, () => ({
      composer: { draft: typed, attachments: [], selectionStart: 0, selectionEnd: 0 },
      edit: null,
      notice: null,
    }));
    refusals.push([
      {
        id: asId<"receipt">(`replayed-${typed}`),
        session: chat,
        head: asId<"head">("main"),
        content: SENT,
        error: new SdkError("invalid", "The host refused the message."),
      },
    ]);
    await until(
      () => (refusals.latest()?.length === 0 ? true : null),
      "the refused replay to be taken",
    );
    const draft = drafts.readSession(chat).draft;
    const label = typed === "" ? "over an empty draft" : "over text";

    if (draft.composer.draft !== shows)
      failures.push(`${label}: the draft reads "${draft.composer.draft}", not "${shows}"`);

    if (draft.notice?.message.startsWith("Couldn't send the message") !== true)
      failures.push(`${label}: the notice reads "${draft.notice?.message ?? ""}"`);

    if ((draft.notice?.restore?.text ?? null) !== restore)
      failures.push(`${label}: Restore Draft offers "${draft.notice?.restore?.text ?? "nothing"}"`);
  }

  return failures;
}

export async function pressStop({ region, editor, button }: Probe): Promise<readonly string[]> {
  const failures: string[] = [];

  const check = (ok: boolean, failure: string): void => {
    if (!ok) failures.push(failure);
  };

  const busy = (): true | null =>
    button("Stop response")?.getAttribute("aria-busy") === "true" ? true : null;

  const sent = stops.length;
  button("Stop response")?.click();
  await until(busy, "Stop to show it is stopping once pressed");
  button("Stop response")?.click();
  editor.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await painted();
  check(stops.length === sent + 1, `${String(stops.length - sent)} stops were sent, not 1`);

  health.push({
    kind: "retrying",
    attempt: 1,
    at: 0,
    error: new SdkError("unavailable", "The link is lost."),
  });
  await until(() => (busy() === null ? true : null), "the pending Stop to clear with the link");
  button("Stop response")?.click();
  await until(() => (stops.length === sent + 2 ? true : null), "Stop to be sent again");
  check(busy() === true, "the second Stop does not show it is stopping");
  stops[sent]?.reject(new SdkError("unavailable", "The Nyte host abandoned the request."));
  await painted();
  await painted();
  check(
    busy() === true && region.querySelector("[role='alert']") === null,
    "the Stop a later press replaced reported its failure",
  );

  stops.at(-1)?.reject(new SdkError("unavailable", "The connection is closed."));
  await until(
    () =>
      busy() === null &&
      Array.from(region.querySelectorAll("[role='alert']")).some(
        (alert) => alert.textContent === "Couldn't stop the response: The connection is closed.",
      )
        ? true
        : null,
    "a failed Stop to clear and say so",
  );
  health.push(OPEN);

  return failures;
}

export async function expiredRow({ layer, region }: Probe): Promise<readonly string[]> {
  if (layer === "session") return [];
  const row = region.querySelector<HTMLElement>("[data-queue-row='stale']");

  const buttons = Array.from(row?.querySelectorAll("button") ?? [], (button) =>
    button.getAttribute("aria-label"),
  ).join(", ");

  const shortcuts = row?.getAttribute("aria-keyshortcuts") ?? "";
  const alert = row?.querySelector("[role='alert']")?.textContent ?? "";
  const mark = calls.length;

  row?.focus();
  row?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Delete", ctrlKey: true, bubbles: true, cancelable: true }),
  );

  await until(
    () => (calls.slice(mark).includes("stop receipt stale") ? true : null),
    "Control+Delete to remove the row",
  );

  return [
    ...(alert === "Couldn't send: it waited more than a day."
      ? []
      : [`the expired row says "${alert}"`]),
    ...(buttons === "Send queued message, Remove queued message"
      ? []
      : [`the expired row offers "${buttons}"`]),
    ...(shortcuts === "ArrowUp ArrowDown Enter Escape Control+Delete"
      ? []
      : [`the expired row advertises "${shortcuts}"`]),
  ];
}

export const LAYERS = ["composer", "session"] as const;

export type Layer = (typeof LAYERS)[number];

let renderFailure: unknown;

export async function until<T>(
  read: () => T | null | undefined,
  what: string,
  seen: () => string = () => "",
): Promise<T> {
  const deadline = performance.now() + 5_000;

  for (;;) {
    if (renderFailure !== undefined) throw renderFailure;
    const value = read();

    if (value !== null && value !== undefined) return value;

    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}${seen()}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

export function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

/** Records the error the stage's root threw, or clears it for the next stage, so `until` stops waiting. */
export function failRender(error: unknown): void {
  renderFailure = error;
}
