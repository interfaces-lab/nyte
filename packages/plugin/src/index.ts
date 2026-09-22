/** The core session-plugin contract and shared host provider helpers. */
export * from "@nyte-ai/core/plugins";

export { providerPlugin, type ProviderPlugin } from "./provider.ts";

import type { CliRenderer, Renderable, TextOptions } from "@opentui/core";
import type { JsonValue } from "@nyte-ai/schema";
import type { Nyte, SessionEvent, SessionId } from "@nyte-ai/core";

/** Based on OpenCode's V2 TUI plugin definition and context, merged in #39776. */
export type Cleanup = () => Promise<void> | void;

export type SlotName = "session.composer.top";

export type Slot = (props: { readonly sessionID: SessionId }) => Renderable;

export interface Context {
  readonly renderer: CliRenderer;
  readonly theme: Pick<TextOptions, "fg" | "bg">;
  readonly client: Nyte;
  readonly data: { listen(handler: (event: SessionEvent) => void): Cleanup };
  readonly storage: {
    /** JSON state owned by this plugin, retained across source reloads. */
    memory(
      key: string,
      options: { readonly initial: JsonValue },
    ): readonly [() => JsonValue, (value: JsonValue) => void];
  };
  readonly ui: {
    slot(name: SlotName, render: Slot): Cleanup;
    readonly toast: { show(options: { readonly message: string }): void };
  };
}

export interface Definition {
  readonly id: string;
  readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void;
}

export function define(plugin: Definition): Definition {
  return plugin;
}
