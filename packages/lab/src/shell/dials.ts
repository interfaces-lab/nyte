import { useDialKit } from "dialkit";
import type { DialConfig, ResolvedValues } from "dialkit";

export type { DialConfig, ResolvedValues, TransitionConfig } from "dialkit";

/**
 * A prototype's live controls, shown in the lab's inspector. Values and saved versions persist in
 * this browser under the panel's name; `onAction` receives an action control's path.
 */
export function useDials<T extends DialConfig>(
  name: string,
  config: T,
  onAction?: (action: string) => void,
): ResolvedValues<T> {
  return useDialKit(name, config, { id: name, persist: true, onAction });
}
