import { isJson, isJsonObject, SdkError } from "@nyte-ai/schema";
import type {
  ConfigurationPatch,
  ConfigureOutcome,
  HeadName,
  Json,
  SessionId,
} from "@nyte-ai/schema";
import type { SettingsApi } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import type { Setting, ResolvedSetting } from "../contract/plugin.ts";
import { collectContributions } from "../engine/contributions.ts";
import { WORKSPACE_TRUST } from "../env/trust.ts";
import { dropScans, readTrust, trustChanged } from "../env/workspaces.ts";
import { commit } from "../watch/commit.ts";
import { headRef, kvRef, sessionRef } from "../store/refs.ts";
import { openText, sealText } from "../store/secrets.ts";
import {
  attempt,
  EMPTY_REVISION,
  MAIN,
  put,
  readKv,
  requireSession,
  STALE,
} from "../store/session.ts";
import { readSetting } from "../store/setting-layers.ts";
import { check } from "../util/json-schema.ts";
import { publishCatalog } from "./registry.ts";
import { SKILL_PATHS } from "./resources.ts";
import { findSettingDefinition, settingInfos } from "./setting-definitions.ts";

export function createSettingsApi(kernel: Kernel): SettingsApi {
  return {
    async apply(id, value) {
      const found = findSettingDefinition(kernel, id);

      if (found === undefined) return { kind: "unknown" };
      const checked = await check(found.definition.schema, value);

      if (checked.kind === "invalid") return { kind: "invalid", issues: checked.issues };
      await storeHostValue(kernel, found.definition, value);

      return { kind: "applied" };
    },
  };
}

export function settingHandle<T>(
  kernel: Kernel,
  definition: ResolvedSetting<T>,
  input: {
    readonly owner: string;
    readonly session: SessionId | null;
    readonly signal: AbortSignal;
  },
): Setting<T> {
  const { session, signal } = input;
  const { id } = definition;

  const get = (): Promise<T> =>
    definition.secret === true
      ? readOpenedSetting(kernel, definition)
      : readSetting(kernel.store, definition, session);

  return {
    get,
    async set(value) {
      if (!isJson(value)) throw new SdkError("invalid", `Setting ${id} takes a JSON value.`);
      const checked = await check(definition.schema, value);

      if (checked.kind === "invalid")
        throw new SdkError("invalid", `Setting ${id} rejects this value.`, {
          issues: checked.issues,
        });

      if (definition.scope === "host" || session === null) {
        await storeHostValue(kernel, definition, value);

        return;
      }

      const outcome = await configure(kernel, session, MAIN, { settings: { [id]: value } }, true);

      if (outcome.kind !== "configured")
        throw new SdkError("invalid", `Setting ${id} could not be configured: ${outcome.kind}.`, {
          issues: outcome.kind === "invalid" ? outcome.issues : [],
        });
    },
    watch: () => ({
      async *[Symbol.asyncIterator]() {
        let changed = Promise.withResolvers<void>();

        const { settings } = kernel.plugins.state;

        const listener = (setting: string, scope: SessionId | null): void => {
          if (setting === id && (scope === null || scope === session)) changed.resolve();
        };

        settings.add(listener);

        const deactivated = Promise.withResolvers<void>();
        const deactivate = (): void => deactivated.resolve();
        signal.addEventListener("abort", deactivate, { once: true });

        try {
          if (signal.aborted) return;

          yield await get();

          for (;;) {
            await Promise.race([changed.promise, deactivated.promise]);

            if (signal.aborted) return;
            changed = Promise.withResolvers<void>();

            yield await get();
          }
        } finally {
          settings.delete(listener);
          signal.removeEventListener("abort", deactivate);
        }
      },
    }),
  };
}

export async function publishSettings(kernel: Kernel): Promise<void> {
  kernel.host.update({ settings: await settingInfos(kernel, null) });
}

async function storeHostValue(
  kernel: Kernel,
  definition: Pick<ResolvedSetting, "id" | "secret">,
  value: Json,
): Promise<void> {
  const id = definition.id;
  const name = kvRef("host", "settings", id);

  const stored = definition.secret
    ? await sealSecretEntries(kernel, value, await readKv(kernel.store, name))
    : value;

  const trust = id === WORKSPACE_TRUST ? await readTrust(kernel) : null;

  await commit(kernel, [{ name, target: await put(kernel.store, "kv", stored) }]);
  changed(kernel, id, null);

  if (trust !== null) void trustChanged(kernel, trust).catch(() => undefined);

  if (id === SKILL_PATHS) {
    dropScans(kernel);

    for (const session of kernel.plugins.runtimes().keys())
      void kernel.plugins.reload(session).catch(() => undefined);
  }

  await Promise.all([
    ...[...kernel.plugins.runtimes().keys()].map((session) => publishCatalog(kernel, session)),
    publishSettings(kernel),
  ]);
}

async function readOpenedSetting<T>(kernel: Kernel, definition: ResolvedSetting<T>): Promise<T> {
  const stored = await readKv(kernel.store, kvRef("host", "settings", definition.id));

  if (stored === undefined) return definition.default;

  const opened =
    !isJsonObject(stored) || stored.secret === true
      ? await openSecretEntry(kernel, stored)
      : Object.fromEntries(
          await Promise.all(
            Object.entries(stored).map(
              async (entry) => [entry[0], await openSecretEntry(kernel, entry[1])] as const,
            ),
          ),
        );

  const checked = await check(definition.schema, opened);

  return checked.kind === "valid" ? checked.value : definition.default;
}

async function openSecretEntry(kernel: Kernel, entry: Json): Promise<Json> {
  if (!isJsonObject(entry) || entry.secret !== true) return entry;
  const value = await openText(kernel, entry).catch(() => undefined);

  return value === undefined ? { secret: true } : { secret: true, value };
}

async function sealSecretEntries(
  kernel: Kernel,
  written: Json,
  stored: Json | undefined,
): Promise<Json> {
  if (!isJsonObject(written)) return written;

  if (written.secret === true) return sealSecretEntry(kernel, "This setting", written, stored);

  const kept = isJsonObject(stored) ? stored : {};

  const entries = await Promise.all(
    Object.entries(written).map(async (entry): Promise<[string, Json]> => [
      entry[0],
      await sealSecretEntry(kernel, entry[0], entry[1], kept[entry[0]]),
    ]),
  );

  return Object.fromEntries(entries);
}

async function sealSecretEntry(
  kernel: Kernel,
  name: string,
  written: Json,
  stored: Json | undefined,
): Promise<Json> {
  if (!isJsonObject(written) || written.secret !== true) return written;

  if (typeof written.value === "string")
    return { secret: true, ...(await sealText(kernel, written.value)) };

  if (isJsonObject(stored) && stored.secret === true && "ciphertext" in stored) return stored;

  throw new SdkError("invalid", `${name} is secret but has no value to keep. Enter one.`);
}

async function settingsConfigured(
  kernel: Kernel,
  session: SessionId,
  ids: readonly string[],
): Promise<void> {
  for (const id of ids) changed(kernel, id, session);
  await publishCatalog(kernel, session);
}

function changed(kernel: Kernel, id: string, session: SessionId | null): void {
  for (const listener of kernel.plugins.state.settings) listener(id, session);
}

export async function configure(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  patch: ConfigurationPatch,
  activation = false,
): Promise<ConfigureOutcome> {
  const selected = await attempt(`Configuring ${head}`, async () => {
    const current = await requireSession(kernel.store, session);
    const entry = current.record.heads.find((other) => other.name === head);

    if (entry === undefined)
      throw new SdkError("unknown", `Session ${session} has no head ${head}.`);
    const runtime = kernel.plugins.runtime(session);

    if (!activation) await runtime.ready;

    const resolved = await kernel.resolveConfiguration({
      session,
      head,
      selected: entry.selected,
      patch,
      contributions: collectContributions(runtime),
    });

    if (resolved.kind !== "exact") return resolved;

    const record = {
      ...current.record,
      heads: current.record.heads.map((other) =>
        other.name === head ? { ...other, selected: resolved } : other,
      ),
    };

    const outcome = await commit(kernel, [
      {
        name: sessionRef(session),
        target: await put(kernel.store, "session", record),
        expect: current.ref.revision,
        events: [{ head, kind: "configured", selected: resolved, effective: resolved }],
      },
    ]);

    return outcome.kind === "set" ? resolved : STALE;
  });

  if (selected.kind !== "exact") return selected;

  if (patch.settings !== undefined)
    await settingsConfigured(kernel, session, Object.keys(patch.settings));
  const ref = await kernel.store.refs.get(headRef(session, head));

  return { kind: "configured", selected, revision: ref?.revision ?? EMPTY_REVISION };
}
