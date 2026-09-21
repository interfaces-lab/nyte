/**
 * What this client knows about its own messages between Enter and the watch.
 *
 * The outbox holds a message as `sending` until the store's receipt names its
 * change; the watch then shows that change as pending, and later landed or
 * cancelled. The two arrive in either order, so every message is matched by
 * identity and never by content: the submission key the outbox minted, which
 * core returns on the pending item and on the committed user part, and the
 * change the receipt named. A remembered receipt is drawn until the watch
 * shows its message, so a row cannot blink out between the reply and the
 * fold; a receipt for a message the watch already showed draws nothing, so a
 * message is never seen twice.
 *
 * State is bounded by the sends in flight and the receipts still arriving.
 * The one question this class asks is a resync, after a receipt whose message
 * a snapshot could not place: the snapshot may have been taken before the
 * submit applied, or after the message was cancelled, and only the store can
 * say which. A separate queue read cannot tell the two apart either: the
 * change may have landed while the watch's commit is still on its way, and
 * dropping the row then blanks the message until the commit arrives. So the
 * question is the observer's own full read, published to this bridge as a
 * snapshot before the resync settles. That snapshot was read after the
 * receipt, so it places the message pending or landed, or it is gone.
 */
import type { HeadName, Oid, PendingItem, SendReceipt, SessionEvent, Turn } from "@nyte-ai/core";
import type { OutboxEntry } from "./outbox.ts";
import { gutterRows } from "./pending-gutter.ts";
import type { GutterRow } from "./pending-gutter.ts";

interface SentMessagesDependencies {
  /**
   * Replace the observer's state with a fresh snapshot, published through
   * `snapshot` before the promise settles. Rejects when the observer stopped
   * or another rebase superseded the read; the rows then keep waiting.
   */
  readonly resync: () => Promise<unknown>;
  /** The rows changed outside a watch update or an outbox change. */
  readonly onChange: () => void;
}

/**
 * What the watch said about a send still without a receipt: `shown` once it
 * drew the message (pending, committed, or already settled), so the receipt
 * draws nothing; `spanned` when a snapshot replaced the fold without it, so
 * the receipt asks the store where it went. `shown` is final.
 */
type InFlightMark = "shown" | "spanned";

/** The identities a watch update names for one message. */
interface Named {
  readonly key?: string;
  readonly change?: Oid;
}

/** A receipt the watch has not shown yet, numbered in the order receipts came. */
interface Arriving {
  readonly item: PendingItem;
  readonly arrival: number;
}

/**
 * A resync under way: the receipts recorded when it was asked, which its
 * snapshot is read after, and the snapshots applied by then, so its answer
 * counts only once a newer one was published.
 */
interface Verification {
  readonly arrivals: number;
  readonly snapshots: number;
}

function userKeys(transcript: readonly Turn[]): readonly string[] {
  const keys: string[] = [];
  for (const turn of transcript) {
    if (turn.kind !== "turn") continue;
    for (const part of turn.parts) {
      if (part.kind === "user" && part.key !== undefined) keys.push(part.key);
    }
  }
  return keys;
}

export class SentMessages {
  private readonly dependencies: SentMessagesDependencies;
  /** Receipts the watch has not shown yet, by the key that named the message while sending. */
  private readonly arriving = new Map<string, Arriving>();
  /** Sends without a receipt the watch has spoken about. Pruned to the outbox's entries. */
  private readonly inFlight = new Map<string, InFlightMark>();
  /** Keys the outbox is still sending, as it last reported them. */
  private sendingKeys: ReadonlySet<string> = new Set();
  /** Receipts recorded so far; each arriving entry carries its number. */
  private arrivals = 0;
  /** Snapshots applied so far. */
  private snapshots = 0;
  /** The resync under way, if any; a question it already covers waits for its answer. */
  private verification: Verification | undefined;

  constructor(dependencies: SentMessagesDependencies) {
    this.dependencies = dependencies;
  }

  /** The store answered a send. `duplicate` answers a retry whose first attempt reached the store; it is as durable as `queued`. */
  receipt(entry: OutboxEntry, receipt: SendReceipt): void {
    const mark = this.inFlight.get(entry.key);
    this.inFlight.delete(entry.key);
    if (mark === "shown") return;
    const item: PendingItem = {
      change: receipt.change,
      delivery: entry.delivery,
      at: entry.at,
      content: entry.content,
      key: entry.key,
    };
    this.arrivals += 1;
    this.arriving.set(entry.key, { item, arrival: this.arrivals });
    if (mark === "spanned") this.verify();
  }

  /** The set of sending messages changed. */
  sending(entries: readonly OutboxEntry[]): void {
    this.sendingKeys = new Set(entries.map((entry) => entry.key));
    for (const key of this.inFlight.keys()) {
      if (!this.sendingKeys.has(key)) this.inFlight.delete(key);
    }
  }

  /**
   * The watch yielded an event for `head`. A pending item, a commit that
   * landed a submission, a landing, and a cancellation each name a message;
   * the rest name none. Returns whether the rows changed.
   */
  event(event: SessionEvent, head: HeadName): boolean {
    switch (event.kind) {
      case "queued":
        return event.head === head && this.shown(event.item);
      case "commit":
        return event.head === head && this.shown(event.item.commit);
      case "landed":
        return event.head === head && this.shown({ change: event.change });
      case "queue_cancelled":
        return this.shown({ change: event.change });
      default:
        return false;
    }
  }

  /**
   * A snapshot replaced the fold: events before it were never seen. A receipt
   * it holds, pending or committed, is the watch's to draw; one it does not
   * hold is asked about. A send without a receipt is marked by whether the
   * snapshot placed it.
   */
  snapshot(pending: readonly PendingItem[], transcript: readonly Turn[]): void {
    this.snapshots += 1;
    const keys = new Set(userKeys(transcript));
    for (const item of pending) if (item.key !== undefined) keys.add(item.key);
    const changes = new Set(pending.map((item) => item.change));
    let unplaced = false;
    for (const [key, entry] of this.arriving) {
      if (keys.has(key) || changes.has(entry.item.change)) this.arriving.delete(key);
      else unplaced = true;
    }
    if (unplaced) this.verify();
    for (const key of this.sendingKeys) {
      if (keys.has(key)) this.inFlight.set(key, "shown");
      else if (this.inFlight.get(key) !== "shown") this.inFlight.set(key, "spanned");
    }
  }

  /**
   * The fold's pending items, then receipts the fold has not caught up with,
   * then what is still sending. A send the watch already showed is drawn by
   * the fold alone, whether it shows the message pending or in the record.
   */
  rows(pending: readonly PendingItem[], sending: readonly OutboxEntry[]): GutterRow[] {
    const arriving = [...this.arriving.values()]
      .map((entry) => entry.item)
      .filter(
        (item) => !pending.some((shown) => shown.change === item.change || shown.key === item.key),
      );
    return gutterRows(
      [...pending, ...arriving],
      sending.filter((entry) => this.inFlight.get(entry.key) !== "shown"),
    );
  }

  private shown(named: Named): boolean {
    let changed = false;
    for (const [key, entry] of this.arriving) {
      if (key !== named.key && entry.item.change !== named.change) continue;
      this.arriving.delete(key);
      changed = true;
    }
    if (
      named.key !== undefined &&
      this.sendingKeys.has(named.key) &&
      this.inFlight.get(named.key) !== "shown"
    ) {
      // The sending row gives way to the fold's; its receipt will draw nothing.
      this.inFlight.set(named.key, "shown");
      changed = true;
    }
    return changed;
  }

  /**
   * Ask the observer for a fresh snapshot on behalf of every receipt still
   * arriving. A resync already under way that was asked after the newest of
   * them answers for all; one asked before a receipt cannot vouch for it, so
   * a newer resync is asked and supersedes it.
   */
  private verify(): void {
    let newest = 0;
    for (const entry of this.arriving.values()) newest = Math.max(newest, entry.arrival);
    if (newest === 0) return;
    if (this.verification !== undefined && this.verification.arrivals >= newest) return;
    const asked: Verification = { arrivals: this.arrivals, snapshots: this.snapshots };
    this.verification = asked;
    this.dependencies.resync().then(
      () => this.answered(asked, true),
      () => this.answered(asked, false),
    );
  }

  /**
   * A resync settled. Its snapshot, applied before it resolved, placed every
   * receipt it held; an entry still arriving that the resync was asked after
   * is therefore gone from the store, and its row goes. A receipt recorded
   * after the resync was asked is answered by a newer one. A resync that
   * failed, or that resolved without a snapshot reaching this bridge, has
   * said nothing; the rows stay until a snapshot asks again.
   */
  private answered(asked: Verification, resolved: boolean): void {
    if (this.verification === asked) this.verification = undefined;
    if (!resolved || this.snapshots === asked.snapshots) return;
    let changed = false;
    for (const [key, entry] of this.arriving) {
      if (entry.arrival > asked.arrivals) continue;
      this.arriving.delete(key);
      changed = true;
    }
    if (changed) this.dependencies.onChange();
  }
}
