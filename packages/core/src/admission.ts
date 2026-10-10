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
  RunId,
  Schedule,
  SendOptions,
  SessionId,
  Submission,
  UserContent,
} from "@nyte-ai/schema";
import { objectId } from "./content.ts";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import type { ConnectionContext } from "./principals.ts";
import type { SendReceipt } from "./receipt.ts";
import { summarize, summaryUpdates } from "./branch-summary.ts";
import { sendReceipt, settleReceipt } from "./receipts.ts";
import { envelope } from "./records.ts";
import type { CommitRecord, MessageRecord, RunRecord } from "./records.ts";
import { headRef, inboxRef, receiptRef } from "./refs.ts";
import { fenceUpdates, stopRun } from "./runs.ts";
import {
  STALE,
  attempt,
  commit,
  expectOf,
  guardHead,
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
  staleHead,
  withFold,
  writeReceipt,
} from "./session-state.ts";
import type { Inbox, Tip } from "./session-state.ts";

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

const USER: MessageSource = { kind: "user" };

/** Admits user content to a head for a connection and returns its receipt: replays a known id, runs `before_send` with the context's principal and origin run, resolves the configuration, schedules, and publishes `input admitted` in one set, then wakes the head's `untilInput` waits when the user sent it; a `replace` revises a pending input in place or edits a landed one (stop, move, admit) in one set. */
export async function send(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly context: ConnectionContext;
    readonly content: UserContent;
    readonly options?: SendOptions;
  },
): Promise<SendReceipt> {
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
  const inbox = await readInbox(kernel, input.session, input.head);

  return inbox.messages.includes(target) ? revise(sending, target) : edit(sending, target);
}

/** Lands admitted inputs on a head into a run, or none: writes their user commits, advances the head, drops them from the inbox, and publishes `input landed` then `commit` per input in one set; returns the commits in `ids` order. */
export async function landing(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  ids: readonly MessageId[],
  run: RunId | null,
): Promise<readonly CommitId[]> {
  const landed = await attempt(`Landing on ${head}`, async () => {
    const [tip, inbox] = await Promise.all([
      readTip(kernel, session, head),
      readInbox(kernel, session, head),
    ]);

    const due = inbox.messages.filter((message) => ids.includes(message));

    if (due.length === 0) return [];

    const { inputs, siblings } = await withFold(kernel, session, (state) => ({
      inputs: due.map((message) => state.inputs.get(message)),
      siblings: state.siblings.get(tip.id) ?? [],
    }));

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

    const remaining = await put(kernel, "inbox", {
      messages: inbox.messages.filter((message) => !due.includes(message)),
    });

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

    return (await commit(kernel, updates)).kind === "set"
      ? due.map((message, index) => ({ message, commit: records[index].id }))
      : STALE;
  });

  if (run !== null && landed.length > 0)
    landedIn(kernel).set(run, [
      ...(landedIn(kernel).get(run) ?? []),
      ...landed.map((entry) => entry.message),
    ]);

  return ids.flatMap((id) => landed.find((entry) => entry.message === id)?.commit ?? []);
}

async function admit(sending: Sending): Promise<SendReceipt> {
  const { kernel, session, head, options } = sending;
  const id = options.id ?? asId<"receipt">(crypto.randomUUID());
  const digest = await digestOf(sending);
  const replayed = await replay(kernel, session, id, digest);

  if (replayed !== null) return replayed;

  const submission = await gate(sending, {
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
      return outcome.name === receiptRef(session, id)
        ? ((await replay(kernel, session, id, digest)) ?? STALE)
        : STALE;

    if (run === null && message.delivery !== "attach" && covered)
      kernel.wakes.notify(session, head);

    if (message.source.kind === "user") await kernel.waits.inputAdmitted(session, head, message.id);

    return sendReceipt(kernel, session, id);
  });
}

async function revise(sending: Sending, target: MessageId): Promise<SendReceipt> {
  const { kernel, session, head, options } = sending;
  const id = asId<"receipt">(target);
  const digest = await digestOf(sending);

  if ((await readReceipt(kernel, session, id))?.record.digest === digest)
    return sendReceipt(kernel, session, id);
  const previous = await withFold(kernel, session, (state) => state.inputs.get(target));

  const submission = await gate(sending, {
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

  return attempt(`Revising ${target}`, async () => {
    const [inbox, run, receipt] = await Promise.all([
      readInbox(kernel, session, head),
      liveRun(kernel, session, head),
      readReceipt(kernel, session, id),
    ]);

    const current = inbox.messages.indexOf(target);

    if (current < 0) throw new SdkError("stale", `Message ${target} landed before it was revised.`);
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
        ...(await pendingReceipt(kernel, session, id, digest, expectOf(receipt?.ref ?? null))),
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

    if (outcome.kind === "stale") return STALE;

    if (run === null && message.delivery !== "attach" && covered)
      kernel.wakes.notify(session, head);

    return sendReceipt(kernel, session, id);
  });
}

async function edit(sending: Sending, target: MessageId): Promise<SendReceipt> {
  const { kernel, session, head, options } = sending;
  const id = options.id ?? asId<"receipt">(crypto.randomUUID());
  const digest = await digestOf(sending);
  const replayed = await replay(kernel, session, id, digest);

  if (replayed !== null) return replayed;
  const previous = await withFold(kernel, session, (state) => state.inputs.get(target));

  const submission = await gate(sending, {
    content: sending.content,
    source: options.source ?? USER,
    delivery: options.delivery ?? "steer",
    configuration: options.configuration ?? previous?.configuration ?? null,
    replace: target,
  });

  const configuration = await resolve(sending, submission.configuration);
  const checked = await guardHead(kernel, session, head, options.expect, options.running ?? "stop");
  const located = "kind" in checked ? checked : await locate(kernel, session, checked.tip, target);

  if ("kind" in located) {
    await writeReceipt(kernel, session, { id, kind: "send", digest, outcome: located });

    return sendReceipt(kernel, session, id);
  }

  const run = "kind" in checked ? null : checked.run;
  const covered = await isCovered(kernel, session);

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

  const abandoned = options.abandoned;

  if (typeof abandoned === "object") {
    const stopped =
      run !== null && (await stopRun(kernel, session, run)).kind === "requested" ? run : null;

    await writeReceipt(kernel, session, { id, kind: "send", digest, outcome: null });

    void summarizedEdit(kernel, {
      id,
      session,
      head,
      parent: located.parent,
      instructions: abandoned.summarize.instructions ?? null,
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

    return sendReceipt(kernel, session, id);
  }

  const edited = await attempt(`Editing ${target}`, async () => {
    const fence = run === null ? null : await fenceUpdates(kernel, session, run);
    const stopped = fence === null ? null : run;

    const [tip, inbox] = await Promise.all([
      readTip(kernel, session, head),
      readInbox(kernel, session, head),
    ]);

    const record = message(stopped, inbox.messages.length);

    const outcome = await commit(kernel, [
      ...(fence?.updates ?? []),
      {
        name: headRef(session, head),
        target: located.parent === null ? null : objectOf(located.parent),
        expect: expectOf(tip.ref),
        event: { head, kind: "head", from: tip.id, to: located.parent, reason: "moved" },
      },
      await admitted(kernel, session, head, inbox, [...inbox.messages, record.id], record),
      await pendingReceipt(kernel, session, id, digest, "absent"),
    ]);

    if (outcome.kind === "set") return { receipt: sendReceipt(kernel, session, id), stopped };

    if (outcome.name !== receiptRef(session, id)) return STALE;
    const receipt = await replay(kernel, session, id, digest);

    return receipt === null ? STALE : { receipt, stopped: null };
  });

  if (edited.stopped !== null) {
    kernel.runs.markStopping(edited.stopped);
    kernel.runs.abort(edited.stopped);
  }

  wake(edited.stopped);

  return edited.receipt;
}

async function summarizedEdit(
  kernel: Kernel,
  input: {
    readonly id: ReceiptId;
    readonly session: SessionId;
    readonly head: HeadName;
    readonly parent: CommitId | null;
    readonly instructions: string | null;
    readonly message: (position: number) => MessageRecord;
  },
): Promise<boolean> {
  const { id, session, head } = input;
  const tip = await readTip(kernel, session, head);

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

  const inbox = await readInbox(kernel, session, head);
  const record = input.message(inbox.messages.length);

  const written = await summaryUpdates(kernel, {
    session,
    head,
    tip,
    landing: input.parent,
    abandoned,
    markdown: summary.markdown,
  });

  const outcome = await commit(kernel, [
    ...written.updates,
    await admitted(kernel, session, head, inbox, [...inbox.messages, record.id], record),
  ]);

  if (outcome.kind === "set") return true;
  await settleReceipt(kernel, session, id, await staleHead(kernel, session, head));

  return false;
}

async function locate(
  kernel: Kernel,
  session: SessionId,
  tip: Tip,
  target: MessageId,
): Promise<{ readonly kind: "missing-target" } | { readonly parent: CommitId | null }> {
  return withFold(kernel, session, (state) => {
    const path = pathOf(state.commits, tip.id);

    const index = path.findIndex((id) => {
      const body = state.commits.get(id)?.body;

      return body?.kind === "user" && body.message === target;
    });

    return index < 0 ? { kind: "missing-target" } : { parent: path[index - 1] ?? null };
  });
}

async function gate(sending: Sending, submission: Submission): Promise<Submission> {
  const decision = await sending.kernel.admit(submission, {
    session: sending.session,
    head: sending.head,
    principal: sending.context.principal,
    run: sending.context.origin?.run ?? null,
  });

  switch (decision.action) {
    case "continue":
      return submission;
    case "modify":
      return decision.value;
    case "reject":
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

  return {
    name: inboxRef(session, head),
    target: await put(kernel, "inbox", { messages }),
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

async function replay(
  kernel: Kernel,
  session: SessionId,
  id: ReceiptId,
  digest: string,
): Promise<SendReceipt | null> {
  const found = await readReceipt(kernel, session, id);

  if (found === null) return null;

  if (found.record.kind !== "send" || found.record.digest !== digest)
    throw new SdkError("invalid", `Receipt ${id} was used for another send.`);

  return sendReceipt(kernel, session, id);
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
