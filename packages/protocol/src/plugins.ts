/**
 * What the `plugins` namespace answers with: inventory, commands, settings.
 * Authoring a plugin (`Plugin`, `SessionApi`, registries) is host-side and
 * stays in `@nyte-ai/core/plugins`.
 */
import type { Skill } from "@nyte-ai/schema";
import type { Choice } from "./ui.ts";

/** Where a plugin came from. Later sources replace earlier ones with the same id. */
export type PluginSource = "builtin" | "user" | "project" | "inline";

export type PluginInfo = {
  readonly id: string;
  readonly version: string;
  readonly source: PluginSource;
  readonly path?: string;
} & ({ readonly status: "active" } | { readonly status: "failed"; readonly error: string });

export interface SettingChoice extends Choice {
  /** Badge a client shows while this choice is current. A choice without one contributes nothing. */
  readonly status?: string;
}

/** A declared setting with its owner and current choice resolved. What a client renders. */
export interface SettingInfo {
  readonly id: string;
  /** Plugin that contributed the setting's current definition. */
  readonly owner: string;
  readonly label: string;
  readonly choices: readonly [SettingChoice, ...SettingChoice[]];
  /** Choice id, read from plugin storage at list time. */
  readonly current: string;
}

export interface CommandInfo {
  readonly name: string;
  readonly owner: string;
  readonly description: string;
}

export interface PluginCatalog {
  readonly plugins: readonly PluginInfo[];
  readonly commands: readonly CommandInfo[];
  readonly skills: readonly Skill[];
  /** Default choices for a new session; changes belong to an existing session. */
  readonly settings: readonly SettingInfo[];
}

export type CommandOutcome =
  | { readonly kind: "ran"; readonly output?: string }
  /** The command answered with a message for the client to send as the user. */
  | { readonly kind: "prompt"; readonly prompt: string }
  | { readonly kind: "not_found" }
  | { readonly kind: "failed"; readonly message: string };

export type ApplyOutcome =
  | { readonly kind: "applied" }
  | { readonly kind: "not_found" }
  | { readonly kind: "invalid_choice" };
