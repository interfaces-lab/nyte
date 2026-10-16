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
  RunView,
  Schedule,
  SendOptions,
  SessionId,
  Submission,
  UserContent,
} from "@nyte-ai/schema";
import { holdSummary, summarizedMove } from "./branch-summary.ts";
import { collectContributions, refusalError } from "./models.ts";
import { objectId } from "./content.ts";
import { dev } from "./dev-log.ts";
import { SdkError } from "./error.ts";
import type { FoldInput, FoldState } from "./fold.ts";
import type { Kernel } from "./kernel.ts";
import type { ConnectionContext } from "./principals.ts";
import type { SendReceipt } from "./receipt.ts";
import { known, reserve, sendReceipt, settleReceipt } from "./receipt-handles.ts";
import type { CommitRecord, RunRecord } from "./records.ts";
import { headRef, inboxRef, receiptRef } from "./refs.ts";
import { abortHere, fence, unfenced } from "./runs.ts";
import {
  EMPTY_REVISION,
  STALE,
  attempt,
  commit,
  readRefExpectation,
  inboxWithout,
  isCovered,
  liveRun,
  toCommitObjectId,
  walkCommitPath,
  put,
  readInbox,
  readReceipt,
  readTip,
  requireSession,
  sameRevision,
  withFold,
} from "./session-state.ts";
import type { Inbox, MoveFailure, Tip } from "./session-state.ts";

interface Sending {
  readonly kernel: Kernel;
  readonly session: SessionId;
  readonly head: HeadName;
  readonly context: ConnectionContext;
  readonly content: UserContent;
  readonly options: SendOptions;
}

type SendInput = {
  readonly session: SessionId;
  readonly head: HeadName;
  readonly context: ConnectionContext;
  readonly content: UserContent;
  readonly options?: SendOptions;
};

interface MessageRecord {
  readonly id: MessageId;
  readonly at: number;
  readonly content: UserContent;
  readonly source: MessageSource;
  readonly delivery: Delivery;
  readonly schedule: Schedule;
  readonly covered: boolean;
  readonly configuration: Configuration;
  readonly replaced: { readonly previous: MessageId; readonly stopped: RunId | null } | null;
  readonly position: number;
}

interface Guarded {
  readonly tip: Tip;
  readonly inbox: Inbox;
  readonly run: RunId | null;
}

const USER: MessageSource = { kind: "user" };

interface Keyed {
  readonly id: ReceiptId;
  readonly digest: string;
}

export async function send(kernel: Kernel, input: SendInput): Promise<SendReceipt> {
  await kernel.pluginsFor(input.session).ready;

  return sendNow(kernel, input);
}

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
  };

  const target = sending.options.replace;

  if (target === undefined) return admit(sending);

  const keyed = {
    id: sending.options.id ?? asId<"receipt">(crypto.randomUUID()),
    digest: await hashSendRequest(sending),
  };

  const replayed = await readReplayReceipt(kernel, input.session, keyed);

  if (replayed !== null) return replayed;
  const inbox = await readInbox(kernel, input.session, input.head);

  return inbox.messages.includes(target)
    ? revise(sending, target, keyed)
    : edit(sending, target, keyed);
}

export function selectRunStart(
  state: FoldState,
  head: HeadName,
  inputs: readonly FoldInput[],
): { readonly origin: RunView["origin"]; readonly input: FoldInput } | null {
  const prompt = inputs.find((input) => input.delivery !== "attach");

  if (prompt !== undefined) return { origin: { kind: "input", message: prompt.id }, input: prompt };
  const execution = state.heads.get(head)?.info.execution;

  if (execution?.kind !== "idle" || execution.lastRun?.end.kind !== "completed") return null;

  const report = inputs
    .flatMap((input) =>
      input.source.kind === "child" || input.source.kind === "job"
        ? [{ origin: { kind: "continuation", from: input.source.kind } as const, input }]
        : [],
    )
    .at(0);

  return report ?? null;
}

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

    const { inputs, siblings, starts } = await withFold(kernel, session, (state) => ({
      inputs: due.map((message) => state.inputs.get(message)),
      siblings: state.siblings.get(tip.id) ?? [],
      starts:
        selectRunStart(
          state,
          head,
          due.flatMap((message) => state.inputs.get(message) ?? []),
        ) !== null,
    }));

    if (start !== null && !starts) return [];

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

      records.push({ id: asId<"commit">(await put(kernel, "commit", record, at)), record });
    }

    const remaining = await put(kernel, "inbox", inboxWithout(inbox, due));

    const updates = records.flatMap(({ id, record }, index): readonly RefUpdate[] => [
      {
        name: inboxRef(session, head),
        target: remaining,
        expect: index === 0 ? readRefExpectation(inbox.ref) : undefined,
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
        target: toCommitObjectId(id),
        expect: index === 0 ? readRefExpectation(tip.ref) : undefined,
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
      ? due
      : STALE;
  });

  return landed;
}

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
  const digest = await hashSendRequest(sending);

  if (await known(kernel, session, id, "send", digest)) return sendReceipt(kernel, session, id);
  dev("admission", "send", { session, head, receipt: id });

  const submission = await gate(sending, asId<"message">(id), {
    content: sending.content,
    source: options.source ?? USER,
    delivery: options.delivery ?? "steer",
    configuration: options.configuration ?? null,
    replace: null,
  });

  const covered = await isCovered(kernel, session);

  return attempt(`Admitting ${id}`, async () => {
    const [inbox, run, configuration] = await Promise.all([
      readInbox(kernel, session, head),
      liveRun(kernel, session, head),
      resolve(sending, submission.configuration),
    ]);

    const message: MessageRecord = {
      id: asId<"message">(id),
      at: Date.now(),
      content: submission.content,
      source: submission.source,
      delivery: submission.delivery,
      schedule: await chooseSendSchedule(submission.delivery, configuration, run?.record ?? null),
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

    if (covered) kernel.wakes.notify(session, head);

    if (message.source.kind === "user")
      await kernel.waits.inputAdmitted(session, head, message.id, run?.record.parked ?? []);
    dev("admission", "admitted", { session, head, message: message.id, covered });

    return sendReceipt(kernel, session, id);
  });
}

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

  const configured = async (): Promise<Configuration> =>
    submission.configuration === null && previous !== undefined
      ? previous.configuration
      : resolve(sending, submission.configuration);

  const covered = await isCovered(kernel, session);

  const revised = await attempt(`Revising ${target}`, async () => {
    const [inbox, run, configuration] = await Promise.all([
      readInbox(kernel, session, head),
      liveRun(kernel, session, head),
      configured(),
    ]);

    const current = inbox.messages.indexOf(target);

    if (current < 0) return null;
    const rest = inbox.messages.filter((message) => message !== target);
    const position = findInsertionIndex(options.position, rest, current);

    const message: MessageRecord = {
      id: target,
      at: Date.now(),
      content: submission.content,
      source: submission.source,
      delivery: submission.delivery,
      schedule: await chooseSendSchedule(submission.delivery, configuration, run?.record ?? null),
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
        ? ((await readReplayReceipt(kernel, session, keyed)) ?? STALE)
        : STALE;

    if (covered) kernel.wakes.notify(session, head);
    dev("admission", "revised", { session, head, message: target });

    return sendReceipt(kernel, session, asId<"receipt">(target));
  });

  return revised ?? editGated(sending, target, { id, digest, submission, configured });
}

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

  return editGated(sending, target, {
    id,
    digest,
    submission,
    configured: () => resolve(sending, submission.configuration),
  });
}

async function editGated(
  sending: Sending,
  target: MessageId,
  gated: Keyed & {
    readonly submission: Submission;
    readonly configured: () => Promise<Configuration>;
  },
): Promise<SendReceipt> {
  const { kernel, session, head, options } = sending;
  const { id, digest, submission, configured } = gated;
  const covered = await isCovered(kernel, session);
  const abandoned = options.abandoned;
  const running = options.running ?? "stop";

  const message = async (stopped: RunId | null, position: number): Promise<MessageRecord> => ({
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
    configuration: await configured(),
    replaced: { previous: target, stopped },
    position,
  });

  const wake = (stopped: RunId | null): void => {
    if (stopped !== null || covered) kernel.wakes.notify(session, head);
  };

  const edited = await attempt<
    | { readonly kind: "failed"; readonly outcome: MoveFailure }
    | {
        readonly kind: "summarize";
        readonly tip: Tip;
        readonly parent: CommitId | null;
        readonly instructions: string | null;
      }
    | { readonly kind: "edited"; readonly stopped: RunId | null }
    | { readonly kind: "replayed"; readonly receipt: SendReceipt }
  >(`Editing ${target}`, async () => {
    const checked = await guard(kernel, session, head, options.expect, running);

    if ("kind" in checked) return { kind: "failed", outcome: checked };
    const parent = await locate(kernel, session, checked.tip, target);

    if (parent === undefined) return { kind: "failed", outcome: { kind: "missing-target" } };

    if (typeof abandoned === "object")
      return {
        kind: "summarize",
        tip: checked.tip,
        parent,
        instructions: abandoned.summarize.instructions ?? null,
      };
    const fenced = checked.run === null ? null : await fence(kernel, session, checked.run);
    const stopped = fenced === null || fenced.kind === "ended" ? null : checked.run;
    const record = await message(stopped, checked.inbox.messages.length);

    const outcome = await commit(kernel, [
      ...(fenced?.kind === "live" ? fenced.updates : []),
      {
        name: headRef(session, head),
        target: parent === null ? null : toCommitObjectId(parent),
        expect: readRefExpectation(checked.tip.ref),
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
      outcome.name === receiptRef(session, id)
        ? await readReplayReceipt(kernel, session, gated)
        : null;

    return replayed === null ? STALE : { kind: "replayed", receipt: replayed };
  });

  switch (edited.kind) {
    case "replayed":
      return edited.receipt;

    case "failed":
      if (!(await reserve(kernel, session, { id, kind: "send", digest, outcome: edited.outcome })))
        return (
          (await readReplayReceipt(kernel, session, gated)) ?? sendReceipt(kernel, session, id)
        );
      break;

    case "summarize": {
      const release = holdSummary(kernel, session, id);

      if (!(await reserve(kernel, session, { id, kind: "send", digest, outcome: null }))) {
        release();

        return (
          (await readReplayReceipt(kernel, session, gated)) ?? sendReceipt(kernel, session, id)
        );
      }

      void summarizedMove(kernel, {
        session,
        head,
        receipt: id,
        tip: edited.tip,
        landing: edited.parent,
        instructions: edited.instructions,
        running,
        updates: async ({ inbox, receipt, stopped }) => {
          const record = await message(stopped, inbox.messages.length);

          return [
            await admitted(kernel, session, head, inbox, [...inbox.messages, record.id], record),
            { name: receipt.ref.name, target: receipt.ref.target, expect: receipt.ref.revision },
          ];
        },
      })
        .then(async (summarized) => {
          if (summarized.kind === "failed")
            return settleReceipt(kernel, session, id, {
              kind: "send",
              outcome: summarized.outcome,
            });

          if (summarized.kind !== "moved") return;

          if (summarized.stopped !== null) abortHere(kernel, summarized.stopped);
          wake(summarized.stopped);
        })
        .catch(async (error: unknown) =>
          settleReceipt(kernel, session, id, {
            kind: "send",
            outcome: {
              kind: "summary-failed",
              reason: error instanceof Error ? error.message : String(error),
            },
          }),
        )
        .catch(() => undefined)
        .finally(release);
      break;
    }

    case "edited":
      if (edited.stopped !== null) abortHere(kernel, edited.stopped);
      wake(edited.stopped);
  }

  return sendReceipt(kernel, session, id);
}

async function readReplayReceipt(
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

async function locate(
  kernel: Kernel,
  session: SessionId,
  tip: Tip,
  target: MessageId,
): Promise<CommitId | null | undefined> {
  return withFold(kernel, session, (state) => {
    const path = walkCommitPath(state.commits, tip.id);

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
    signal: sending.kernel.executionState.closing.signal,
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
  const found = await requireSession(sending.kernel, sending.session);

  const result = await sending.kernel.resolveConfiguration({
    session: sending.session,
    head: sending.head,
    selected: found.record.heads.find((entry) => entry.name === sending.head)?.selected ?? null,
    patch,
    contributions: collectContributions(sending.kernel.pluginsFor(sending.session)),
  });

  if (result.kind === "exact") return result;

  throw refusalError(result);
}

async function chooseSendSchedule(
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
  const input = message.source.kind === "user" && message.delivery !== "attach";

  const pendingInput = [
    ...inbox.pendingInput.filter((id) => id !== message.id),
    ...(input ? [message.id] : []),
  ];

  return {
    name: inboxRef(session, head),
    target: await put(kernel, "inbox", { messages, pendingInput }),
    expect: readRefExpectation(inbox.ref),
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

function hashSendRequest(sending: Sending): Promise<string> {
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

function findInsertionIndex(
  position: SendOptions["position"],
  rest: readonly MessageId[],
  current: number,
): number {
  if (position === undefined) return Math.min(current, rest.length);

  if (position.kind === "last") return rest.length;
  const before = rest.indexOf(position.message);

  return before < 0 ? Math.min(current, rest.length) : before;
}
