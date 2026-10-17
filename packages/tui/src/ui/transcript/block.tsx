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
