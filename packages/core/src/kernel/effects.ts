import { effectPrefix, effectRef } from "./names.ts";
import type { Actor, Effect, Lease, Oid, RefName, RefUpdateOutcome } from "./model.ts";
import type { Session } from "./store.ts";

type EffectIntent = Extract<Effect, { readonly state: "intent" }>;

export interface EffectView {
  readonly ref: RefName;
  readonly oid: Oid;
  readonly effect: Effect;
  readonly intent: Extract<Effect, { readonly state: "intent" }>;
}

function isEffect(effect: Awaited<ReturnType<Session["objects"]["get"]>>): effect is Effect {
  return effect?.kind === "effect";
}

async function putEffect(session: Session, effect: Effect): Promise<Oid> {
  const oid = (await session.objects.put([effect]))[0];
  if (oid === undefined) throw new Error("Effect object write returned no oid");
  return oid;
}

async function resolveEffect(
  session: Session,
  entry: { readonly ref: RefName; readonly oid: Oid },
): Promise<EffectView> {
  const effect = await session.objects.get(entry.oid);
  if (!isEffect(effect)) {
    throw new Error(`Corrupt effect ref ${entry.ref}: missing or non-effect object ${entry.oid}`);
  }
  if (effect.state === "intent") {
    return { ...entry, effect, intent: effect };
  }

  const intent = await session.objects.get(effect.intent);
  if (!isEffect(intent) || intent.state !== "intent") {
    throw new Error(
      `Corrupt effect ref ${entry.ref}: missing or non-intent object ${effect.intent}`,
    );
  }
  return { ...entry, effect, intent };
}

function compareCallIds(left: EffectView, right: EffectView): number {
  if (left.intent.callId < right.intent.callId) return -1;
  if (left.intent.callId > right.intent.callId) return 1;
  return 0;
}

function intentOidForPark(view: EffectView): Oid {
  switch (view.effect.state) {
    case "intent":
      return view.oid;
    case "signal":
      return view.effect.intent;
    case "waiting":
    case "result":
      throw new TypeError(`Cannot park an effect in state ${view.effect.state}`);
    default: {
      const _exhaustive: never = view.effect;
      return _exhaustive;
    }
  }
}

function intentOidForSettlement(view: EffectView): Oid {
  switch (view.effect.state) {
    case "intent":
      return view.oid;
    case "waiting":
    case "signal":
      return view.effect.intent;
    case "result":
      throw new TypeError("Cannot settle an effect that already has a result");
    default: {
      const _exhaustive: never = view.effect;
      return _exhaustive;
    }
  }
}

export async function readEffect(
  session: Session,
  options: { readonly runId: string; readonly callId: string },
): Promise<EffectView | undefined> {
  const ref = effectRef(options.runId, options.callId);
  const oid = await session.refs.read(ref);
  return oid === null ? undefined : resolveEffect(session, { ref, oid });
}

export async function listEffects(session: Session, runId: string): Promise<EffectView[]> {
  const entries = await session.refs.list(effectPrefix(runId));
  const views = await Promise.all(
    entries.map((entry) => resolveEffect(session, { ref: entry.name, oid: entry.oid })),
  );
  return views.sort(compareCallIds);
}

export async function openEffect(
  session: Session,
  options: {
    readonly lease: Lease;
    readonly runId: string;
    readonly callId: string;
    readonly tool: string;
    readonly args: EffectIntent["args"];
    readonly replay: EffectIntent["replay"];
  },
): Promise<
  | { readonly kind: "opened"; readonly view: EffectView }
  | {
      readonly kind: "exists";
      readonly view: EffectView;
    }
> {
  const existing = await readEffect(session, options);
  if (existing !== undefined) return { kind: "exists", view: existing };

  const effect: EffectIntent = {
    kind: "effect",
    state: "intent",
    runId: options.runId,
    callId: options.callId,
    tool: options.tool,
    args: options.args,
    replay: options.replay,
    at: Date.now(),
  };
  const ref = effectRef(options.runId, options.callId);
  const oid = await putEffect(session, effect);
  const outcome = await session.refs.update([{ name: ref, from: null, to: oid }], {
    reason: "effect",
    lease: options.lease,
  });
  if (outcome.ok) return { kind: "opened", view: { ref, oid, effect, intent: effect } };

  const winner = await readEffect(session, options);
  if (winner !== undefined) return { kind: "exists", view: winner };

  switch (outcome.reason) {
    case "conflict":
      throw new Error(`Effect ${ref} disappeared after its open conflicted`);
    case "fenced":
      throw new Error(`Effect ${ref} could not open because its lease was fenced`);
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

export async function parkEffect(
  session: Session,
  options: { readonly lease: Lease; readonly view: EffectView },
): Promise<EffectView | { readonly kind: "conflict" }> {
  const effect: Effect = {
    kind: "effect",
    state: "waiting",
    intent: intentOidForPark(options.view),
    at: Date.now(),
  };
  const oid = await putEffect(session, effect);
  const outcome = await session.refs.update(
    [{ name: options.view.ref, from: options.view.oid, to: oid }],
    { reason: "effect", lease: options.lease },
  );
  return outcome.ok
    ? { ref: options.view.ref, oid, effect, intent: options.view.intent }
    : { kind: "conflict" };
}

export async function signalEffect(
  session: Session,
  options: {
    readonly runId: string;
    readonly callId: string;
    readonly signal: Extract<Effect, { readonly state: "signal" }>["signal"];
    readonly actor?: Actor;
  },
): Promise<
  | { readonly kind: "signalled"; readonly view: EffectView }
  | { readonly kind: "not_waiting"; readonly view: EffectView }
  | { readonly kind: "not_found" }
> {
  const view = await readEffect(session, options);
  if (view === undefined) return { kind: "not_found" };
  if (view.effect.state !== "waiting") return { kind: "not_waiting", view };

  const baseEffect: Effect = {
    kind: "effect",
    state: "signal",
    intent: view.effect.intent,
    signal: options.signal,
    at: Date.now(),
  };
  const effect: Effect =
    options.actor === undefined ? baseEffect : { ...baseEffect, author: options.actor };
  const oid = await putEffect(session, effect);
  const updateOptions =
    options.actor === undefined ? { reason: "signal" } : { reason: "signal", actor: options.actor };
  const outcome = await session.refs.update(
    [{ name: view.ref, from: view.oid, to: oid }],
    updateOptions,
  );
  if (outcome.ok) {
    return {
      kind: "signalled",
      view: { ref: view.ref, oid, effect, intent: view.intent },
    };
  }

  const current = await readEffect(session, options);
  return current === undefined ? { kind: "not_found" } : { kind: "not_waiting", view: current };
}

export async function settleEffect(
  session: Session,
  options: {
    readonly lease: Lease;
    readonly view: EffectView;
    readonly result: Extract<Effect, { readonly state: "result" }>["result"];
  },
): Promise<EffectView | { readonly kind: "conflict" }> {
  const effect: Effect = {
    kind: "effect",
    state: "result",
    intent: intentOidForSettlement(options.view),
    result: options.result,
    at: Date.now(),
  };
  const oid = await putEffect(session, effect);
  const outcome = await session.refs.update(
    [{ name: options.view.ref, from: options.view.oid, to: oid }],
    { reason: "effect", lease: options.lease },
  );
  return outcome.ok
    ? { ref: options.view.ref, oid, effect, intent: options.view.intent }
    : { kind: "conflict" };
}

export async function clearEffects(
  session: Session,
  options: { readonly lease: Lease; readonly runId: string; readonly views: readonly EffectView[] },
): Promise<RefUpdateOutcome> {
  const updates = options.views.map((view) => {
    const ref = effectRef(options.runId, view.intent.callId);
    if (view.intent.runId !== options.runId || view.ref !== ref) {
      throw new TypeError(`Effect ${view.ref} does not belong to run ${options.runId}`);
    }
    return { name: ref, from: view.oid, to: null };
  });
  return session.refs.update(updates, { reason: "clear", lease: options.lease });
}

/**
 * Recovery depends only on the durable state. An unstarted intent follows its replay policy, a
 * parked call stays blocked, a signal enters the wake handler, and a settled result is reused.
 * This avoids guessing whether the uncertain work ran after a process disappeared.
 */
export function decideRecovery(
  view: EffectView,
): "execute" | "interrupted" | "blocked" | "wake" | "reuse" {
  switch (view.effect.state) {
    case "intent":
      switch (view.effect.replay) {
        case "safe":
          return "execute";
        case "never":
          return "interrupted";
        default: {
          const _exhaustive: never = view.effect.replay;
          return _exhaustive;
        }
      }
    case "waiting":
      return "blocked";
    case "signal":
      return "wake";
    case "result":
      return "reuse";
    default: {
      const _exhaustive: never = view.effect;
      return _exhaustive;
    }
  }
}
