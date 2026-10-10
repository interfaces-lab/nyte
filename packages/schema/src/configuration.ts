import type { ModelRef, Thinking } from "./models.ts";
import type { Json } from "./primitives.ts";

/**
 * Changes a head's selection one field at a time: omit a field to keep it,
 * pass null where allowed to clear an override.
 *
 * **Details**
 *
 * `configure` takes a patch and changes the head's durable selection. `send`
 * takes a patch or a {@link Configuration} and affects that input only. A
 * patch has no discriminant; a field typed `Configuration | ConfigurationPatch` narrows on `"kind" in value`.
 *
 * @see {@link Configuration} for what admission resolves it to
 * @category heads
 * @since 0.1.0
 */
export type ConfigurationPatch = {
  /** Omit = keep. A fast variant is a model ref, not a flag. */
  readonly model?: ModelRef;
  /** Omit = keep; null = clear the override, resolve the default at admission. */
  readonly thinking?: Thinking | null;
  /** Omit = keep; null = clear the override, resolve the default at admission. */
  readonly agent?: string | null;
  /** Session-scope plugin settings; merged per key, validated per schema. */
  readonly settings?: Readonly<Record<string, Json>>;
};

/**
 * Returns a fully resolved selection: what admission resolved, and what a
 * replaced message carries so an edit keeps its setup.
 *
 * @category heads
 * @since 0.1.0
 */
export type Configuration = {
  readonly kind: "exact";
  readonly model: ModelRef;
  readonly thinking: Thinking;
  /** Null = the built-in agent, as a value. */
  readonly agent: string | null;
  readonly settings: Readonly<Record<string, Json>>;
  /** Rejected if the host no longer has it; never silently re-resolved. */
  readonly settingsVersion: string;
};
