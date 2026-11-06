import type { JSX } from "@opentui/solid";
import { createMemo, For, Show } from "solid-js";
import type { Accessor } from "solid-js";

export function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function Keyed<T extends object>(props: {
  readonly each: readonly T[];
  readonly by: (item: T) => string;
  readonly children: (item: Accessor<T>) => JSX.Element;
}): JSX.Element {
  const keys = createMemo(() => props.each.map(props.by), [], { equals: sameItems });
  const items = createMemo(() => new Map(props.each.map((item) => [props.by(item), item])));

  return (
    <For each={keys()}>
      {(key) => {
        const item = createMemo(() => items().get(key));

        return <Show when={item()}>{(current: Accessor<T>) => props.children(current)}</Show>;
      }}
    </For>
  );
}
