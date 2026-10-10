import type { Disposer, SessionId, SettingInfo } from "@nyte-ai/schema";
import type { SettingsApi } from "./connection.ts";
import type { Kernel } from "./kernel.ts";
import type { Setting, SettingDefinition } from "./plugin.ts";

/** Names the layer a setting change landed in: the host value, or one session's. */
type SettingScope = { readonly kind: "host" } | { readonly kind: "session"; readonly session: SessionId };

/** Carries setting changes in this process: `apply` and `Setting.set` announce them; `Setting.watch` and the republishing of `HostView.settings` and catalogs listen. One per kernel, created on first use. */
interface SettingsBus {
  /** Calls every listener with the setting and the layer it changed in. */
  changed(id: string, scope: SettingScope): void;
  /** Calls the listener on every change; the disposer stops it. */
  subscribe(listener: (id: string, scope: SettingScope) => void): Disposer;
}

/** Returns the host's settings api. `apply(id, value)` finds the definition among the settings the live sessions' plugins contributed (`unknown` when none has the id), validates `value` against its schema (`invalid` with the issues as `ValidationIssue`s), stores it at `kvRef("host", "settings", id)` as a `kv` envelope, announces it on the settings bus, and republishes `HostView.settings` and the catalog of every live session that lists it. A session-scope setting's host value is what its sessions inherit until they configure their own. What `kernel.settings` holds. */
export function createSettingsApi(kernel: Kernel): SettingsApi {
  throw new Error("not implemented");
}

/** Returns a plugin's handle on its own setting, what `contribute.settings.add` returns. `get` resolves the session layer (a session-scope setting's value in the session's main head configuration, `settings[id]`), else the host value, else `definition.default`; `set` validates, then stores a host-scope value as `apply` does, or configures the session's main head with `{ settings: { [id]: value } }`, and announces it; `watch` yields the current value, then the value after each change the bus announces for this id, until `signal` aborts (the plugin's deactivation). With `session` null only the host and default layers apply. */
export function settingHandle<T>(
  kernel: Kernel,
  definition: SettingDefinition<T>,
  input: { readonly owner: string; readonly session: SessionId | null; readonly signal: AbortSignal },
): Setting<T> {
  throw new Error("not implemented");
}

/** Returns every setting with its owner, JSON Schema (`jsonSchemaOf`), choices, current value and the layer that set it. With a session: the settings its plugins contributed, session layer included (`SessionCatalogView.settings`). With null: the host-scope settings across the live sessions, the first owner per id (`HostView.settings`). */
export function settingInfos(
  kernel: Kernel,
  session: SessionId | null,
): Promise<readonly SettingInfo[]> {
  throw new Error("not implemented");
}
