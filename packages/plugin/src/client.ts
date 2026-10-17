import type { Part, PartDefinition, PartState, Renderer } from "@nyte-ai/core";
import type {
  HookEntry as SideHookEntry,
  HookHandler as SideHookHandler,
  HookName as SideHookName,
  Plugin as CorePlugin,
  PluginApi as CorePluginApi,
} from "@nyte-ai/core";

export { branchSummary, compaction, definePart, isPart, text, thinking, tool } from "@nyte-ai/core";
export type {
  ClientApi,
  Command,
  Keybinding,
  Part,
  PartDefinition,
  PartState,
  Renderer,
  SettingDefinition,
} from "@nyte-ai/core";

/**
 * A client plugin: once per app, with renderers, commands, settings,
 * keybindings and client hooks. It declares the frameworks it renders for;
 * the client mounts what it can.
 *
 * @category plugins
 * @since 0.1.0
 */
export type Plugin = CorePlugin<"client">;

/**
 * What a client plugin's `activate` and hook handlers receive: the app's
 * connection, the session on screen and notifications.
 *
 * @category plugins
 * @since 0.1.0
 */
export type PluginApi = CorePluginApi<"client">;

/**
 * Names a hook a client plugin may handle.
 *
 * @category hooks
 * @since 0.1.0
 */
export type HookName = SideHookName<"client">;

/**
 * Returns a client hook handler's signature.
 *
 * @category hooks
 * @since 0.1.0
 */
export type HookHandler<N extends HookName> = SideHookHandler<"client", N>;

/**
 * Returns a client hook entry: a handler, or a handler with an order.
 *
 * @category hooks
 * @since 0.1.0
 */
export type HookEntry<N extends HookName> = SideHookEntry<"client", N>;

/**
 * Returns a renderer for one part kind whose `draw` gets the state checked
 * against the kind's schema, typed; a state the schema rejects draws
 * `unreadable`. The untyped `Renderer` is what a client mounts: a typed
 * `Renderer<K>` is not assignable to it while the untyped `act` carries no
 * action outputs (Part 2 §32), so the check is also the narrowing.
 *
 * @category plugins
 * @since 0.1.0
 */
export function defineRenderer<K extends PartDefinition, View>(
  kind: K,
  framework: string,
  draw: (state: PartState<K>, act: Part<PartDefinition>["act"]) => View,
  unreadable: (kind: string) => View,
): Renderer {
  return {
    kind,
    framework,
    render(part, act) {
      const checked = kind.state["~standard"].validate(part.state);

      return checked instanceof Promise || checked.issues !== undefined
        ? unreadable(kind.kind)
        : draw(checked.value, act);
    },
  };
}
