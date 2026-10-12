import { asId } from "@nyte-ai/schema";
import type {
  CommitId,
  Configuration,
  ConfigurationPatch,
  Delivery,
  HeadName,
  MessageId,
  MessageSource,
  ReceiptId,
  RefUpdate,
  Revision,
  RunId,
  Schedule,
  SendOptions,
  SessionId,
  Submission,
  UserContent,
} from "@nyte-ai/schema";
import { summarize, summaryUpdates } from "./branch-summary.ts";
import { contributionsOf } from "./models.ts";
import { objectId } from "./content.ts";
import { dev } from "./dev-log.ts";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import type { ConnectionContext } from "./principals.ts";
import type { SendReceipt } from "./receipt.ts";
import { known, reserve } from "./receipt-handles.ts";
import { sendReceipt, settleReceipt } from "./receipts.ts";
import { envelope } from "./records.ts";
import type { CommitRecord, MessageRecord, RunRecord } from "./records.ts";
import { headRef, inboxRef, receiptRef } from "./refs.ts";
import { abortHere, fence, stopRun, unfenced } from "./runs.ts";
import {
  EMPTY_REVISION,
  STALE,
  attempt,
  commit,
  expectOf,
  inboxWithout,
  isCovered,
  landedIn,
  liveRun,
  objectOf,
  pathOf,
  put,
  putCommit,
  readInbox,
  readReceipt,
  readTip,
  requireSession,
  sameRevision,
  staleHead,
  withFold,
} from "./session-state.ts";
import type { Inbox, MoveFailure, Tip } from "./session-state.ts";

/** Returns one send as admission sees it: where it goes, who sends it, what, and the head's stored selection. */
interface Sending {
  readonly kernel: Kernel;
  readonly session: SessionId;
  readonly head: HeadName;
  readonly context: ConnectionContext;
  readonly content: UserContent;
  readonly options: SendOptions;
  readonly selected: Configuration | null;
}

/** Returns what a send names: the session, head, sending connection, content and options. */
type SendInput = {
  readonly session: SessionId;
  readonly head: HeadName;
  readonly context: ConnectionContext;
  readonly content: UserContent;
  readonly options?: SendOptions;
};

/** Returns what a guarded head read: its tip, its inbox holding only attach inputs, and the run to stop. */
interface Guarded {
  readonly tip: Tip;
  readonly inbox: Inbox;
  readonly run: RunId | null;
}

const USER: MessageSource = { kind: "user" };

/** Returns a replace's own receipt id and the digest a resend must match. */
interface Keyed {
  readonly id: ReceiptId;
  readonly digest: string;
}

/** Admits user content to a head after the session's activation in this process (§44a); see `sendNow`. */
export async function send(kernel: Kernel, input: SendInput): Promise<SendReceipt> {
  await kernel.pluginsFor(input.session).ready;

  return sendNow(kernel, input);
}

/** Admits user content to a head and returns its receipt without awaiting the session's activation: the send path of the api an activation constructs and of a command's prompt (§44b). It replays a known id, runs `before_send`, resolves the configuration and admits in one set. A `replace` first replays its own id, then revises a pending input in place or edits a landed one. */
export async function sendNow(kernel: Kernel, input: SendInput): Promise<SendReceipt> {
  const found = await requireSession(kernel, input.session);
  const head = found.record.heads.find((entry) => entry.name === input.head);

  if (head === undefined)
    throw new SdkError("unknown", `Session ${input.session} has no head ${input.head}.`);

  const sending: Sending = {
    kernel,
    session: input.session,
    head: input.head,
    context: input.context,
    content: input.content,
    options: input.options ?? {},
    selected: head.selected,
  };

  const target = sending.options.replace;

  if (target === undefined) return admit(sending);

  const keyed = {
    id: sending.options.id ?? asId<"receipt">(crypto.randomUUID()),
    digest: await digestOf(sending),
  };

  const replayed = await replayOf(kernel, input.session, keyed);

  if (replayed !== null) return replayed;
  const inbox = await readInbox(kernel, input.session, input.head);

  return inbox.messages.includes(target)
    ? revise(sending, target, keyed)
    : edit(sending, target, keyed);
}

/** Lands admitted inputs on a head into a run, or none: writes their user commits, advances the head, drops them from the inbox, and publishes `input landed` then `commit` per input in one set; returns the messages it landed. The set expects the run unfenced (§61), or carries `start`, the run's `run started`, when the inputs start it; a start lands nothing without an input that is not attached (§62). */
export async function landing(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  ids: readonly MessageId[],
  run: RunId | null,
  start: RefUpdate | null = null,
): Promise<readonly MessageId[]> {
  const landed = await attempt(`Landing on ${head}`, async () => {
    const [tip, inbox] = await Promise.all([
      readTip(kernel, session, head),
      readInbox(kernel, session, head),
    ]);

    const due = inbox.messages.filter((message) => ids.includes(message));

    if (due.length === 0) return [];

    const held = start ?? (run === null ? null : await unfenced(kernel, session, run));

    if (run !== null && held === null) return [];

    const { inputs, siblings } = await withFold(kernel, session, (state) => ({
      inputs: due.map((message) => state.inputs.get(message)),
      siblings: state.siblings.get(tip.id) ?? [],
    }));

    if (start !== null && inputs.every((input) => input?.delivery === "attach")) return [];

    const at = Date.now();
    const records: { readonly id: CommitId; readonly record: CommitRecord }[] = [];

    for (const [index, message] of due.entries()) {
      const input = inputs[index];

      if (input === undefined)
        throw new SdkError(
          "internal",
          `Message ${message} is in the inbox but was never admitted.`,
        );

      const record: CommitRecord = {
        parent: records.at(-1)?.id ?? tip.id,
        at,
        run,
        body: {
          kind: "user",
          message,
          content: input.content,
          source: input.source,
          delivery: input.delivery,
          siblings: index === 0 ? siblings : [],
        },
      };

      records.push({ id: await putCommit(kernel, record), record });
    }

    const remaining = await put(kernel, "inbox", inboxWithout(inbox, due));

    const updates = records.flatMap(({ id, record }, index): readonly RefUpdate[] => [
      {
        name: inboxRef(session, head),
        target: remaining,
        expect: index === 0 ? expectOf(inbox.ref) : undefined,
        event: {
          head,
          kind: "input",
          message: due[index],
          change: "landed",
          commit: id,
          run,
        },
      },
      {
        name: headRef(session, head),
        target: objectOf(id),
        expect: index === 0 ? expectOf(tip.ref) : undefined,
        event: {
          head,
          kind: "commit",
          id,
          parent: record.parent,
          run,
          body: record.body,
        },
      },
    ]);

    return (await commit(kernel, held === null ? updates : [held, ...updates])).kind === "set"
      ? due.map((message, index) => ({ message, commit: records[index].id }))
      : STALE;
  });

  if (run !== null && landed.length > 0)
    landedIn(kernel).set(run, [
      ...(landedIn(kernel).get(run) ?? []),
      ...landed.map((entry) => entry.message),
    ]);

  return landed.map((entry) => entry.message);
}

/** Checks what a move or an edit needs of a head, in order: `expect` holds, no live run unless `running` is stop, no pending input as the inbox records it; returns the failure, or what it read for the write to expect. */
export async function guard(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  expect: Revision | undefined,
  running: "refuse" | "stop",
): Promise<MoveFailure | Guarded> {
  const [tip, inbox, run] = await Promise.all([
    readTip(kernel, session, head),
    readInbox(kernel, session, head),
    liveRun(kernel, session, head),
  ]);

  if (expect !== undefined && !sameRevision(expect, tip.ref))
    return { kind: "stale", revision: tip.ref?.revision ?? EMPTY_REVISION };

  if (run !== null && running === "refuse") return { kind: "busy", run: run.record.view.id };

  const pending = inbox.messages.filter((message) => inbox.pendingInput.includes(message));

  if (pending.length > 0) return { kind: "pending-input", messages: pending };

  return { tip, inbox, run: run?.record.view.id ?? null };
}

async function admit(sending: Sending): Promise<SendReceipt> {
  const { kernel, session, head, options } = sending;
  const id = options.id ?? asId<"receipt">(crypto.randomUUID());
  const digest = await digestOf(sending);

  if (await known(kernel, session, id, "send", digest)) return sendReceipt(kernel, session, id);
  dev("admission", "send", { session, head, receipt: id });

  const submission = await gate(sending, asId<"message">(id), {
    content: sending.content,
    source: options.source ?? USER,
    delivery: options.delivery ?? "steer",
    configuration: options.configuration ?? null,
    replace: null,
  });

  const configuration = await resolve(sending, submission.configuration);
  const covered = await isCovered(kernel, session);

  return attempt(`Admitting ${id}`, async () => {
    const [inbox, run] = await Promise.all([
      readInbox(kernel, session, head),
      liveRun(kernel, session, head),
    ]);

    const message: MessageRecord = {
      id: asId<"message">(id),
      at: Date.now(),
      content: submission.content,
      source: submission.source,
      delivery: submission.delivery,
      schedule: await scheduleOf(submission.delivery, configuration, run?.record ?? null),
      covered,
      configuration,
      replaced: null,
      position: inbox.messages.length,
    };

    const outcome = await commit(kernel, [
      await admitted(kernel, session, head, inbox, [...inbox.messages, message.id], message),
      await pendingReceipt(kernel, session, id, digest, "absent"),
    ]);

    if (outcome.kind === "stale")
      return outcome.name === receiptRef(session, id) &&
        (await known(kernel, session, id, "send", digest))
        ? sendReceipt(kernel, session, id)
        : STALE;

    if (message.delivery !== "attach" && covered) kernel.wakes.notify(session, head);

    if (message.source.kind === "user")
      await kernel.waits.inputAdmitted(session, head, message.id, run?.record.parked ?? []);
    dev("admission", "admitted", { session, head, message: message.id, covered });

    return sendReceipt(kernel, session, id);
  });
}

/** Revises a pending input in place under its own id, and writes `receipts/<keyed.id>` naming the target in the same set, so a resent revise replays; one that landed meanwhile is edited instead. */
async function revise(sending: Sending, target: MessageId, keyed: Keyed): Promise<SendReceipt> {
  const { kernel, session, head, options } = sending;
  const { id, digest } = keyed;
  const previous = await withFold(kernel, session, (state) => state.inputs.get(target));

  const submission = await gate(sending, target, {
    content: sending.content,
    source: options.source ?? previous?.source ?? USER,
    delivery: options.delivery ?? previous?.delivery ?? "steer",
    configuration: options.configuration ?? null,
    replace: target,
  });

  const configuration =
    submission.configuration === null && previous !== undefined
      ? previous.configuration
      : await resolve(sending, submission.configuration);

  const covered = await isCovered(kernel, session);

  const revised = await attempt(`Revising ${target}`, async () => {
    const [inbox, run] = await Promise.all([
      readInbox(kernel, session, head),
      liveRun(kernel, session, head),
    ]);

    const current = inbox.messages.indexOf(target);

    if (current < 0) return null;
    const rest = inbox.messages.filter((message) => message !== target);
    const position = placeOf(options.position, rest, current);

    const message: MessageRecord = {
      id: target,
      at: Date.now(),
      content: submission.content,
      source: submission.source,
      delivery: submission.delivery,
      schedule: await scheduleOf(submission.delivery, configuration, run?.record ?? null),
      covered,
      configuration,
      replaced: previous?.replaced ?? null,
      position,
    };

    const outcome = await commit(kernel, [
      await admitted(
        kernel,
        session,
        head,
        inbox,
        [...rest.slice(0, position), target, ...rest.slice(position)],
        message,
      ),
      {
        name: receiptRef(session, id),
        target: await put(kernel, "receipt", {
          id: asId<"receipt">(target),
          kind: "send",
          digest,
          outcome: null,
        }),
        expect: "absent",
        event: {
          head,
          kind: "input",
          message: target,
          change: "scheduled",
          schedule: message.schedule,
          position,
        },
      },
    ]);

    if (outcome.kind === "stale")
      return outcome.name === receiptRef(session, id)
        ? ((await replayOf(kernel, session, keyed)) ?? STALE)
        : STALE;

    if (message.delivery !== "attach" && covered) kernel.wakes.notify(session, head);
    dev("admission", "revised", { session, head, message: target });

    return sendReceipt(kernel, session, asId<"receipt">(target));
  });

  return revised ?? editGated(sending, target, { id, digest, submission, configuration });
}

/** Edits a landed input: stops the head's run, moves the head to the input's parent and admits the new content under a fresh id, in one set guarded by what `guard` read (§40). */
async function edit(sending: Sending, target: MessageId, keyed: Keyed): Promise<SendReceipt> {
  const { kernel, session, options } = sending;
  const { id, digest } = keyed;
  const previous = await withFold(kernel, session, (state) => state.inputs.get(target));

  const submission = await gate(sending, asId<"message">(id), {
    content: sending.content,
    source: options.source ?? USER,
    delivery: options.delivery ?? "steer",
    configuration: options.configuration ?? previous?.configuration ?? null,
    replace: target,
  });

  const configuration = await resolve(sending, submission.configuration);

  return editGated(sending, target, { id, digest, submission, configuration });
}

/** Writes an edit whose `before_send` already ran, so a revise that found its target landed runs the hook once. */
async function editGated(
  sending: Sending,
  target: MessageId,
  gated: Keyed & {
    readonly submission: Submission;
    readonly configuration: Configuration;
  },
): Promise<SendReceipt> {
  const { kernel, session, head, options } = sending;
  const { id, digest, submission, configuration } = gated;
  const covered = await isCovered(kernel, session);
  const abandoned = options.abandoned;

  const message = (stopped: RunId | null, position: number): MessageRecord => ({
    id: asId<"message">(id),
    at: Date.now(),
    content: submission.content,
    source: submission.source,
    delivery: submission.delivery,
    schedule:
      submission.delivery === "attach"
        ? { kind: "attached" }
        : { kind: "next-turn", reason: "idle" },
    covered,
    configuration,
    replaced: { previous: target, stopped },
    position,
  });

  const wake = (stopped: RunId | null): void => {
    if (stopped !== null || (covered && submission.delivery !== "attach"))
      kernel.wakes.notify(session, head);
  };

  const edited = await attempt<
    | { readonly kind: "failed"; readonly outcome: MoveFailure }
    | {
        readonly kind: "summarize";
        readonly tip: Tip;
        readonly parent: CommitId | null;
        readonly run: RunId | null;
        readonly instructions: string | null;
      }
    | { readonly kind: "edited"; readonly stopped: RunId | null }
    | { readonly kind: "replayed"; readonly receipt: SendReceipt }
  >(`Editing ${target}`, async () => {
    const checked = await guard(kernel, session, head, options.expect, options.running ?? "stop");

    if ("kind" in checked) return { kind: "failed", outcome: checked };
    const parent = await locate(kernel, session, checked.tip, target);

    if (parent === undefined) return { kind: "failed", outcome: { kind: "missing-target" } };

    if (typeof abandoned === "object")
      return {
        kind: "summarize",
        tip: checked.tip,
        parent,
        run: checked.run,
        instructions: abandoned.summarize.instructions ?? null,
      };
    const fenced = checked.run === null ? null : await fence(kernel, session, checked.run);
    const stopped = fenced === null || fenced.kind === "ended" ? null : checked.run;
    const record = message(stopped, checked.inbox.messages.length);

    const outcome = await commit(kernel, [
      ...(fenced?.kind === "live" ? fenced.updates : []),
      {
        name: headRef(session, head),
        target: parent === null ? null : objectOf(parent),
        expect: expectOf(checked.tip.ref),
        event: { head, kind: "head", from: checked.tip.id, to: parent, reason: "moved" },
      },
      await admitted(
        kernel,
        session,
        head,
        checked.inbox,
        [...checked.inbox.messages, record.id],
        record,
      ),
      await pendingReceipt(kernel, session, id, digest, "absent"),
    ]);

    dev("admission", "edit", { session, head, target, outcome: outcome.kind });

    if (outcome.kind === "set") return { kind: "edited", stopped };

    const replayed =
      outcome.name === receiptRef(session, id) ? await replayOf(kernel, session, gated) : null;

    return replayed === null ? STALE : { kind: "replayed", receipt: replayed };
  });

  switch (edited.kind) {
    case "replayed":
      return edited.receipt;

    case "failed":
      if (!(await reserve(kernel, session, { id, kind: "send", digest, outcome: edited.outcome })))
        return (await replayOf(kernel, session, gated)) ?? sendReceipt(kernel, session, id);
      break;

    case "summarize": {
      if (!(await reserve(kernel, session, { id, kind: "send", digest, outcome: null })))
        return (await replayOf(kernel, session, gated)) ?? sendReceipt(kernel, session, id);

      const stopped =
        edited.run !== null && (await stopRun(kernel, session, edited.run)).kind === "requested"
          ? edited.run
          : null;

      void summarizedEdit(kernel, {
        id,
        session,
        head,
        tip: edited.tip,
        parent: edited.parent,
        instructions: edited.instructions,
        message: (position) => message(stopped, position),
      })
        .then((admittedEdit) => {
          if (admittedEdit) wake(stopped);
        })
        .catch(async (error: unknown) =>
          settleReceipt(kernel, session, id, {
            kind: "summary-failed",
            reason: error instanceof Error ? error.message : String(error),
          }),
        )
        .catch(() => undefined);
      break;
    }

    case "edited":
      if (edited.stopped !== null) abortHere(kernel, edited.stopped);
      wake(edited.stopped);
  }

  return sendReceipt(kernel, session, id);
}

/** Writes an edit's branch summary, then admits the edit in one set with it; queued user input refuses it `pending-input` and a moved head `stale`, settling its receipt. Resolves whether it was admitted. */
async function summarizedEdit(
  kernel: Kernel,
  input: {
    readonly id: ReceiptId;
    readonly session: SessionId;
    readonly head: HeadName;
    readonly tip: Tip;
    readonly parent: CommitId | null;
    readonly instructions: string | null;
    readonly message: (position: number) => MessageRecord;
  },
): Promise<boolean> {
  const { id, session, head, tip } = input;

  const abandoned = await withFold(kernel, session, (state) => {
    const kept = new Set(pathOf(state.commits, input.parent));

    return pathOf(state.commits, tip.id).filter((commit) => !kept.has(commit));
  });

  const summary = await summarize(kernel, {
    session,
    head,
    commits: abandoned,
    instructions: input.instructions,
    signal: new AbortController().signal,
  });

  if (summary.kind === "failed") {
    await settleReceipt(kernel, session, id, { kind: "summary-failed", reason: summary.reason });

    return false;
  }

  const written = await summaryUpdates(kernel, {
    session,
    head,
    tip,
    landing: input.parent,
    abandoned,
    markdown: summary.markdown,
  });

  const admittedEdit = await attempt<MoveFailure | null>(`Editing ${id}`, async () => {
    const checked = await guard(kernel, session, head, undefined, "stop");

    if ("kind" in checked) return checked;
    const { inbox } = checked;
    const record = input.message(inbox.messages.length);

    const outcome = await commit(kernel, [
      ...written.updates,
      await admitted(kernel, session, head, inbox, [...inbox.messages, record.id], record),
    ]);

    if (outcome.kind === "set") return null;

    return outcome.name === inboxRef(session, head) ? STALE : staleHead(kernel, session, head);
  });

  if (admittedEdit !== null) await settleReceipt(kernel, session, id, admittedEdit);

  return admittedEdit === null;
}

/** Returns the receipt a replace's own id already answered with, or null when the id is new: the record at `receipts/<id>` names it (a revise's names its target). */
async function replayOf(
  kernel: Kernel,
  session: SessionId,
  { id, digest }: Keyed,
): Promise<SendReceipt | null> {
  const found = await readReceipt(kernel, session, id);

  if (found === null) return null;

  if (found.record.kind !== "send" || found.record.digest !== digest)
    throw new SdkError("invalid", `Receipt ${id} was used for another command.`);

  return sendReceipt(kernel, session, found.record.id);
}

/** Returns the parent of the commit that landed a message on a tip's path, or undefined when the path has none. */
async function locate(
  kernel: Kernel,
  session: SessionId,
  tip: Tip,
  target: MessageId,
): Promise<CommitId | null | undefined> {
  return withFold(kernel, session, (state) => {
    const path = pathOf(state.commits, tip.id);

    const index = path.findIndex((id) => {
      const body = state.commits.get(id)?.body;

      return body?.kind === "user" && body.message === target;
    });

    return index < 0 ? undefined : (path[index - 1] ?? null);
  });
}

async function gate(
  sending: Sending,
  message: MessageId,
  submission: Submission,
): Promise<Submission> {
  const decision = await sending.kernel.admit(submission, {
    session: sending.session,
    head: sending.head,
    principal: sending.context.principal,
    run: sending.context.origin?.run ?? null,
    message,
  });

  switch (decision.action) {
    case "continue":
      return submission;
    case "modify":
      return decision.value;
    case "reject":
      dev("admission", "refused", { session: sending.session, message });

      throw new SdkError("invalid", decision.reason);
    case "error":
      throw new SdkError("internal", decision.message);
  }
}

async function resolve(
  sending: Sending,
  patch: Configuration | ConfigurationPatch | null,
): Promise<Configuration> {
  const result = await sending.kernel.resolveConfiguration({
    session: sending.session,
    head: sending.head,
    selected: sending.selected,
    patch,
    contributions: contributionsOf(sending.kernel.pluginsFor(sending.session)),
  });

  if (result.kind === "exact") return result;

  throw new SdkError("invalid", `The configuration is ${result.kind}.`, {
    issues: result.kind === "invalid" ? result.issues : [],
  });
}

async function scheduleOf(
  delivery: Delivery,
  configuration: Configuration,
  run: RunRecord | null,
): Promise<Schedule> {
  if (delivery === "attach") return { kind: "attached" };

  if (run === null) return { kind: "next-turn", reason: "idle" };

  if (delivery === "queue" || run.stopping) return { kind: "next-turn", reason: "run-ended" };

  if ((await objectId(configuration)) !== (await objectId(run.view.configuration)))
    return { kind: "next-turn", reason: "configuration" };

  return { kind: "joined", run: run.view.id };
}

async function admitted(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  inbox: Inbox,
  messages: readonly MessageId[],
  message: MessageRecord,
): Promise<RefUpdate> {
  await kernel.store.objects.put(envelope("message", message, message.at));
  const input = message.source.kind === "user" && message.delivery !== "attach";

  const pendingInput = [
    ...inbox.pendingInput.filter((id) => id !== message.id),
    ...(input ? [message.id] : []),
  ];

  return {
    name: inboxRef(session, head),
    target: await put(kernel, "inbox", { messages, pendingInput }),
    expect: expectOf(inbox.ref),
    event: {
      head,
      kind: "input",
      message: message.id,
      change: "admitted",
      content: message.content,
      source: message.source,
      delivery: message.delivery,
      schedule: message.schedule,
      covered: message.covered,
      configuration: message.configuration,
      replaced: message.replaced,
    },
  };
}

async function pendingReceipt(
  kernel: Kernel,
  session: SessionId,
  id: ReceiptId,
  digest: string,
  expect: RefUpdate["expect"],
): Promise<RefUpdate> {
  return {
    name: receiptRef(session, id),
    target: await put(kernel, "receipt", { id, kind: "send", digest, outcome: null }),
    expect,
  };
}

function digestOf(sending: Sending): Promise<string> {
  const { options } = sending;

  return objectId({
    head: sending.head,
    content: sending.content,
    delivery: options.delivery ?? null,
    replace: options.replace ?? null,
    running: options.running ?? null,
    abandoned: options.abandoned ?? null,
    expect: options.expect ?? null,
    position: options.position ?? null,
    source: options.source ?? null,
    configuration: options.configuration ?? null,
  });
}

function placeOf(
  position: SendOptions["position"],
  rest: readonly MessageId[],
  current: number,
): number {
  if (position === undefined) return Math.min(current, rest.length);

  if (position.kind === "last") return rest.length;
  const before = rest.indexOf(position.message);

  return before < 0 ? Math.min(current, rest.length) : before;
}
