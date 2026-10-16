import { asId, isJson, standard } from "@nyte-ai/schema";
import type {
  CallId,
  Json,
  PartId,
  Placement,
  RefUpdate,
  SessionId,
  ValidationIssue,
} from "@nyte-ai/schema";
import { CORE_CONTEXT, PARTICIPANT_AUTHORITY } from "../contract/host.ts";
import type { ConnectionContext } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import type {
  ActionContext,
  ActionSchemas,
  Answered,
  Part,
  PartActions,
  PartDefinition,
  PartState,
  RegisteredDefinition,
} from "../contract/parts.ts";
import { decodePartRecord } from "../contract/records.ts";
import type { CommitRecord, PartRecord } from "../contract/records.ts";
import { openAction, recordAcquisition, reserveRerun } from "../engine/durable.ts";
import type { ActionIntent } from "../engine/durable.ts";
import { unfenced } from "../engine/fence.ts";
import { RESERVED_PART_KINDS } from "../engine/part-definitions.ts";
import { commit } from "../fold/commit.ts";
import { release, settle, storedAnswer } from "../store/parts.ts";
import { headRef, partRef } from "../store/refs.ts";
import {
  attempt,
  load,
  MAIN,
  put,
  readCall,
  readRefExpectation,
  readTip,
  requireSession,
  STALE,
  toCommitObjectId,
} from "../store/session.ts";
import { objectId } from "../util/content.ts";
import { SdkError } from "../util/error.ts";
import { check, convertJsonSchema, isJsonObject, matchesOutput } from "../util/json-schema.ts";

type Performed =
  | { readonly kind: "returned"; readonly output: unknown }
  | { readonly kind: "threw"; readonly error: unknown }
  | { readonly kind: "closed" };

type Answer<K extends PartDefinition> = NonNullable<Awaited<ReturnType<Part<K>["answer"]>>>;

type PartUpdateOutcome = Awaited<ReturnType<Part<PartDefinition>["update"]>>;

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

  const registered = kernel.partDefinitions.get(kind.kind);

  if (registered !== undefined && registered.definition !== kind)
    throw new SdkError("invalid", `Another definition is registered for ${kind.kind}.`);
  for (const action of Object.values(kind.actions)) convertJsonSchema(action.input, "output");
  const checked = await check(registered?.definition.state ?? kind.state, input.state);

  if (checked.kind === "invalid")
    throw new SdkError("invalid", `The state fails ${kind.kind}'s schema.`, {
      issues: checked.issues,
    });
  const state = checked.value;

  if (!isJson(state)) throw new SdkError("invalid", `${kind.kind}'s state is not JSON.`);

  if (registered === undefined && kind.onAction !== undefined)
    throw new SdkError("invalid", "a definition with onAction must be contributed");
  await requireSession(kernel.store, session);

  const owner = registered?.owner ?? null;
  const definition =
    owner === null && !RESERVED_PART_KINDS.has(kind.kind)
      ? {
          state: convertJsonSchema(kind.state, "output"),
          actions: Object.fromEntries(
            Object.entries(kind.actions).map(([action, schemas]) => {
              const inputSchema = convertJsonSchema(schemas.input, "input");

              return [
                action,
                schemas.output === undefined
                  ? { input: inputSchema }
                  : { input: inputSchema, output: convertJsonSchema(schemas.output, "output") },
              ];
            }),
          ),
        }
      : undefined;

  const minted = input.id ?? asId<"part">(crypto.randomUUID());

  const acquired = step === null ? minted : await recordAcquisition(kernel, step, step.key, minted);

  const id = typeof acquired === "string" ? asId<"part">(acquired) : minted;
  const transcript = input.placement.kind === "transcript";
  const run = transcript ? null : (from?.run ?? null);
  const name = partRef(session, id);

  await attempt(`Creating part ${id}`, async () => {
    const existing = await load(kernel.store, await kernel.store.refs.get(name), decodePartRecord);

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

      const held = run === null ? null : await unfenced(kernel.store, session, run);

      if (run !== null && held === null) return;

      const outcome = await commit(kernel, [
        ...(held === null ? [] : [held]),
        {
          name,
          target: await put(
            kernel.store,
            "part",
            definition === undefined ? stored : { ...stored, definition },
            at,
          ),
          expect: "absent",
          events: [{ head: null, ...created }],
        },
      ]);

      return outcome.kind === "set" ? undefined : STALE;
    }

    const head = from?.head ?? MAIN;
    const tip = await readTip(kernel.store, session, head);

    const record: CommitRecord = {
      parent: tip.id,
      at,
      run: null,
      body: { kind: "part", part: id },
    };

    const landed = asId<"commit">(await put(kernel.store, "commit", record, record.at));

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

    const target = await put(
      kernel.store,
      "part",
      definition === undefined ? stored : { ...stored, definition },
      at,
    );

    const updates: readonly RefUpdate[] = [
      { name, target, expect: "absent", events: [{ head, ...created }] },
      {
        name,
        target,
        events: [{ head, kind: "part", part: id, change: "settled", commit: landed, endedAt: at }],
      },
      {
        name: headRef(session, head),
        target: toCommitObjectId(landed),
        expect: readRefExpectation(tip.ref),
        events: [
          {
            head,
            kind: "commit",
            id: landed,
            parent: record.parent,
            run: null,
            body: record.body,
          },
        ],
      },
    ];

    return (await commit(kernel, updates)).kind === "set" ? undefined : STALE;
  });

  return partHandleFor(kernel, context, session, id, kind);
}

export function partHandle(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  id: PartId,
): Part<PartDefinition> {
  return partHandleFor<PartDefinition>(kernel, context, session, id, null);
}

function partHandleFor<K extends PartDefinition>(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  id: PartId,
  kind: K | null,
): Part<K> {
  const name = partRef(session, id);

  const readDefinition = (
    record: PartRecord,
  ): Pick<PartDefinition, "kind" | "state" | "actions"> | null => {
    const registered = kernel.partDefinitions.get(record.partKind)?.definition ?? kind;

    if (registered !== null) return registered;

    if (record.definition === undefined) return null;

    return {
      kind: record.partKind,
      state: standard(record.definition.state),
      actions: Object.fromEntries(
        Object.entries(record.definition.actions).map(([action, schemas]) => {
          const inputSchema = standard(schemas.input);

          return [
            action,
            schemas.output === undefined
              ? { input: inputSchema }
              : { input: inputSchema, output: standard(schemas.output) },
          ];
        }),
      ),
    };
  };

  const guarded = (record: PartRecord): boolean =>
    record.owner === null &&
    RESERVED_PART_KINDS.has(record.partKind) &&
    context !== CORE_CONTEXT &&
    context.origin === null;

  return {
    id,
    async update(next, options) {
      return attempt<PartUpdateOutcome>(`Updating part ${id}`, async () => {
        const found = await load(kernel.store, await kernel.store.refs.get(name), decodePartRecord);

        if (found === null) return { kind: "missing" };
        const { ref, record } = found;

        if (guarded(record))
          return { kind: "invalid", issues: [issue(`${record.partKind} is a built-in part.`)] };

        if (options?.version !== undefined && options.version !== record.version)
          return { kind: "stale" };
        const given = nextState(kind, next, record.state);

        if (given === null)
          return {
            kind: "invalid",
            issues: [issue(`Part ${id}'s stored state fails its schema.`)],
          };
        const definition = readDefinition(record);

        if (definition === null)
          return { kind: "invalid", issues: [issue(`No state schema is available for ${id}.`)] };
        const checked = await check(definition.state, given.value);

        if (checked.kind === "invalid") return checked;
        const state = checked.value;

        if (!isJson(state)) return { kind: "invalid", issues: [issue("The state is not JSON.")] };
        const version = record.version + 1;

        const outcome = await commit(kernel, [
          {
            name,
            target: await put(kernel.store, "part", { ...record, state, version }),
            expect: ref.revision,
            events: [{ head: null, kind: "part", part: id, change: "updated", state, version }],
          },
        ]);

        return outcome.kind === "set" ? { kind: "updated", version } : STALE;
      });
    },
    async act(action, input) {
      const found = await load(kernel.store, await kernel.store.refs.get(name), decodePartRecord);

      if (found === null) throw new SdkError("unknown", `No part has the id ${id}.`);

      const record = found.record;
      const modal = record.placement.kind === "modal";

      if (modal && record.status.kind !== "live") return { kind: "closed" };
      const registered = kernel.partDefinitions.get(record.partKind);

      if (registered === undefined && record.owner !== null) return { kind: "no-owner" };
      const definition = readDefinition(record);
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

      if (!isPartActionOutput(kind, definition, action, output, handler !== null))
        return {
          kind: "failed",
          message: `${record.partKind}'s ${named} returned output its schema rejects.`,
        };

      if (modal && !(await answered(kernel, session, id, offered))) return { kind: "closed" };

      return { kind: "ok", output };
    },
    async answer(options) {
      const settled = await firstAnswer(kernel, session, name, options?.signal);

      return settled !== null && isPartAnswer(kind, settled) ? settled : null;
    },
    async close() {
      const closed = await attempt(`Closing part ${id}`, async () => {
        const found = await load(kernel.store, await kernel.store.refs.get(name), decodePartRecord);

        if (found === null) return null;

        if (guarded(found.record))
          throw new SdkError("denied", `${found.record.partKind} is a built-in part.`);

        const outcome = await commit(kernel, [
          {
            name,
            target: null,
            expect: found.ref.revision,
            events: [{ head: null, kind: "part", part: id, change: "closed" }],
          },
        ]);

        return outcome.kind === "set" ? found.record.status : STALE;
      });

      if (closed === null) return;
      release(kernel.partTable, name);
      await kernel.waits.partClosed(
        session,
        id,
        closed.kind === "live" ? (closed.waiting ?? null) : null,
      );
    },
  };
}

async function answered(
  kernel: Kernel,
  session: SessionId,
  id: PartId,
  answer: Answered,
): Promise<boolean> {
  const name = partRef(session, id);

  const kept = await attempt(`Answering part ${id}`, async () => {
    const found = await load(kernel.store, await kernel.store.refs.get(name), decodePartRecord);
    const status = found?.record.status;

    if (found === null || status?.kind !== "live") return null;

    if (status.answer !== undefined)
      return { winner: status.answer, waiting: status.waiting ?? null };

    const outcome = await commit(kernel, [
      {
        name,
        target: await put(kernel.store, "part", { ...found.record, status: { ...status, answer } }),
        expect: found.ref.revision,
        events: [{ head: null, kind: "part", part: id, change: "answered", answer }],
      },
    ]);

    return outcome.kind === "set" ? { winner: answer, waiting: status.waiting ?? null } : STALE;
  });

  if (kept === null) return false;
  await kernel.waits.partAnswered(session, id, kept.winner, kept.waiting);
  settle(kernel.partTable, name, kept.winner);

  return true;
}

export async function rerunAction(kernel: Kernel, session: SessionId, call: CallId): Promise<void> {
  const step = (await readCall(kernel.store, session, call))?.record;

  const intent =
    step?.kind === "action" && step.result === null ? decodeActionIntent(step.intent) : null;

  if (intent === null || !(await reserveRerun(kernel, session, call))) return;

  const found = await load(
    kernel.store,
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
          session,
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

async function firstAnswer(
  kernel: Kernel,
  session: SessionId,
  name: string,
  signal: AbortSignal | undefined,
): Promise<Answered | null> {
  if (signal?.aborted === true) return null;
  const table = kernel.partTable;
  const { promise, resolve } = Promise.withResolvers<Answered | null>();
  const waiting = table.waiters.get(name) ?? new Set();
  waiting.add(resolve);
  table.waiters.set(name, waiting);
  const abort = (): void => resolve(null);
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const found = await load(kernel.store, await kernel.store.refs.get(name), decodePartRecord);

    if (
      found === null ||
      found.record.placement.kind !== "modal" ||
      found.record.status.kind !== "live"
    )
      return null;

    const stored = await storedAnswer(kernel.store, session, found.record);

    if (stored !== null) settle(table, name, stored);

    return await promise;
  } finally {
    signal?.removeEventListener("abort", abort);
    const left = table.waiters.get(name);
    left?.delete(resolve);

    if (left?.size === 0) table.waiters.delete(name);
  }
}

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

async function actInput(
  definition: Pick<PartDefinition, "kind" | "state" | "actions"> | null,
  action: string,
  input: unknown,
): Promise<{ readonly value: unknown } | null> {
  if (definition === null) return null;
  const spec = findAction(definition, action);

  if (spec === undefined) return null;
  const checked = await check(spec.input, input);

  if (checked.kind === "invalid")
    throw new SdkError("invalid", `The input fails ${definition.kind}'s ${action} schema.`, {
      issues: checked.issues,
    });

  return { value: checked.value };
}

function findAction(
  definition: Pick<PartDefinition, "actions"> | null,
  action: string,
): ActionSchemas[string] | undefined {
  return definition !== null && Object.hasOwn(definition.actions, action)
    ? definition.actions[action]
    : undefined;
}

function nextState<K extends PartDefinition>(
  kind: K | null,
  next: PartState<K> | ((current: PartState<K>) => PartState<K>),
  current: Json,
): { readonly value: unknown } | null {
  if (!isDerivation(next)) return { value: next };

  return isPartState(kind, current) ? { value: next(current) } : null;
}

function isDerivation<S>(next: S | ((current: S) => S)): next is (current: S) => S {
  return typeof next === "function";
}

function isPartState<K extends PartDefinition>(
  kind: K | null,
  value: Json,
): value is Json & PartState<K> {
  return kind === null || matchesOutput(kind.state, value);
}

function isPartAnswer<K extends PartDefinition>(
  kind: K | null,
  answer: Answered,
): answer is Answered & Answer<K> {
  if (kind === null) return true;
  const spec = findAction(kind, answer.action);

  return spec !== undefined && matchesOutput(spec.input, answer.input);
}

function isPartActionOutput<K extends PartDefinition, A extends keyof PartActions<K>>(
  kind: K | null,
  definition: Pick<PartDefinition, "actions"> | null,
  action: A,
  value: unknown,
  handled: boolean,
): value is PartActions<K>[A]["output"] {
  const output = handled ? findAction(kind ?? definition, String(action))?.output : undefined;

  return output === undefined ? value === undefined : matchesOutput(output, value);
}

function issue(message: string): ValidationIssue {
  return { severity: "error", path: [], message };
}
