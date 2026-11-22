import { asId } from "@nyte-ai/schema";
import type {
  ActOutcome,
  Disposer,
  HeadName,
  Json,
  MessageId,
  PartId,
  ReceiptId,
  RunId,
  SendOptions,
  UserContent,
} from "@nyte-ai/schema";
import type { SendReceipt, Session } from "@nyte-ai/core";
import type { JournalLoop, Sending } from "../send/journal.ts";
import { laidSends } from "../send/unsent.ts";
import { headView } from "../view/head-view.ts";
import type { HeadView } from "../view/head-view.ts";
import { pages } from "../view/history.ts";
import { streamedText } from "../view/streamed-text.ts";
import type { HeadStore } from "./head.ts";
import type { Health, TextUpdate } from "./host-connection.ts";
import { listenerSet } from "./store.ts";
import type { Freshness, Live } from "./store.ts";

export interface ChatSnapshot {
  /** The head's view with its unsent sends, the older messages `earlier` loaded and streamed text laid in, or `null` until the head's first read lands. */
  readonly view: HeadView | null;
  /** The seq `view`'s rows are current through: the last fresh seq, kept while the chat is stale, and 0 before the first read. */
  readonly seq: number;
  readonly freshness: Freshness;
  /** The unsent messages the journal no longer sends on its own because they waited more than a day. Each still shows unsent and is sent again only by `resend`. The same array until it changes. */
  readonly expired: readonly MessageId[];
  /**
   * `host` while the host's row says the run is stopping. `asked` from a `stop()` until the host
   * answers with its row or ends the run, the stop fails, or the link's health changes, so a stop
   * sent into a link found lost can be sent again. `asked` only says a stop was sent; the host
   * decides whether the run stops.
   */
  readonly stopping: "no" | "asked" | "host";
}

export interface ChatSend {
  readonly id: ReceiptId;
  /**
   * How the send ends: `sent` once the host has it; `unsent` when it has not reached the host but the
   * journal still holds it and shows it unsent, to post on the next connection to the same host
   * after the link closed, or on `resend` after it waited more than a day; `removed` when `remove`
   * withdrew it first. Rejects with the host's error when the host refused it, the one end where
   * nothing will send it. A refusal of that post on a later connection, which no `delivered` hears,
   * is listed in `connection.refused`.
   */
  readonly delivered: Promise<ChatDelivered>;
}

export type ChatDelivered =
  | { readonly kind: "sent"; readonly receipt: SendReceipt }
  | { readonly kind: "unsent"; readonly reason: unknown }
  | { readonly kind: "removed" };

export interface ChatOptions {
  /** `main` when absent. */
  readonly head?: HeadName;
  /** How many of the head's newest messages the chat holds before `earlier` loads more; 200 when absent. */
  readonly tail?: number;
}

/**
 * One head of a session, as a chat screen draws it and acts on it. It holds nothing until its
 * first listener: that one reads the head and follows its changes and streamed text, and the last
 * to leave closes them and returns the chat to its first snapshot. `snapshot()` returns the same
 * object until something drawn changes, and listeners hear only of a new snapshot, so a text frame
 * for another chat's part notifies no one.
 */
export interface Chat extends Live<ChatSnapshot> {
  /**
   * Puts the message in the connection's journal and resolves once the journal holds it, before the
   * host has it: from then it shows unsent until the host does, and survives a quit when the
   * journal's storage does. Rejects when it never reached the journal.
   */
  send(content: UserContent, options?: SendOptions): Promise<ChatSend>;
  resend(message: MessageId): Promise<void>;
  /** Withdraws a message that has not landed: an unsent one, expired or not, is never sent; one the host holds is withdrawn there. */
  remove(message: MessageId): Promise<void>;
  /** Asks the host to stop the run the view shows, and shows `stopping: "asked"` at once. Sends nothing while the chat shows no run or already shows it stopping. Rejects with the host's error only while it is the latest stop; an earlier one that fails changes nothing. */
  stop(): Promise<void>;
  /** Loads up to `count` older messages into the view, and resolves how many came: 0 once the head's first message is shown. */
  earlier(count: number): Promise<number>;
  /** Acts on a part of the session: an approval's decision (`act(part, "allow", {})`), a question's `answer` or `skip`, or any other action its kind declares. */
  act(part: PartId, action: string, input: Json): Promise<ActOutcome<unknown>>;
}

export interface ChatParts {
  readonly session: Session;
  readonly head: HeadName;
  readonly open: () => HeadStore;
  readonly text: (listener: (update: TextUpdate) => void) => Disposer;
  readonly health: Live<Health>;
  readonly journal: JournalLoop;
}

interface Opened {
  readonly head: HeadStore;
  readonly stops: readonly Disposer[];
}

interface Ask {
  readonly run: RunId;
  readonly health: Health;
}

const NO_MESSAGES: readonly MessageId[] = [];

export function openChat(parts: ChatParts): Chat {
  const listeners = listenerSet();
  const target = parts.session.head(parts.head);
  const lay = laidSends(parts.journal, parts.session.id, parts.head);
  const paged = () => pages<HeadView>((query) => target.history(query));
  let paging = paged();
  let opened: Opened | null = null;
  let texts = streamedText();
  let laid: HeadView | null = null;
  let asked: Ask | null = null;
  let snapshot = unopened();

  const showsStopping = (view: HeadView | null): ChatSnapshot["stopping"] => {
    const execution = view?.execution;

    if (execution === undefined || execution.kind === "idle") return "no";

    if (execution.kind === "live" && execution.stopping) return "host";

    return asked !== null &&
      asked.run === execution.run.id &&
      asked.health === parts.health.snapshot()
      ? "asked"
      : "no";
  };

  const draw = (freshness: Freshness, expired: readonly MessageId[]): void => {
    const view = laid === null ? null : texts.lay(paging.show(laid));
    const stopping = showsStopping(view);

    if (
      view === snapshot.view &&
      freshness === snapshot.freshness &&
      expired === snapshot.expired &&
      stopping === snapshot.stopping
    ) {
      return;
    }
    const seq = freshness.kind === "fresh" ? freshness.seq : snapshot.seq;
    snapshot = { view, seq, freshness, expired, stopping };
    listeners.notify();
  };

  const redraw = (): void => draw(snapshot.freshness, snapshot.expired);

  const settle = (head: HeadStore): void => {
    const rows = head.snapshot();
    const freshness = head.freshness();
    const seq = freshness.kind === "fresh" ? freshness.seq : null;
    laid = rows === null ? null : lay(headView(rows), seq);
    draw(freshness, keepIds(snapshot.expired, parts.journal.expired(parts.session.id, parts.head)));
  };

  const stream = (update: TextUpdate): void => {
    texts.apply(update);

    if (laid !== null) redraw();
  };

  return {
    subscribe(listener) {
      const leave = listeners.subscribe(listener);

      if (opened === null) {
        const head = parts.open();
        const changed = (): void => settle(head);

        opened = {
          head,
          stops: [
            head.subscribe(changed),
            parts.text(stream),
            parts.journal.subscribe(changed),
            parts.health.subscribe(redraw),
          ],
        };
      }

      return () => {
        leave();

        if (listeners.size() > 0 || opened === null) return;

        for (const stop of opened.stops) stop();
        opened.head.close();
        opened = null;
        texts = streamedText();
        laid = null;
        paging = paged();
        snapshot = unopened();
      };
    },
    snapshot: () => snapshot,
    async send(content, options) {
      const id = options?.id ?? asId<"receipt">(crypto.randomUUID());
      const journaled = parts.journal.held(id);
      const sent = target.send(content, { ...options, id });
      const sending = await Promise.race([journaled, sent.then(() => journaled)]);

      return { id, delivered: delivered(sent, sending) };
    },
    async resend(message) {
      await parts.journal.resend(parts.session.id, message);
    },
    async remove(message) {
      await parts.session.receipt(asId<"receipt">(message)).stop();
    },
    stop() {
      const execution = snapshot.view?.execution;

      if (execution === undefined || execution.kind === "idle" || snapshot.stopping !== "no") {
        return Promise.resolve();
      }
      const ask = { run: execution.run.id, health: parts.health.snapshot() };
      asked = ask;
      redraw();

      return parts.session
        .run(ask.run)
        .stop()
        .then(
          () => undefined,
          (error: unknown) => {
            if (asked !== ask) return;
            asked = null;
            redraw();

            throw error;
          },
        );
    },
    async earlier(count) {
      const loading = paging;
      const loaded = await loading.earlier(count);

      if (loaded > 0 && loading === paging) redraw();

      return loaded;
    },
    act: (part, action, input) => parts.session.part(part).act(action, input),
  };
}

function delivered(sent: Promise<SendReceipt>, sending: Sending): Promise<ChatDelivered> {
  return sent.then(
    (receipt) => ({ kind: "sent", receipt }),
    (reason: unknown) => {
      const left = sending.unanswered();

      if (left === "kept") return { kind: "unsent", reason };

      if (left === "removed") return { kind: "removed" };

      throw reason;
    },
  );
}

function keepIds(previous: readonly MessageId[], next: readonly MessageId[]): readonly MessageId[] {
  if (next.length === 0) return NO_MESSAGES;

  return next.length === previous.length && next.every((id, index) => id === previous[index])
    ? previous
    : next;
}

function unopened(): ChatSnapshot {
  return {
    view: null,
    seq: 0,
    freshness: { kind: "stale", since: Date.now(), error: null },
    expired: NO_MESSAGES,
    stopping: "no",
  };
}
