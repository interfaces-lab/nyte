import type { CredentialInfo, Models, Provider } from "@nyte-ai/ai";
import { ModelRefType, ThinkingType } from "@nyte-ai/schema";
import type { Json, ModelRef, Thinking } from "@nyte-ai/schema";
import { Value } from "typebox/value";
import type { CredentialStatus, ModelState } from "../contract/host.ts";
import { decodeKvValue } from "../contract/records.ts";
import type { StoreConnection } from "../contract/store.ts";
import { kvRef } from "./refs.ts";

interface Slot {
  readonly provider: Provider;
  readonly models: Models;
  readonly account: string;
  readonly controller: AbortController;
  credential: CredentialStatus;
  checkedAt: number | null;
  checking: Promise<CredentialStatus> | null;
  revision: number;
}

const CHECK_INTERVAL_MS = 60_000;

export const MODEL_PREFERENCE = kvRef("host", "models", "default");

const THINKING_PREFERENCES = kvRef("host", "models", "thinking/");

export function thinkingPreferenceRef(model: ModelRef): string {
  return `${THINKING_PREFERENCES}${model.provider}/${model.id}`;
}

export async function readThinkingPreference(
  store: StoreConnection,
  model: ModelRef,
): Promise<Thinking | undefined> {
  const ref = await store.refs.get(thinkingPreferenceRef(model));

  return ref === null || ref.target === null
    ? undefined
    : decodeThinking(await store.objects.get(ref.target));
}

export async function readThinkingPreferences(
  store: StoreConnection,
): Promise<ReadonlyMap<string, Thinking>> {
  const refs = await store.refs.list(THINKING_PREFERENCES);

  const entries = await Promise.all(
    refs.map(async (ref): Promise<readonly (readonly [string, Thinking])[]> => {
      if (ref.target === null) return [];
      const level = decodeThinking(await store.objects.get(ref.target));

      return level === undefined ? [] : [[ref.name.slice(THINKING_PREFERENCES.length), level]];
    }),
  );

  return new Map(entries.flat());
}

function decodeThinking(object: Json | null): Thinking | undefined {
  const value = decodeKvValue(object);

  return Value.Check(ThinkingType, value) ? value : undefined;
}

/** Reads the saved model without checking a provider. */
export async function readModelSelection(store: StoreConnection): Promise<ModelRef | null> {
  const ref = await store.refs.get(MODEL_PREFERENCE);

  const value =
    ref === null || ref.target === null
      ? undefined
      : decodeKvValue(await store.objects.get(ref.target));

  return Value.Check(ModelRefType, value) ? { provider: value.provider, id: value.id } : null;
}

export function createModelState(changed: () => void): ModelState {
  const slots = new Map<string, Slot>();
  const pending = new Set<Promise<unknown>>();
  const closed = new AbortController();

  const current = (slot: Slot) =>
    !closed.signal.aborted &&
    slots.get(slot.provider.id) === slot &&
    slot.models.getProvider(slot.provider.id) === slot.provider;

  const track = <T>(task: Promise<T>): Promise<T> => {
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );

    return task;
  };

  const prepare = (
    models: Models,
    provider: Provider,
    accounts: readonly CredentialInfo[],
  ): Slot => {
    closed.signal.throwIfAborted();
    const own = accounts.filter((entry) => entry.providerId === provider.id);
    const account = JSON.stringify(own.map(({ id, type, active }) => [id, type, active]));
    const known = slots.get(provider.id);

    if (known?.provider === provider && known.models === models && known.account === account)
      return known;
    known?.controller.abort();
    const active = own.find((entry) => entry.active);

    const configured =
      active?.type === "oauth"
        ? provider.auth.oauth !== undefined && provider.auth.oauth.check === undefined
        : active?.type === "api_key" &&
          provider.auth.apiKey !== undefined &&
          provider.auth.apiKey.check === undefined;

    const credential: CredentialStatus = configured
      ? "configured"
      : own.length > 0 && active === undefined
        ? "missing"
        : "unknown";

    const slot: Slot = {
      models,
      provider,
      account,
      controller: new AbortController(),
      credential,
      checkedAt: credential === "unknown" ? null : Date.now(),
      checking: null,
      revision: 0,
    };

    slots.set(provider.id, slot);

    return slot;
  };

  const publish = (slot: Slot, credential: CredentialStatus, revision: number): void => {
    if (!current(slot) || slot.revision !== revision) return;
    const previous = slot.credential;
    slot.credential = credential;
    slot.checkedAt = Date.now();

    if (previous !== credential) changed();
  };

  const check = (slot: Slot): Promise<CredentialStatus> => {
    closed.signal.throwIfAborted();

    if (!current(slot)) return Promise.resolve("unknown");

    if (slot.checking !== null) return slot.checking;
    const revision = ++slot.revision;

    const operation = track(
      (async () => {
        try {
          const found = await slot.models.checkAuth(slot.provider.id, {
            signal: AbortSignal.any([closed.signal, slot.controller.signal]),
          });

          const credential =
            found === undefined
              ? "missing"
              : slot.credential === "verified" || slot.credential === "failed"
                ? slot.credential
                : "configured";

          publish(slot, credential, revision);

          return found === undefined ? ("missing" as const) : ("configured" as const);
        } catch {
          if (!closed.signal.aborted && !slot.controller.signal.aborted)
            publish(slot, "failed", revision);

          return "failed" as const;
        }
      })(),
    );

    slot.checking = operation;
    void operation.then(
      () => {
        if (slot.checking === operation) slot.checking = null;
      },
      () => {
        if (slot.checking === operation) slot.checking = null;
      },
    );

    return operation;
  };

  return {
    async read(models) {
      const accounts = await models.listAccounts(undefined, { signal: closed.signal });
      closed.signal.throwIfAborted();
      const entries = models.getProviders().map((provider) => prepare(models, provider, accounts));
      const result = new Map(entries.map((slot) => [slot.provider.id, slot.credential]));

      for (const slot of entries)
        if (slot.checkedAt === null || Date.now() - slot.checkedAt >= CHECK_INTERVAL_MS)
          void check(slot);

      return result;
    },
    async check(models, provider) {
      return check(
        prepare(
          models,
          provider,
          await models.listAccounts(provider.id, { signal: closed.signal }),
        ),
      );
    },
    async refresh(models, provider) {
      const accounts = await models.listAccounts(undefined, { signal: closed.signal });
      closed.signal.throwIfAborted();
      await Promise.all(
        models
          .getProviders()
          .filter((entry) => provider === undefined || entry.id === provider)
          .map((entry) => check(prepare(models, entry, accounts))),
      );
    },
    async verify(models, provider) {
      const entry = models.getProvider(provider);

      if (entry === undefined) return models.verifyAuth(provider, { signal: closed.signal });

      const slot = prepare(
        models,
        entry,
        await models.listAccounts(provider, { signal: closed.signal }),
      );

      const signal = AbortSignal.any([closed.signal, slot.controller.signal]);
      const revision = ++slot.revision;

      const operation = track(
        (async () => {
          try {
            const result = await models.verifyAuth(provider, { signal });
            publish(
              slot,
              result.ok
                ? result.verified
                  ? "verified"
                  : "configured"
                : result.reason === "unconfigured"
                  ? "missing"
                  : "failed",
              revision,
            );

            return result;
          } catch (error) {
            if (!signal.aborted) publish(slot, "failed", revision);
            throw error;
          }
        })(),
      );

      const checking = operation.then(
        () => slot.credential,
        () => slot.credential,
      );

      slot.checking = checking;
      void checking.then(() => {
        if (slot.checking === checking) slot.checking = null;
      });

      return operation;
    },
    invalidate(provider) {
      const slot = slots.get(provider);
      slots.delete(provider);
      slot?.controller.abort();
    },
    async close() {
      closed.abort();
      await Promise.allSettled(pending);
      slots.clear();
    },
  };
}
