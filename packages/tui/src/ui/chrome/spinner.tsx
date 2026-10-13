/**
 * A `<text>` whose content is `SPINNER_FRAMES[tick % n]` from the shared
 * 130 ms ticker. No native buffer calls, no frame callback; nothing to throw
 * inside `flushVisual`.
 */
import type { JSX } from "@opentui/solid";
import { useApp } from "../../app/context.tsx";
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "../../lib/constants.ts";

export function Spinner(props: { readonly color?: string }): JSX.Element {
  const { kit } = useApp();
  const tick = kit.ticker(SPINNER_INTERVAL_MS);

  return (
    <text fg={props.color ?? kit.theme().running} selectable={false} wrapMode="none" flexShrink={0}>
      {SPINNER_FRAMES[tick() % SPINNER_FRAMES.length]}
    </text>
  );
}
