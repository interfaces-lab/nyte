import type { Renderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, ErrorBoundary, on, onCleanup, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import type { PartMessage } from "../../lib/view-helpers.ts";

function Mounted(props: { readonly node: Renderable }): JSX.Element {
  return (
    <box
      flexDirection="column"
      width="100%"
      ref={(box) => {
        box.add(props.node);
        onCleanup(() => {
          box.remove(props.node);
          props.node.destroyRecursively();
        });
      }}
    />
  );
}

export function PluginPart(props: { readonly message: PartMessage }): JSX.Element {
  const app = useApp();

  const drawn = createMemo(
    on(
      () => props.message.version,
      () => app.kit.drawPart(props.message),
    ),
  );

  const fallback = (): JSX.Element => (
    <text id={`part:${props.message.id}`} fg={app.kit.theme().dim} wrapMode="word">
      {`[${props.message.partKind}]`}
    </text>
  );

  return (
    <ErrorBoundary
      fallback={(error: unknown) => {
        app.kit.report("plugin", error);

        return fallback();
      }}
    >
      <Show when={drawn()} fallback={fallback()}>
        {(node: Accessor<Renderable>) => <Mounted node={node()} />}
      </Show>
    </ErrorBoundary>
  );
}
