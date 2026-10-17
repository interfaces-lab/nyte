import { asId, SdkError } from "@nyte-ai/schema";
import type {
  CommitId,
  Configuration,
  ConfigurationPatch,
  Decision,
  Delivery,
  HeadName,
  MessageId,
  MessageSource,
  PrincipalId,
  ReceiptId,
  RefUpdate,
  RunId,
  RunView,
  Schedule,
  SendOptions,
  SessionId,
  Submission,
  UserContent,
} from "@nyte-ai/schema";
import type { FoldInput, FoldState } from "../contract/fold.ts";
import type { ConnectionContext } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import type { CommitRecord } from "../contract/records.ts";
import type { SendReceipt } from "../contract/session.ts";
import { commit } from "../fold/commit.ts";
import { withFold } from "../fold/reads.ts";
import { callRef, headRef, inboxRef, receiptRef } from "../store/refs.ts";
import {
  attempt,
  guard,
  inboxWithout,
  coveredHere,
  liveRun,
  MAIN,
  put,
  readCall,
  readInbox,
  readReceipt,
  readRefExpectation,
  readTip,
  requireSession,
  STALE,
  toCommitObjectId,
  walkCommitPath,
} from "../store/session.ts";
import type { Inbox, MoveFailure, Tip } from "../store/session.ts";
import { objectId } from "../util/content.ts";
import { dev } from "../util/dev-log.ts";
import { holdSummary, summarizedMove } from "./branch-summary.ts";
import { collectContributions, refusalError } from "./contributions.ts";
import { fence, finishFence } from "./fence.ts";
import { freezeMentions } from "./mentions.ts";
import { known, reserve, sendReceipt, settleReceipt } from "./receipts.ts";
import { chooseSendSchedule, landed } from "./send-schedule.ts";
import { followTrace, traced } from "../util/trace.ts";
import type { StoreConnection } from "../contract/store.ts";

interface Sending {
  readonly kernel: Kernel;
  readonly session: SessionId;
  readonly head: HeadName;
  readonly context: ConnectionContext;
  readonly content: UserContent;
  readonly options: SendOptions;
  /** Aborts a before_send decision still pending, besides the kernel closing. */
  readonly stop: AbortSignal | null;
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

const USER: MessageSource = { kind: "user" };

interface Keyed {
  readonly id: ReceiptId;
  readonly digest: string;
}

export async function send(kernel: Kernel, input: SendInput): Promise<SendReceipt> {
  const id = input.options?.id ?? asId<"receipt">(crypto.randomUUID());
  followTrace(input.session, id);

  return traced("host.admit", id, { session: input.session }, async () => {
    await kernel.plugins.runtime(input.session).ready;

    return sendNow(kernel, { ...input, options: { ...input.options, id } });
  });
}

export async function sendNow(kernel: Kernel, input: SendInput): Promise<SendReceipt> {
  const found = await requireSession(kernel.store, input.session);
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
    stop: null,
  };

  const target = sending.options.replace;

  if (target === undefined) return admit(sending);

  if (
    (await withFold(kernel, input.session, (state) => state.inputs.get(target)))?.schedule.kind ===
    "deciding"
  )
    throw new SdkError("invalid", `Message ${target} is still being decided.`);

  const keyed = {
    id: sending.options.id ?? asId<"receipt">(crypto.randomUUID()),
    digest: await hashSendRequest(sending),
  };

  const replayed = await readReplayReceipt(kernel, input.session, keyed);

  if (replayed !== null) return replayed;
  const inbox = await readInbox(kernel.store, input.session, input.head);

  return inbox.messages.includes(target)
    ? revise(sending, target, keyed)
    : edit(sending, target, keyed);
}

export function selectRunStart(
  state: FoldState,
  head: HeadName,
  inputs: readonly FoldInput[],
): { readonly origin: RunView["origin"]; readonly input: FoldInput } | null {
  if (inputs.some((input) => input.schedule.kind === "deciding")) return null;
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
  start: readonly RefUpdate[] | null = null,
): Promise<readonly MessageId[]> {
  const landed = await attempt(`Landing on ${head}`, async () => {
    const [tip, inbox] = await Promise.all([
      readTip(kernel.store, session, head),
      readInbox(kernel.store, session, head),
    ]);

    const due = inbox.messages.filter((message) => ids.includes(message));

    if (due.length === 0) return [];

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

      records.push({ id: asId<"commit">(await put(kernel.store, "commit", record, at)), record });
    }

    const remaining = await put(kernel.store, "inbox", inboxWithout(inbox, due));

    const updates = records.flatMap(({ id, record }, index): readonly RefUpdate[] => [
      {
        name: inboxRef(session, head),
        target: remaining,
        expect: index === 0 ? readRefExpectation(inbox.ref) : undefined,
        events: [
          {
            head,
            kind: "input",
            message: due[index],
            change: "landed",
            commit: id,
            run,
          },
        ],
      },
      {
        name: headRef(session, head),
        target: toCommitObjectId(id),
        expect: index === 0 ? readRefExpectation(tip.ref) : undefined,
        events: [
          {
            head,
            kind: "commit",
            id,
            parent: record.parent,
            run,
            body: record.body,
          },
        ],
      },
    ]);

    const outcome = await commit(
      kernel,
      [...(start ?? []), ...updates],
      start === null && run !== null ? { session, run } : null,
    );

    return outcome.kind === "set" ? due : outcome.kind === "fenced" ? [] : STALE;
  });

  return landed;
}

async function admit(sending: Sending): Promise<SendReceipt> {
  const { kernel, session, head, options } = sending;
  const id = options.id ?? asId<"receipt">(crypto.randomUUID());
  const digest = await hashSendRequest(sending);

  if (await known(kernel.store, session, id, "send", digest))
    return sendReceipt(kernel, session, id);
  dev("admission", "send", { session, head, receipt: id });

  const submission = await gate(sending, asId<"message">(id), {
    content: sending.content,
    source: options.source ?? USER,
    delivery: options.delivery ?? "steer",
    configuration: options.configuration ?? null,
    replace: null,
  });

  const covered = await coveredHere(kernel, session);

  return attempt(`Admitting ${id}`, async () => {
    const [inbox, run, configuration] = await Promise.all([
      readInbox(kernel.store, session, head),
      liveRun(kernel.store, session, head),
      resolve(sending, submission.configuration),
    ]);

    const landing = landed(kernel, submission, run?.record ?? null);

    const message = buildMessage(asId<"message">(id), landing, {
      schedule: await chooseSendSchedule(landing.delivery, configuration, run?.record ?? null),
      covered,
      configuration,
      replaced: null,
      position: inbox.messages.length,
    });

    const outcome = await commit(kernel, [
      await admitted(kernel.store, session, head, inbox, [...inbox.messages, message.id], message),
      await pendingReceipt(kernel.store, session, id, digest, "absent"),
    ]);

    if (outcome.kind === "stale")
      return outcome.name === receiptRef(session, id) &&
        (await known(kernel.store, session, id, "send", digest))
        ? sendReceipt(kernel, session, id)
        : STALE;

    await announce(kernel, session, head, message);
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

  const covered = await coveredHere(kernel, session);

  const revised = await attempt(`Revising ${target}`, async () => {
    const [inbox, run, configuration] = await Promise.all([
      readInbox(kernel.store, session, head),
      liveRun(kernel.store, session, head),
      configured(),
    ]);

    const current = inbox.messages.findIndex((message) => message === target);

    if (current < 0) return null;
    const rest = inbox.messages.filter((message) => message !== target);
    const position = findInsertionIndex(options.position, rest, current);

    const landing = landed(kernel, submission, run?.record ?? null);

    const message = buildMessage(target, landing, {
      schedule: await chooseSendSchedule(landing.delivery, configuration, run?.record ?? null),
      covered,
      configuration,
      replaced: previous?.replaced ?? null,
      position,
    });

    const outcome = await commit(kernel, [
      await admitted(
        kernel.store,
        session,
        head,
        inbox,
        [...rest.slice(0, position), target, ...rest.slice(position)],
        message,
      ),
      {
        name: receiptRef(session, id),
        target: await put(kernel.store, "receipt", {
          id: asId<"receipt">(target),
          kind: "send",
          digest,
          outcome: null,
        }),
        expect: "absent",
        events: [
          {
            head,
            kind: "input",
            message: target,
            change: "scheduled",
            schedule: message.schedule,
            position,
          },
        ],
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
  const covered = await coveredHere(kernel, session);
  const abandoned = options.abandoned;
  const running = options.running ?? "stop";

  const message = async (stopped: RunId | null, position: number): Promise<MessageRecord> =>
    buildMessage(asId<"message">(id), submission, {
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
    const checked = await guard(kernel.store, session, head, options.expect, running);

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
        events: [{ head, kind: "head", from: checked.tip.id, to: parent, reason: "moved" }],
      },
      await admitted(
        kernel.store,
        session,
        head,
        checked.inbox,
        [...checked.inbox.messages, record.id],
        record,
      ),
      await pendingReceipt(kernel.store, session, id, digest, "absent"),
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
            await admitted(
              kernel.store,
              session,
              head,
              inbox,
              [...inbox.messages, record.id],
              record,
            ),
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

          if (summarized.stopped !== null) await finishFence(kernel, session, summarized.stopped);
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
      if (edited.stopped !== null) await finishFence(kernel, session, edited.stopped);
      wake(edited.stopped);
  }

  return sendReceipt(kernel, session, id);
}

/** The updates that store a starting chat's first message on main, deciding until its before_send hooks decide it, with its pending receipt under the chat's id. The receipt keeps `principal`, the one the hooks decide for. */
export async function admitDeciding(
  kernel: Kernel,
  session: SessionId,
  first: {
    readonly content: UserContent;
    readonly configuration: Configuration;
    readonly covered: boolean;
    readonly at: number;
    readonly digest: string;
    readonly principal: PrincipalId;
  },
): Promise<readonly RefUpdate[]> {
  const id = asId<"receipt">(session);

  const message: MessageRecord = {
    id: asId<"message">(session),
    at: first.at,
    content: first.content,
    source: USER,
    delivery: "steer",
    schedule: { kind: "deciding" },
    covered: first.covered,
    configuration: first.configuration,
    replaced: null,
    position: 0,
  };

  return [
    await admitted(
      kernel.store,
      session,
      MAIN,
      await readInbox(kernel.store, session, MAIN),
      [message.id],
      message,
    ),
    {
      name: receiptRef(session, id),
      target: await put(kernel.store, "receipt", {
        id,
        kind: "send",
        digest: first.digest,
        outcome: null,
        principal: first.principal,
      }),
      expect: "absent",
    },
  ];
}

/** Decides a starting chat's first message through its before_send hooks as `context`, then admits it again in place with the decided content, configuration and schedule, under the receipt it has. Resolves the message, or null once it left the inbox; the kernel closing, `stop` or a refusal throws. */
export async function readmitDeciding(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  input: FoldInput,
  stop: AbortSignal,
): Promise<MessageId | null> {
  const sending: Sending = {
    kernel,
    session,
    head: MAIN,
    context,
    content: input.content,
    options: {},
    stop,
  };

  const submission = await gate(sending, input.id, {
    content: input.content,
    source: input.source,
    delivery: input.delivery,
    configuration: null,
    replace: null,
  });

  const covered = await coveredHere(kernel, session);

  return attempt(`Starting ${session}`, async () => {
    const [inbox, configuration, deciding] = await Promise.all([
      readInbox(kernel.store, session, MAIN),
      resolve(sending, submission.configuration),
      withFold(
        kernel,
        session,
        (state) => state.inputs.get(input.id)?.schedule.kind === "deciding",
      ),
    ]);

    const position = inbox.messages.findIndex((message) => message === input.id);

    if (position < 0) return null;

    if (!deciding) return input.id;

    const message = buildMessage(input.id, submission, {
      schedule: await chooseSendSchedule(submission.delivery, configuration, null),
      covered,
      configuration,
      replaced: null,
      position,
    });

    const outcome = await commit(kernel, [
      await admitted(kernel.store, session, MAIN, inbox, inbox.messages, message),
    ]);

    if (outcome.kind === "stale") return STALE;
    await announce(kernel, session, MAIN, message);
    dev("admission", "started", { session, message: message.id, covered });

    return message.id;
  });
}

function buildMessage(
  id: MessageId,
  submission: Submission,
  placed: Omit<MessageRecord, "id" | "at" | "content" | "source" | "delivery">,
): MessageRecord {
  return {
    id,
    at: Date.now(),
    content: submission.content,
    source: submission.source,
    delivery: submission.delivery,
    ...placed,
  };
}

/** Tells this process an admitted message is in: a covered head wakes, and a wait on the user's input hears it. */
async function announce(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  message: MessageRecord,
): Promise<void> {
  if (message.covered) kernel.wakes.notify(session, head);

  if (message.source.kind === "user") await kernel.waits.inputAdmitted(session, head, message.id);
}

async function readReplayReceipt(
  kernel: Kernel,
  session: SessionId,
  { id, digest }: Keyed,
): Promise<SendReceipt | null> {
  const found = await readReceipt(kernel.store, session, id);

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
  const decision = await decideBeforeSend(sending, message, submission);

  if (decision.action === "reject") {
    dev("admission", "refused", { session: sending.session, message });

    throw new SdkError("invalid", decision.reason);
  }

  if (decision.action === "error") throw new SdkError("internal", decision.message);
  const admitted = decision.action === "modify" ? decision.value : submission;

  return {
    ...admitted,
    content: await freezeMentions(sending.kernel, sending.session, admitted.content),
  };
}

/** Decides the submission through the session's `before_send` hooks, one durable step keyed by the message; a parked hook holds the send until its wait wakes, and the kernel closing or the send's stop throws. */
async function decideBeforeSend(
  sending: Sending,
  message: MessageId,
  submission: Submission,
): Promise<Decision<Submission>> {
  const { kernel, session } = sending;
  const call = asId<"call">(`hook:before_send:${message}`);

  if (submission.replace === message) {
    const found = await readCall(kernel.store, session, call);

    if (found !== null && found.record.result !== null)
      await commit(kernel, [
        { name: callRef(session, call), target: null, expect: found.ref.revision },
      ]);
  }

  const closing = kernel.executionState.closing.signal;
  const signal = sending.stop === null ? closing : AbortSignal.any([closing, sending.stop]);
  let woken = Promise.withResolvers<void>();
  const dispose = kernel.waits.onWoken(session, call, () => woken.resolve());
  const abort = (): void => woken.resolve();
  signal.addEventListener("abort", abort, { once: true });

  try {
    for (;;) {
      woken = Promise.withResolvers<void>();

      const outcome = await kernel.plugins
        .runtime(session)
        .hooks.decide(
          "before_send",
          submission,
          {
            session,
            head: sending.head,
            run: sending.context.origin?.run ?? null,
            principal: sending.context.principal,
          },
          { call, run: null, head: null, part: null, signal },
        )
        .catch((error: unknown) => {
          throw signal.aborted ? undecided(closing) : error;
        });

      if (outcome.kind === "done") return outcome.value;

      if (!signal.aborted) {
        if (outcome.kind === "interrupted") return { action: "continue" };
        await woken.promise;
      }

      if (signal.aborted) throw undecided(closing);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    dispose();
  }
}

function undecided(closing: AbortSignal): SdkError {
  return closing.aborted
    ? new SdkError("unavailable", "The kernel closed before before_send decided.")
    : new SdkError("invalid", "The send was stopped before before_send decided.");
}

async function resolve(
  sending: Sending,
  patch: Configuration | ConfigurationPatch | null,
): Promise<Configuration> {
  const found = await requireSession(sending.kernel.store, sending.session);

  const result = await sending.kernel.resolveConfiguration({
    session: sending.session,
    head: sending.head,
    selected: found.record.heads.find((entry) => entry.name === sending.head)?.selected ?? null,
    patch,
    contributions: collectContributions(sending.kernel.plugins.runtime(sending.session)),
  });

  if (result.kind === "exact") return result;

  throw refusalError(result);
}

async function admitted(
  store: StoreConnection,
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
    target: await put(store, "inbox", { messages, pendingInput }),
    expect: readRefExpectation(inbox.ref),
    events: [
      {
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
    ],
  };
}

async function pendingReceipt(
  store: StoreConnection,
  session: SessionId,
  id: ReceiptId,
  digest: string,
  expect: RefUpdate["expect"],
): Promise<RefUpdate> {
  return {
    name: receiptRef(session, id),
    target: await put(store, "receipt", { id, kind: "send", digest, outcome: null }),
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
  const before = rest.findIndex((message) => message === position.message);

  return before < 0 ? Math.min(current, rest.length) : before;
}
