/**
 * User-scoped model preferences: which providers are on, which models each
 * provider hides from the picker, and what a new chat starts with. Stored in
 * `~/.nyte` beside the credential and catalog stores. A damaged file reads as
 * empty and heals on the next write: a preference is UX, not a security gate.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { schemas } from "@nyte-ai/protocol";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import type { PreferenceChange } from "../shared/ipc.ts";

const preferencesType = Type.Object({
  providers: Type.Optional(
    Type.Record(
      Type.String(),
      Type.Object({
        enabled: Type.Optional(Type.Boolean()),
        hiddenModels: Type.Optional(Type.Array(Type.String())),
      }),
    ),
  ),
  defaults: Type.Optional(
    Type.Object({
      model: Type.Optional(Type.Object({ provider: Type.String(), id: Type.String() })),
      thinkingLevel: Type.Optional(schemas.ThinkingLevel),
    }),
  ),
});

const preferencesFile = Compile(preferencesType);

export type ModelPreferences = Required<Static<typeof preferencesType>>;

export const EMPTY_MODEL_PREFERENCES: ModelPreferences = {
  providers: {},
  defaults: {},
};

export function parseModelPreferences(text: string): ModelPreferences {
  try {
    const { providers = {}, defaults = {} } = preferencesFile.Parse(JSON.parse(text));

    return { providers, defaults };
  } catch {
    return EMPTY_MODEL_PREFERENCES;
  }
}

export function applyPreferenceChange(
  preferences: ModelPreferences,
  change: PreferenceChange,
): ModelPreferences {
  switch (change.kind) {
    case "provider": {
      const current = preferences.providers[change.provider] ?? {};

      return {
        ...preferences,
        providers: {
          ...preferences.providers,
          [change.provider]: { ...current, enabled: change.enabled },
        },
      };
    }

    case "models": {
      const current = preferences.providers[change.provider] ?? {};
      const changed = new Set(change.ids);
      const hiddenModels = (current.hiddenModels ?? []).filter((id) => !changed.has(id));

      if (change.hidden) hiddenModels.push(...changed);

      return {
        ...preferences,
        providers: { ...preferences.providers, [change.provider]: { ...current, hiddenModels } },
      };
    }

    case "defaults":
      return {
        ...preferences,
        defaults: {
          model: change.model ?? preferences.defaults.model,
          thinkingLevel: change.thinkingLevel ?? preferences.defaults.thinkingLevel,
        },
      };
    default: {
      const _exhaustive: never = change;

      return _exhaustive;
    }
  }
}

/** Serializes read-modify-write so two windows cannot lose each other's changes. */
export class ModelPreferencesStore {
  private readonly path: string;
  private tail: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  read(): Promise<ModelPreferences> {
    return this.serialized(() => this.load());
  }

  update(change: PreferenceChange): Promise<ModelPreferences> {
    return this.serialized(async () => {
      const next = applyPreferenceChange(await this.load(), change);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await writeFile(this.path, `${JSON.stringify(next, null, 2)}\n`);

      return next;
    });
  }

  private async load(): Promise<ModelPreferences> {
    try {
      return parseModelPreferences(await readFile(this.path, "utf8"));
    } catch {
      return EMPTY_MODEL_PREFERENCES;
    }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }
}
