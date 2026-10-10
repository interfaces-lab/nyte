import { asId } from "@nyte-ai/schema";
import type {
  HeadName,
  Json,
  PartId,
  Placement,
  RefUpdate,
  RunId,
  Schema,
  SessionId,
  ValidationIssue,
} from "@nyte-ai/schema";
import { objectId } from "./content.ts";
import { recordAcquisition } from "./durable.ts";
import { SdkError } from "./error.ts";
import { check, isJson } from "./json-schema.ts";
import type { Checked } from "./json-schema.ts";
import type { Kernel } from "./kernel.ts";
import type { RegisteredDefinition } from "./part-definitions.ts";
import type {
  ActionContext,
  ActionSchemas,
  Part,
  PartActions,
  PartDefinition,
  PartState,
} from "./parts.ts";
import { requireAuthority } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { decodePartRecord } from "./records.ts";
import type { CommitRecord, PartRecord } from "./records.ts";
import { headRef, partRef } from "./refs.ts";
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
  readTip,
  requireSession,
} from "./session-state.ts";

/** Returns the first act on a modal part: the action's name and its validated input. */
interface Answered {
  readonly action: string;
  readonly input: unknown;
}

/** Returns what one kernel holds in memory about its parts, keyed by part ref: the definitions that created them, closed parts, modal answers, `answer()` waiters and the acts in flight. */
interface PartTable {
  readonly created: Map<string, PartDefinition>;
  readonly closed: Set<string>;
  readonly answered: Map<string, Answered>;
  readonly waiters: Map<string, Set<(answer: Answered | null) => void>>;
  readonly acting: Map<string, Set<AbortController>>;
}

/** Returns what an action handler ended with: its return value, what it threw, or the part closing first. */
type Performed =
  | { readonly kind: "returned"; readonly output: unknown }
  | { readonly kind: "threw"; readonly error: unknown }
  | { readonly kind: "closed" };

/** Returns what `answer()` resolves with on a handle typed by `K`, short of null. */
type Answer<K extends PartDefinition> = NonNullable<Awaited<ReturnType<Part<K>["answer"]>>>;

/** Returns what `update` resolves with. */
type PartUpdateOutcome = Awaited<ReturnType<Part<PartDefinition>["update"]>>;

/** Each kernel's in-memory part table. */
const tables = new WeakMap<Kernel, PartTable>();

/** The session each handle this module bound acts in. */
const boundIn = new WeakMap<object, SessionId>();

/** Creates a part: validates `state` against the definition (`invalid` with issues), writes the `PartRecord` at `parts/<part>` with `part created` (owner from the registry by kind, null when unregistered; `run` default null), and returns its handle. A definition with `onAction` must be registered. An existing id with the same kind and an equal state is a replay and writes nothing; any other existing id is `invalid`. A transcript part outside a run also lands as a commit on `head` (default main) in the same set: `[part created, part settled, commit]`. The kernel remembers the creating definition in memory, so handles bound by id validate against it when the kind is unregistered. From a durable step (`context.origin` naming a call) the creation is an acquisition recorded on the step's call before the part is written, keyed by `input.id ?? \`acq:${origin.sequence.next()}\``, so a re-run returns the part it already created, whatever its state now. */
export async function createPart<K extends PartDefinition>(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  kind: K,
  input: {
    readonly state: unknown;
    readonly placement: Placement;
    readonly id?: PartId;
    readonly run?: RunId | null;
    readonly head?: HeadName;
  },
): Promise<Part<K>> {
  const origin = context.origin;

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
  const run = input.run ?? null;
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

    if (input.placement.kind !== "transcript" || run !== null) {
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

      const outcome = await commit(kernel, [
        {
          name,
          target: await put(kernel, "part", stored, at),
          expect: "absent",
          event: { head: input.head ?? null, ...created },
        },
      ]);

      return outcome.kind === "set" ? undefined : STALE;
    }

    const head = input.head ?? MAIN;
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

  const table = tableOf(kernel);
  table.closed.delete(name);
  table.created.set(name, kind);

  return partHandleFor(kernel, context, session, id, kind);
}

/** Returns a handle on a part by id: `update` validates against the registered definition, else the one that created the part in this process, and compare-and-sets the ref with `part updated`; `act` runs the registered definition's `onAction` as a durable step, or settles `answer()` and returns ok with no output when it has none; an ok act on a modal part wakes the durable waits on it with its answer; `answer()` waits in memory for the first act on a modal part, or null at close; `close` deletes the ref with `part closed` and wakes the waits on it with no answer. Binds synchronously; no I/O. */
export function partHandle(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  id: PartId,
): Part<PartDefinition> {
  return partHandleFor<PartDefinition>(kernel, context, session, id, null);
}

/** Returns a handle on a part typed by its definition, or untyped when `kind` is null; each method needs participant authority. The governing definition is the registered one for the part's kind, else `kind`, else the one that created the part here. An answer the handle's definition cannot express reads as null. */
function partHandleFor<K extends PartDefinition>(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  id: PartId,
  kind: K | null,
): Part<K> {
  const name = partRef(session, id);
  const table = tableOf(kernel);

  const need = (operation: string): void =>
    requireAuthority(context.authority, "participant", `part.${operation}`);

  const definitionOf = (partKind: string): PartDefinition | null =>
    kernel.partDefinitions.get(partKind)?.definition ?? kind ?? table.created.get(name) ?? null;

  const handle: Part<K> = {
    id,
    async update(next) {
      need("update");

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
      need("act");

      const found = table.closed.has(name)
        ? null
        : await load(kernel, await kernel.store.refs.get(name), decodePartRecord);

      if (found === null) {
        if (table.closed.has(name)) return { kind: "closed" };

        throw new SdkError("unknown", `No part has the id ${id}.`);
      }

      const record = found.record;
      const registered = kernel.partDefinitions.get(record.partKind);

      if (registered === undefined && record.owner !== null) return { kind: "no-owner" };
      const definition = definitionOf(record.partKind);
      const named = String(action);
      const accepted = await actInput(definition, named, input);

      if (accepted === null) return { kind: "unknown-action" };
      const handler = registered?.definition.onAction === undefined ? null : registered;

      const performed: Performed =
        handler === null
          ? { kind: "returned", output: undefined }
          : await perform(kernel, context, {
              session,
              record,
              registered: handler,
              action: named,
              input: accepted.value,
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

      if (record.placement.kind === "modal") {
        settle(table, name, { action: named, input: accepted.value });
        await kernel.waits.partAnswered(id, {
          action: named,
          input: isJson(accepted.value) ? accepted.value : null,
        });
      }

      return { kind: "ok", output };
    },
    async answer() {
      need("answer");
      const settled = await firstAnswer(kernel, name);

      return settled !== null && isAnswerOf(kind, settled) ? settled : null;
    },
    async close() {
      need("close");

      if (table.closed.has(name)) return;

      const closed = await attempt(`Closing part ${id}`, async () => {
        const ref = await kernel.store.refs.get(name);

        if (ref === null) return false;

        const outcome = await commit(kernel, [
          {
            name,
            target: null,
            expect: ref.revision,
            event: { head: null, kind: "part", part: id, change: "closed" },
          },
        ]);

        return outcome.kind === "set" ? true : STALE;
      });

      if (!closed) return;
      release(table, name);
      await kernel.waits.partClosed(id);
    },
  };

  boundIn.set(handle, session);

  return handle;
}

/** Returns the first answer a modal part had in this process, its input when JSON, or null when it has none. */
export function answerOf(
  kernel: Kernel,
  session: SessionId,
  part: PartId,
): { readonly action: string; readonly input: Json } | null {
  const answered = tableOf(kernel).answered.get(partRef(session, part));

  return answered === undefined
    ? null
    : { action: answered.action, input: isJson(answered.input) ? answered.input : null };
}

/** Returns the session a part handle this module bound acts in, or undefined for any other object. */
export function sessionOfPart(part: object): SessionId | undefined {
  return boundIn.get(part);
}

/** Runs a registered definition's `onAction` as a durable step through `kernel.durable.run`, with call id `act:<part>:<uuid>`; resolves closed as soon as the part closes, aborting the handler's signal. A parked step leaves the act pending until a wake completes the step in this host's life, or the part closes. An interrupted step fails the act. */
async function perform(
  kernel: Kernel,
  context: ConnectionContext,
  input: {
    readonly session: SessionId;
    readonly record: PartRecord;
    readonly registered: RegisteredDefinition;
    readonly action: string;
    readonly input: unknown;
  },
): Promise<Performed> {
  const { session, record, registered } = input;
  const name = partRef(session, record.id);
  const table = tableOf(kernel);

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
      call: asId<"call">(`act:${record.id}:${crypto.randomUUID()}`),
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

/** Returns a part's first answer at once when it has one; otherwise waits for it, or null once the part closes. Null at once when no part has the id. */
async function firstAnswer(kernel: Kernel, name: string): Promise<Answered | null> {
  const table = tableOf(kernel);
  const exists = (await kernel.store.refs.get(name)) !== null;
  const settled = table.answered.get(name);

  if (settled !== undefined) return settled;

  if (!exists || table.closed.has(name)) return null;

  return new Promise((resolve) => {
    const waiting = table.waiters.get(name) ?? new Set();
    waiting.add(resolve);
    table.waiters.set(name, waiting);
  });
}

/** Records the first answer to a modal part and resolves its waiters with it. */
function settle(table: PartTable, name: string, answer: Answered): void {
  if (table.answered.has(name)) return;
  table.answered.set(name, answer);

  for (const resolve of table.waiters.get(name) ?? []) resolve(answer);
  table.waiters.delete(name);
}

/** Marks a part closed in memory: its waiters resolve null, its acts in flight resolve closed, and its creating definition and answer are dropped. */
function release(table: PartTable, name: string): void {
  table.closed.add(name);
  table.created.delete(name);

  for (const resolve of table.waiters.get(name) ?? []) resolve(null);

  for (const controller of table.acting.get(name) ?? []) controller.abort();
  table.waiters.delete(name);
  table.acting.delete(name);
  table.answered.delete(name);
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

/** Returns whether a value is what `act` answers for an action: undefined when no handler ran, whatever the action declares (the baseline's rule without `onAction`); otherwise what the action's `output` schema accepts, or undefined when it declares none. The schema is `kind`'s, or the governing definition's on a handle bound without one. */
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

/** Returns the kernel's part table, creating it on first use. */
function tableOf(kernel: Kernel): PartTable {
  const known = tables.get(kernel);

  if (known !== undefined) return known;

  const table: PartTable = {
    created: new Map(),
    closed: new Set(),
    answered: new Map(),
    waiters: new Map(),
    acting: new Map(),
  };

  tables.set(kernel, table);

  return table;
}
