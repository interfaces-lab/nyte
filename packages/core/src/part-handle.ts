import { asId, isJson } from "@nyte-ai/schema";
import type {
  CallId,
  Json,
  PartId,
  Placement,
  RefUpdate,
  Schema,
  SessionId,
  ValidationIssue,
} from "@nyte-ai/schema";
import { objectId } from "./content.ts";
import { openAction, recordAcquisition, reserveRerun } from "./durable.ts";
import type { ActionIntent } from "./durable.ts";
import { SdkError } from "./error.ts";
import { check } from "./json-schema.ts";
import type { Checked } from "./json-schema.ts";
import type { Kernel } from "./kernel.ts";
import type { RegisteredDefinition } from "./part-definitions.ts";
import { release, settle, storedAnswer } from "./parts.ts";
import type {
  ActionContext,
  ActionSchemas,
  Answered,
  Part,
  PartActions,
  PartDefinition,
  PartState,
} from "./parts.ts";
import { PARTICIPANT_AUTHORITY } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { decodePartRecord, isJsonObject } from "./records.ts";
import type { CommitRecord, PartRecord } from "./records.ts";
import { headRef, partRef } from "./refs.ts";
import { unfenced } from "./runs.ts";
import {
  MAIN,
  STALE,
  attempt,
  commit,
  expectOf,
  load,
  objectOf,
  put,
  putCommit,
  readCall,
  readTip,
  requireSession,
} from "./session-state.ts";

/** Returns what an action handler ended with: its return value, what it threw, or the part closing first. */
type Performed =
  | { readonly kind: "returned"; readonly output: unknown }
  | { readonly kind: "threw"; readonly error: unknown }
  | { readonly kind: "closed" };

/** Returns what `answer()` resolves with on a handle typed by `K`, short of null. */
type Answer<K extends PartDefinition> = NonNullable<Awaited<ReturnType<Part<K>["answer"]>>>;

/** Returns what `update` resolves with. */
type PartUpdateOutcome = Awaited<ReturnType<Part<PartDefinition>["update"]>>;

/** The session each handle this module bound acts in. */
const boundIn = new WeakMap<object, SessionId>();

/** Creates a part from a definition and returns its handle; an existing id with the same kind and state is a replay, any other is `invalid`. A transcript part lands as a commit, in the same set, on the head the creating step runs on, else main. Any other part a step creates belongs to the step's run, so the run's stop or failure fails it; one created while the run is stopping is never written. From a durable step the creation is an acquisition recorded on the step's call first, so a re-run returns the part it created. */
export async function createPart<K extends PartDefinition>(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  kind: K,
  input: { readonly state: unknown; readonly placement: Placement; readonly id?: PartId },
): Promise<Part<K>> {
  const origin = context.origin;
  const from = origin?.session === session ? origin : null;

  const step =
    origin === null || origin.call === null
      ? null
      : {
          session: origin.session,
          call: origin.call,
          key: input.id ?? `acq:${origin.sequence.next()}`,
        };

  const checked = await check(kind.state, input.state);

  if (checked.kind === "invalid")
    throw new SdkError("invalid", `The state fails ${kind.kind}'s schema.`, {
      issues: checked.issues,
    });
  const state = checked.value;

  if (!isJson(state)) throw new SdkError("invalid", `${kind.kind}'s state is not JSON.`);
  const registered = kernel.partDefinitions.get(kind.kind);

  if (registered === undefined && kind.onAction !== undefined)
    throw new SdkError("invalid", "a definition with onAction must be contributed");
  await requireSession(kernel, session);
  const minted = input.id ?? asId<"part">(crypto.randomUUID());

  const acquired = step === null ? minted : await recordAcquisition(kernel, step, step.key, minted);

  const id = typeof acquired === "string" ? asId<"part">(acquired) : minted;
  const transcript = input.placement.kind === "transcript";
  const run = transcript ? null : (from?.run ?? null);
  const owner = registered?.owner ?? null;
  const name = partRef(session, id);

  await attempt(`Creating part ${id}`, async () => {
    const existing = await load(kernel, await kernel.store.refs.get(name), decodePartRecord);

    if (existing !== null) {
      if (
        step !== null ||
        (existing.record.partKind === kind.kind &&
          (await objectId(existing.record.state)) === (await objectId(state)))
      )
        return;

      throw new SdkError("invalid", `Part ${id} already exists with another kind or state.`);
    }

    const at = Date.now();

    const created = {
      kind: "part",
      part: id,
      change: "created",
      partKind: kind.kind,
      placement: input.placement,
      state,
      version: 1,
      run,
      owner,
    } as const;

    if (!transcript) {
      const stored: PartRecord = {
        id,
        partKind: kind.kind,
        placement: input.placement,
        state,
        version: 1,
        owner,
        run,
        status: { kind: "live", run },
      };

      const held = run === null ? null : await unfenced(kernel, session, run);

      if (run !== null && held === null) return;

      const outcome = await commit(kernel, [
        ...(held === null ? [] : [held]),
        {
          name,
          target: await put(kernel, "part", stored, at),
          expect: "absent",
          event: { head: null, ...created },
        },
      ]);

      return outcome.kind === "set" ? undefined : STALE;
    }

    const head = from?.head ?? MAIN;
    const tip = await readTip(kernel, session, head);

    const record: CommitRecord = {
      parent: tip.id,
      at,
      run: null,
      body: { kind: "part", part: id },
    };

    const landed = await putCommit(kernel, record);

    const stored: PartRecord = {
      id,
      partKind: kind.kind,
      placement: input.placement,
      state,
      version: 1,
      owner,
      run: null,
      status: { kind: "settled", commit: landed, endedAt: at },
    };

    const target = await put(kernel, "part", stored, at);

    const updates: readonly RefUpdate[] = [
      { name, target, expect: "absent", event: { head, ...created } },
      {
        name,
        target,
        event: { head, kind: "part", part: id, change: "settled", commit: landed, endedAt: at },
      },
      {
        name: headRef(session, head),
        target: objectOf(landed),
        expect: expectOf(tip.ref),
        event: {
          head,
          kind: "commit",
          id: landed,
          parent: record.parent,
          run: null,
          body: record.body,
        },
      },
    ];

    return (await commit(kernel, updates)).kind === "set" ? undefined : STALE;
  });

  const table = kernel.partTable;
  table.closed.delete(name);
  table.created.set(name, kind);

  return partHandleFor(kernel, context, session, id, kind);
}

/** Returns a handle on a part by id, binding synchronously with no I/O. */
export function partHandle(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  id: PartId,
): Part<PartDefinition> {
  return partHandleFor<PartDefinition>(kernel, context, session, id, null);
}

/** Returns a handle on a part typed by `kind`, or untyped when it is null; the governing definition is the registered one, else `kind`, else the one that created the part here. */
function partHandleFor<K extends PartDefinition>(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  id: PartId,
  kind: K | null,
): Part<K> {
  const name = partRef(session, id);
  const table = kernel.partTable;

  const definitionOf = (partKind: string): PartDefinition | null =>
    kernel.partDefinitions.get(partKind)?.definition ?? kind ?? table.created.get(name) ?? null;

  const handle: Part<K> = {
    id,
    async update(next) {
      return attempt<PartUpdateOutcome>(`Updating part ${id}`, async () => {
        const found = table.closed.has(name)
          ? null
          : await load(kernel, await kernel.store.refs.get(name), decodePartRecord);

        if (found === null) return { kind: table.closed.has(name) ? "closed" : "missing" };
        const { ref, record } = found;
        const given = nextState(kind, next, record.state);

        if (given === null)
          return {
            kind: "invalid",
            issues: [issue(`Part ${id}'s stored state fails its schema.`)],
          };
        const definition = definitionOf(record.partKind);

        const checked: Checked<unknown> =
          definition === null
            ? { kind: "valid", value: given.value }
            : await check(definition.state, given.value);

        if (checked.kind === "invalid") return checked;
        const state = checked.value;

        if (!isJson(state)) return { kind: "invalid", issues: [issue("The state is not JSON.")] };
        const version = record.version + 1;

        const outcome = await commit(kernel, [
          {
            name,
            target: await put(kernel, "part", { ...record, state, version }),
            expect: ref.revision,
            event: { head: null, kind: "part", part: id, change: "updated", state, version },
          },
        ]);

        return outcome.kind === "set" ? { kind: "updated", version } : STALE;
      });
    },
    async act(action, input) {
      const found = table.closed.has(name)
        ? null
        : await load(kernel, await kernel.store.refs.get(name), decodePartRecord);

      if (found === null) {
        if (table.closed.has(name)) return { kind: "closed" };

        throw new SdkError("unknown", `No part has the id ${id}.`);
      }

      const record = found.record;
      const modal = record.placement.kind === "modal";

      if (modal && record.status.kind !== "live") return { kind: "closed" };
      const registered = kernel.partDefinitions.get(record.partKind);

      if (registered === undefined && record.owner !== null) return { kind: "no-owner" };
      const definition = definitionOf(record.partKind);
      const named = String(action);
      const accepted = await actInput(definition, named, input);

      if (accepted === null) return { kind: "unknown-action" };
      const handler = registered?.definition.onAction === undefined ? null : registered;
      const offered = { action: named, input: isJson(accepted.value) ? accepted.value : null };
      const call = asId<"call">(`act:${id}:${crypto.randomUUID()}`);

      if (handler !== null)
        await openAction(kernel, {
          session,
          part: id,
          call,
          intent: { part: id, ...offered, principal: context.principal },
        });

      const performed: Performed =
        handler === null
          ? { kind: "returned", output: undefined }
          : await perform(kernel, context, {
              session,
              record,
              registered: handler,
              action: named,
              input: accepted.value,
              call,
            });

      if (performed.kind === "closed") return performed;

      if (performed.kind === "threw")
        return performed.error instanceof SdkError && performed.error.code === "invalid"
          ? { kind: "rejected", reason: performed.error.message }
          : {
              kind: "failed",
              message:
                performed.error instanceof Error
                  ? performed.error.message
                  : String(performed.error),
            };
      const output = performed.output;

      if (!isOutputOf(kind, definition, action, output, handler !== null))
        return {
          kind: "failed",
          message: `${record.partKind}'s ${named} returned output its schema rejects.`,
        };

      if (modal && !(await answered(kernel, session, id, offered))) return { kind: "closed" };

      return { kind: "ok", output };
    },
    async answer() {
      const settled = await firstAnswer(kernel, session, name);

      return settled !== null && isAnswerOf(kind, settled) ? settled : null;
    },
    async close() {
      if (table.closed.has(name)) return;

      const closed = await attempt(`Closing part ${id}`, async () => {
        const found = await load(kernel, await kernel.store.refs.get(name), decodePartRecord);

        if (found === null) return null;

        const outcome = await commit(kernel, [
          {
            name,
            target: null,
            expect: found.ref.revision,
            event: { head: null, kind: "part", part: id, change: "closed" },
          },
        ]);

        return outcome.kind === "set" ? found.record.status : STALE;
      });

      if (closed === null) return;
      release(table, name);
      await kernel.waits.partClosed(
        session,
        id,
        closed.kind === "live" ? (closed.waiting ?? null) : null,
      );
    },
  };

  boundIn.set(handle, session);

  return handle;
}

/** Keeps an act's answer on a live modal part's status, its one home, unless the part holds one; offers the winner to the step the status names as waiting and to the waits here, then settles `answer()`. Resolves false when the part is no longer live. */
async function answered(
  kernel: Kernel,
  session: SessionId,
  id: PartId,
  answer: Answered,
): Promise<boolean> {
  const name = partRef(session, id);

  const kept = await attempt(`Answering part ${id}`, async () => {
    const found = await load(kernel, await kernel.store.refs.get(name), decodePartRecord);
    const status = found?.record.status;

    if (found === null || status?.kind !== "live") return null;

    if (status.answer !== undefined)
      return { winner: status.answer, waiting: status.waiting ?? null };

    const outcome = await commit(kernel, [
      {
        name,
        target: await put(kernel, "part", { ...found.record, status: { ...status, answer } }),
        expect: found.ref.revision,
      },
    ]);

    return outcome.kind === "set" ? { winner: answer, waiting: status.waiting ?? null } : STALE;
  });

  if (kept === null) return false;
  await kernel.waits.partAnswered(session, id, kept.winner, kept.waiting);
  settle(kernel.partTable, name, kept.winner);

  return true;
}

/** Runs a head-less action step again when a wake recorded its outcome and no act here waits on it, as after a restart; a modal part keeps the answer once it returns. */
export async function rerunAction(kernel: Kernel, session: SessionId, call: CallId): Promise<void> {
  const step = (await readCall(kernel, session, call))?.record;

  const intent =
    step?.kind === "action" && step.result === null ? decodeActionIntent(step.intent) : null;

  if (intent === null || !(await reserveRerun(kernel, session, call))) return;

  const found = await load(
    kernel,
    await kernel.store.refs.get(partRef(session, intent.part)),
    decodePartRecord,
  );

  const registered = found === null ? undefined : kernel.partDefinitions.get(found.record.partKind);

  if (found === null || registered?.definition.onAction === undefined) return;

  const context: ConnectionContext = {
    principal: intent.principal,
    authority: PARTICIPANT_AUTHORITY,
    credential: { kind: "token", token: "" },
    origin: null,
  };

  const performed = await perform(kernel, context, {
    session,
    record: found.record,
    registered,
    action: intent.action,
    input: intent.input,
    call,
  });

  if (performed.kind === "returned" && found.record.placement.kind === "modal")
    await answered(kernel, session, intent.part, { action: intent.action, input: intent.input });
}

/** Returns the session a part handle this module bound acts in, or undefined for any other object. */
export function sessionOfPart(part: object): SessionId | undefined {
  return boundIn.get(part);
}

/** Runs a registered definition's `onAction` as the durable step `call`; resolves closed as soon as the part closes, aborting the handler's signal. A parked step leaves the act pending; an interrupted one fails it. */
async function perform(
  kernel: Kernel,
  context: ConnectionContext,
  input: {
    readonly session: SessionId;
    readonly record: PartRecord;
    readonly registered: RegisteredDefinition;
    readonly action: string;
    readonly input: unknown;
    readonly call: CallId;
  },
): Promise<Performed> {
  const { session, record, registered } = input;
  const name = partRef(session, record.id);
  const table = kernel.partTable;

  if (table.closed.has(name)) return { kind: "closed" };
  const controller = new AbortController();
  const acting = table.acting.get(name) ?? new Set<AbortController>();
  acting.add(controller);
  table.acting.set(name, acting);

  const closed = new Promise<Performed>((resolve) =>
    controller.signal.addEventListener("abort", () => resolve({ kind: "closed" }), { once: true }),
  );

  const ran = kernel.durable
    .run({
      session,
      part: record.id,
      action: input.action,
      call: input.call,
      signal: controller.signal,
      async body(durable) {
        const actionContext: ActionContext<unknown, ActionSchemas> = {
          wait: (target) => durable.wait(target),
          memo: (key, compute) => durable.memo(key, compute),
          now: () => durable.now(),
          part: partHandle(kernel, context, session, record.id),
          get api() {
            return kernel.pluginApi(registered.owner ?? "core", session);
          },
          principal: context.principal,
          signal: controller.signal,
        };

        return registered.definition.onAction?.(input.action, input.input, actionContext);
      },
    })
    .then(
      (outcome): Performed | Promise<Performed> => {
        if (outcome.kind === "done") return { kind: "returned", output: outcome.value };

        if (outcome.kind === "interrupted")
          return {
            kind: "threw",
            error: new Error(
              `The ${input.action} action was interrupted and may have partially run.`,
            ),
          };

        return new Promise<Performed>(() => undefined);
      },
      (error: unknown): Performed => ({ kind: "threw", error }),
    );

  try {
    return await Promise.race([ran, closed]);
  } finally {
    acting.delete(controller);

    if (acting.size === 0 && table.acting.get(name) === acting) table.acting.delete(name);
  }
}

/** Returns a part's first answer as the store holds it, else waits for one; null once the part is gone or closes, or a modal part is no longer live. */
async function firstAnswer(
  kernel: Kernel,
  session: SessionId,
  name: string,
): Promise<Answered | null> {
  const table = kernel.partTable;
  const found = await load(kernel, await kernel.store.refs.get(name), decodePartRecord);

  if (
    found === null ||
    (found.record.placement.kind === "modal" && found.record.status.kind !== "live")
  ) {
    table.answered.delete(name);

    return null;
  }

  const stored = await storedAnswer(kernel, session, found.record);

  if (stored !== null) {
    settle(table, name, stored);

    return stored;
  }

  const settled = table.answered.get(name);

  if (settled !== undefined) return settled;

  if (table.closed.has(name)) return null;

  return new Promise((resolve) => {
    const waiting = table.waiters.get(name) ?? new Set();
    waiting.add(resolve);
    table.waiters.set(name, waiting);
  });
}

/** Returns the action intent a call record's `intent` holds, or null when it holds another shape. */
function decodeActionIntent(value: Json): ActionIntent | null {
  if (!isJsonObject(value)) return null;
  const { part, action, input, principal } = value;

  return typeof part === "string" &&
    typeof action === "string" &&
    input !== undefined &&
    typeof principal === "string"
    ? { part: asId<"part">(part), action, input, principal: asId<"principal">(principal) }
    : null;
}

/** Returns an act's input as the definition validates it for the action, or null when the definition has no such action; throws `invalid` with the issues. Without a definition the input passes as given. */
async function actInput(
  definition: PartDefinition | null,
  action: string,
  input: unknown,
): Promise<{ readonly value: unknown } | null> {
  if (definition === null) return { value: input };
  const spec = actionOf(definition, action);

  if (spec === undefined) return null;
  const checked = await check(spec.input, input);

  if (checked.kind === "invalid")
    throw new SdkError("invalid", `The input fails ${definition.kind}'s ${action} schema.`, {
      issues: checked.issues,
    });

  return { value: checked.value };
}

/** Returns a definition's action by name, or undefined when it has none by that name. */
function actionOf(
  definition: PartDefinition | null,
  action: string,
): ActionSchemas[string] | undefined {
  return definition !== null && Object.hasOwn(definition.actions, action)
    ? definition.actions[action]
    : undefined;
}

/** Returns the state an update gives: the value itself, or the derivation applied to the current state; null when the current state fails `kind`'s schema, so the derivation cannot read it. */
function nextState<K extends PartDefinition>(
  kind: K | null,
  next: PartState<K> | ((current: PartState<K>) => PartState<K>),
  current: Json,
): { readonly value: unknown } | null {
  if (!isDerivation(next)) return { value: next };

  return isStateOf(kind, current) ? { value: next(current) } : null;
}

/** Returns whether an update derives the state from the current one rather than giving it: states are JSON, never functions. */
function isDerivation<S>(next: S | ((current: S) => S)): next is (current: S) => S {
  return typeof next === "function";
}

/** Returns whether a state is `kind`'s: what its state schema accepts; any state on a handle bound without a definition, whose state type is unknown. */
function isStateOf<K extends PartDefinition>(
  kind: K | null,
  value: unknown,
): value is PartState<K> {
  return kind === null || accepts(kind.state, value);
}

/** Returns whether an answer is one of `kind`'s actions with an input its schema accepts; any answer on a handle bound without a definition. */
function isAnswerOf<K extends PartDefinition>(
  kind: K | null,
  answer: Answered,
): answer is Answered & Answer<K> {
  if (kind === null) return true;
  const spec = actionOf(kind, answer.action);

  return spec !== undefined && accepts(spec.input, answer.input);
}

/** Returns whether a value is what `act` answers for an action: undefined when no handler ran, else what the action's `output` schema accepts, or undefined when it declares none. */
function isOutputOf<K extends PartDefinition, A extends keyof PartActions<K>>(
  kind: K | null,
  definition: PartDefinition | null,
  action: A,
  value: unknown,
  handled: boolean,
): value is PartActions<K>[A]["output"] {
  const output = handled ? actionOf(kind ?? definition, String(action))?.output : undefined;

  return output === undefined ? value === undefined : accepts(output, value);
}

/** Returns whether a schema accepts a value synchronously: what the type guards rest on; a schema that validates asynchronously does not accept here. */
function accepts(schema: Schema<unknown>, value: unknown): boolean {
  const result = schema["~standard"].validate(value);

  return !(result instanceof Promise) && result.issues === undefined;
}

/** Returns an error issue at the root. */
function issue(message: string): ValidationIssue {
  return { severity: "error", path: [], message };
}
