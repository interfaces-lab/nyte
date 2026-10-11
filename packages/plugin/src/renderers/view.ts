import type { Part, PartDefinition, PartState, Renderer } from "@nyte-ai/core";

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
export function view<K extends PartDefinition, View>(
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

      return checked instanceof Promise || checked.issues !== undefined ? unreadable(kind.kind) : draw(checked.value, act);
    },
  };
}
