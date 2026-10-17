import { isJson, SdkError } from "@nyte-ai/schema";
import type {
  ConfigurationPatch,
  ConfigureOutcome,
  HeadName,
  Json,
  SessionId,
} from "@nyte-ai/schema";
import type { SettingsApi } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import type { Setting, SettingDefinition } from "../contract/plugin.ts";
import { collectContributions } from "../engine/contributions.ts";
import { WORKSPACE_TRUST } from "../env/trust.ts";
import { trustChanged } from "../env/workspaces.ts";
import { commit } from "../fold/commit.ts";
import { headRef, kvRef, sessionRef } from "../store/refs.ts";
import { attempt, EMPTY_REVISION, MAIN, put, requireSession, STALE } from "../store/session.ts";
import { check } from "../util/json-schema.ts";
import { publishCatalog } from "./registry.ts";
import { dropScans, SKILL_PATHS } from "./resources.ts";
import { findSettingDefinition, readSettingLayers, settingInfos } from "./setting-layers.ts";

export function createSettingsApi(kernel: Kernel): SettingsApi {
  return {
    async apply(id, value) {
      const found = findSettingDefinition(kernel, id);

      if (found === undefined) return { kind: "unknown" };
      const checked = await check(found.definition.schema, value);

      if (checked.kind === "invalid") return { kind: "invalid", issues: checked.issues };
      await storeHostValue(kernel, id, value);

      return { kind: "applied" };
    },
  };
}

export function settingHandle<T>(
  kernel: Kernel,
  definition: SettingDefinition<T>,
  input: {
    readonly owner: string;
    readonly session: SessionId | null;
    readonly signal: AbortSignal;
  },
): Setting<T> {
  const { session, signal } = input;
  const { id } = definition;

  const get = async (): Promise<T> => {
    for (const layer of await readSettingLayers(kernel.store, definition, session)) {
      const checked = await check(definition.schema, layer.value);

      if (checked.kind === "valid") return checked.value;
    }

    return definition.default;
  };

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
        await storeHostValue(kernel, id, value);

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

async function storeHostValue(kernel: Kernel, id: string, value: Json): Promise<void> {
  await commit(kernel, [
    { name: kvRef("host", "settings", id), target: await put(kernel.store, "kv", value) },
  ]);
  changed(kernel, id, null);

  if (id === WORKSPACE_TRUST) void trustChanged(kernel).catch(() => undefined);

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
  const found = await requireSession(kernel.store, session);
  const entry = found.record.heads.find((current) => current.name === head);

  if (entry === undefined) throw new SdkError("unknown", `Session ${session} has no head ${head}.`);
  const runtime = kernel.plugins.runtime(session);

  if (!activation) await runtime.ready;

  const selected = await kernel.resolveConfiguration({
    session,
    head,
    selected: entry.selected,
    patch,
    contributions: collectContributions(runtime),
  });

  if (selected.kind !== "exact") return selected;

  await attempt(`Configuring ${head}`, async () => {
    const current = await requireSession(kernel.store, session);

    const record = {
      ...current.record,
      heads: current.record.heads.map((other) =>
        other.name === head ? { ...other, selected } : other,
      ),
    };

    const outcome = await commit(kernel, [
      {
        name: sessionRef(session),
        target: await put(kernel.store, "session", record),
        expect: current.ref.revision,
        events: [{ head, kind: "configured", selected, effective: selected }],
      },
    ]);

    return outcome.kind === "set" ? true : STALE;
  });

  if (patch.settings !== undefined)
    await settingsConfigured(kernel, session, Object.keys(patch.settings));
  const ref = await kernel.store.refs.get(headRef(session, head));

  return { kind: "configured", selected, revision: ref?.revision ?? EMPTY_REVISION };
}
