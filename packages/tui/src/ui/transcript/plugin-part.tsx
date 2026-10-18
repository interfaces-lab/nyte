import { isPart } from "@nyte-ai/plugin/client";
import { canvas } from "@nyte-ai/plugin/canvas/schema";
import type { Renderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, ErrorBoundary, on, onCleanup, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { readRawPart } from "@nyte-ai/plugin/client/presentation";
import type { PartMessage } from "@nyte-ai/plugin/client/presentation";
import { useApp } from "../../app/context.tsx";
import { GLYPHS } from "../../lib/constants.ts";

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

  const fallback = (): JSX.Element => {
    const { message } = props;

    if (!isPart(message, canvas))
      return (
        <text id={`part:${message.id}`} fg={app.kit.theme().dim} wrapMode="none" truncate>
          {`[${message.partKind}] ${readRawPart(message).body.replaceAll(/\s+/gu, " ").trim()}`}
        </text>
      );

    return (
      <text id={`part:${message.id}`} wrapMode="word">
        <span
          style={{ fg: app.kit.theme().foreground }}
        >{`${GLYPHS.diamond} ${message.state.title}`}</span>
        <span style={{ fg: app.kit.theme().dim }}>
          {message.state.error === null
            ? " · canvas · open this chat in Nyte desktop to view it"
            : " · canvas failed to render · open this chat in Nyte desktop to see why"}
        </span>
      </text>
    );
  };

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
