/**
 * The one spacing rule. Transcript columns are `<Column>`s: a flex column
 * with `gap={1}` and full width. Blocks never set margins, absolute
 * positions, translations or fixed widths; Yoga places siblings one after
 * another, so two blocks cannot overlap and a message that lands mid-turn
 * gets the same blank row above it as every other block.
 * test/ui/transcript/spacing.test.tsx fails the build if a transcript file sets
 * marginTop, marginBottom, position="absolute", translateY or a numeric width.
 */
import type { BoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";

export function Column(props: {
  readonly id?: string;
  readonly ref?: (node: BoxRenderable) => void;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <box id={props.id} ref={props.ref} flexDirection="column" width="100%" gap={1} flexShrink={0}>
      {props.children}
    </box>
  );
}
