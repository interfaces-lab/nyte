import type {
  ConfigurationPatch,
  ConfigureOutcome,
  HeadName,
  Message,
  MessageId,
  MoveOptions,
  MoveOutcome,
  Position,
  RunId,
  SendOptions,
  SessionId,
  SessionView,
  TreeView,
  UserContent,
  ViewOptions,
} from "@nyte-ai/schema";
import { send } from "./admission.ts";
import { contributionsOf } from "./configuration.ts";
import { SdkError } from "./error.ts";
import { historyHead } from "./history.ts";
import type { Kernel } from "./kernel.ts";
import { move } from "./move.ts";
import { requireAuthority } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import type { Receipt, SendReceipt } from "./receipt.ts";
import { headRef, sessionRef } from "./refs.ts";
import {
  EMPTY_REVISION,
  STALE,
  attempt,
  commit,
  liveRun,
  put,
  requireSession,
} from "./session-state.ts";
import { tree } from "./tree.ts";
import { viewHead, watchHead } from "./watch.ts";

/**
 * Returns one head of a session: a ref into the commit DAG you can send to,
 * configure, watch and move.
 *
 * **Details**
 *
 * A head is a ref into the commit DAG; `tree`, `move` and `compact` are ref
 * operations on it. Creating, merging and removing heads is
 * `session.heads`. A {@link Session} is its main head plus session
 * management.
 *
 * @see {@link Session}
 * @category heads
 * @since 0.1.0
 */
export interface Head {
  readonly sessionId: SessionId;
  readonly name: HeadName;

  /**
   * Admits user content to this head and returns a receipt: admission, not an
   * answer.
   *
   * **Details**
   *
   * The id is minted before the network and journaled, so the message shows
   * `unsent` at once and is never sent twice. {@link Delivery} decides when
   * it runs; `configuration` overrides the head's selection for this input
   * only.
   *
   * **Editing**
   *
   * `send(content, { replace: id })` acts by the replaced message's status:
   *
   * - `unsent`: rewrite the journal row; nothing reached the host. Same id.
   * - `pending`: revise on the host in place. Same id.
   * - `landed`: one keyed command. Stop the live run if `running: "stop"`
   *   (durable Stop, settled before anything moves), move the head to the
   *   message's parent, admit the new input as a fresh id. The old path is
   *   retained as a sibling of the new message.
   *
   * The new message says what happened: `status.landed.replaced { previous,
   * stopped }`. Edit is a send option, not a method, so the move and the
   * admission are one CAS. A user message carries `siblings`: user commits
   * sharing its parent, in creation order, with this one's index. The client
   * draws "< 2/3 >" and switches with `move({ kind: "commit", id: sibling })`;
   * the view follows the head. Core maintains siblings in the fold; no client
   * walks the tree.
   *
   * What the view shows while an edit lands, in order:
   *
   * 1. the old run's live parts flip to status `failed { stopped }` at the
   *    fence, synchronously;
   * 2. messages after the edited one's parent leave the list; the edited
   *    message's siblings count grows by one;
   * 3. the new user message appears unsent → pending → landed, and a new run
   *    goes live under it.
   *
   * A watcher sees these as at most three coalesced views, never a view with
   * both the old tail and the new input.
   *
   * **Gotchas**
   *
   * Stop is exact: an edit stops the head's run and nothing else. Children
   * and jobs in `view.background` keep working; a child's report attaches to
   * the head wherever the head is by then. A landed edit settles the receipt
   * with a {@link MoveOutcome} failure instead of running: `stale` (expect
   * lost), `busy` (`running: "refuse"` and a run is live), `pending-input`
   * (other inputs queued behind the edited one; withdraw or place them first).
   *
   * **Example** (Sending and waiting for the message to land)
   *
   * ```ts
   * declare const session: Session;
   *
   * const receipt = await session.send("Add a test for the parser.", { delivery: "queue" });
   * const landed = await receipt.landed();
   * if (landed.kind === "landed" && landed.run !== null) {
   *   const end = await session.run(landed.run).settled();
   * }
   * ```
   *
   * **Example** (Editing a landed message)
   *
   * ```ts
   * declare const session: Session;
   * declare const message: MessageId;
   * declare const revision: Revision;
   *
   * const receipt = await session.send("Use the v2 parser instead.", {
   *   replace: message,
   *   expect: revision,
   * });
   * ```
   *
   * @see {@link SendOptions}
   * @see {@link SendReceipt}
   * @authority participant
   */
  send(content: UserContent, options?: SendOptions): Promise<SendReceipt>;
  /**
   * Changes this head's durable defaults: model, thinking, agent, settings.
   *
   * @returns {@link ConfigureOutcome}
   * @authority participant
   */
  configure(patch: ConfigurationPatch): Promise<ConfigureOutcome>;

  /**
   * Returns one snapshot of the head's view. Moves no seen mark.
   *
   * @authority participant
   */
  view(options?: ViewOptions): Promise<SessionView>;
  /**
   * Yields the same snapshot as `view()` on every change. Reading is seeing.
   *
   * **Details**
   *
   * There is no `events()`. A client never subscribes to a delta stream and
   * never invalidates a cache. The deltas that build the view are internal
   * to `watch()`; the durable log is `host.inspect(id).events()`.
   *
   * A watch exists where things change without the client's own action: a
   * session while the model talks, the directory while sessions come and go,
   * git status while a run edits, a page while it loads. Not where the only
   * writer is the caller. Nothing polls; a watch is the host pushing.
   *
   * Seen is not an operation. While `watch()` is open for a principal, each
   * tip it yields becomes `sessions/<id>/seen/<principal>/<head>`. A head is
   * unread when its tip is not that ref.
   *
   * Identity: each view's unchanged messages and turns are the same objects.
   * A token appends to one part; everything else keeps identity, so a
   * memoised row does not re-render.
   *
   * **Delta guarantees**
   *
   * Core is the editor, not the wire service: it already holds the page, so
   * it updates the paragraph and hands over the page, rather than shouting
   * "token" and letting each client re-lay the sheet.
   *
   * 1. Core folds incrementally. A token touches one part and the spine above
   *    it; every other message, turn and field is the same object.
   * 2. Core maintains derived data incrementally. `turn.state`,
   *    `turn.summary` and `view.changes` update when one tool settles: one
   *    tool, one turn, one path. No client walks the transcript to build
   *    anything.
   * 3. `watch()` coalesces. At most one yield per frame (~16 ms outside a
   *    browser), newest view wins, never more than one pending.
   * 4. One fold per session per connection, shared by every watcher. The
   *    last watcher leaving drops it. Memory is bounded by what is on screen.
   * 5. Remote carries deltas, never views; the SDK folds with the same code
   *    on the client side. In-process on a Host nothing is serialized.
   *
   * **Example** (Drawing the transcript)
   *
   * ```ts
   * declare const session: Session;
   * declare function draw(view: SessionView): void;
   *
   * for await (const view of session.watch()) {
   *   draw(view);
   * }
   * ```
   *
   * @stream watch
   * @authority participant
   */
  watch(options?: ViewOptions): AsyncIterable<SessionView>;
  /**
   * Returns older messages for scroll-back, newest last, ending before
   * `before`. The view's `messages` is the tail; this is the rest.
   *
   * @authority participant
   */
  history(input: { readonly before: MessageId; readonly limit: number }): Promise<readonly Message[]>;

  /**
   * Returns the whole DAG, projected by core: every commit on every branch,
   * the active path marked. The /tree picker's data; a client draws rows and
   * folds.
   *
   * @authority participant
   */
  tree(): Promise<TreeView>;
  /**
   * Moves the head to a position, as a durable command that may summarise
   * the abandoned path with a model.
   *
   * **Details**
   *
   * Moving to a user commit lands on its parent and hands its content back
   * for the composer.
   *
   * @returns {@link MoveOutcome}, through the receipt.
   * @authority participant
   */
  move(position: Position, options?: MoveOptions): Promise<Receipt<MoveOutcome>>;
  /**
   * Starts a compaction of this head's context.
   *
   * **Outcomes**
   *
   * - `started`: the compaction part appears live as `message`; its status says the rest.
   * - `busy`: `run` is live.
   * - `nothing-to-compact`: the context is already as small as it gets.
   *
   * @authority participant
   */
  compact(input?: { readonly instructions?: string }): Promise<{ readonly kind: "started"; readonly message: MessageId } | { readonly kind: "busy"; readonly run: RunId } | { readonly kind: "nothing-to-compact" }>;
}

/** Returns a handle on one head of a session for a connection, its `send` admitting through `admit`: `send` (after the session's activation), or `sendNow` for the api an activation constructs (§44b). Binds synchronously; no I/O. */
export function headHandle(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  head: HeadName,
  admit: typeof send = send,
): Head {
  const need = (operation: string): void =>
    requireAuthority(context.authority, "participant", `head.${operation}`);

  const { principal } = context;

  return {
    sessionId: session,
    name: head,
    async send(content, options) {
      need("send");

      return admit(kernel, { session, head, context, content, options });
    },
    async configure(patch) {
      need("configure");

      return configure(kernel, session, head, patch);
    },
    async view(options) {
      need("view");

      return viewHead(kernel, { session, head, principal, options });
    },
    watch(options) {
      need("watch");

      return watchHead(kernel, { session, head, principal, options });
    },
    async history(input) {
      need("history");

      return historyHead(kernel, {
        session,
        head,
        principal,
        before: input.before,
        limit: input.limit,
      });
    },
    async tree() {
      need("tree");

      return tree(kernel, session, head);
    },
    async move(position, options) {
      need("move");

      return move(kernel, session, head, position, options);
    },
    async compact(input) {
      need("compact");
      const run = await liveRun(kernel, session, head);

      if (run !== null) return { kind: "busy", run: run.record.view.id };

      return kernel.compact({ session, head, instructions: input?.instructions ?? null });
    },
  };
}

async function configure(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  patch: ConfigurationPatch,
): Promise<ConfigureOutcome> {
  const found = await requireSession(kernel, session);
  const entry = found.record.heads.find((current) => current.name === head);

  if (entry === undefined) throw new SdkError("unknown", `Session ${session} has no head ${head}.`);
  await kernel.pluginsFor(session).ready;

  const selected = await kernel.resolveConfiguration({
    session,
    head,
    selected: entry.selected,
    patch,
    contributions: contributionsOf(kernel.pluginsFor(session)),
  });

  if (selected.kind !== "exact") return selected;

  await attempt(`Configuring ${head}`, async () => {
    const current = await requireSession(kernel, session);

    const record = {
      ...current.record,
      heads: current.record.heads.map((other) =>
        other.name === head ? { ...other, selected } : other,
      ),
    };

    const outcome = await commit(kernel, [
      {
        name: sessionRef(session),
        target: await put(kernel, "session", record),
        expect: current.ref.revision,
        event: { head, kind: "configured", selected, effective: selected },
      },
    ]);

    return outcome.kind === "set" ? true : STALE;
  });

  const ref = await kernel.store.refs.get(headRef(session, head));

  return { kind: "configured", selected, revision: ref?.revision ?? EMPTY_REVISION };
}
