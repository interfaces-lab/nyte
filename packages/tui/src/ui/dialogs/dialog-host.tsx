/**
 * Draws `screen().dialog` by kind in its placement: the slot under the
 * composer, an overlay over the transcript, or the whole screen. Keys never
 * come from here: the keymap's dialog layer turns them into
 * `{ kind: "dialog", command }`, typed text included (`query`). Clicks on
 * rows dispatch `pick`. The dialog's frame takes focus while it shows, so a
 * terminal paste lands in its typed field.
 */
import { decodePasteBytes } from "@opentui/core";
import type { BoxRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { Match, onMount, Show, Switch } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import type { Dialog } from "../../model/dialogs/dialog.ts";
import { placement } from "../../model/dialogs/dialog.ts";
import { AuthView } from "./auth.tsx";
import { InspectorView } from "./inspector.tsx";
import { ListView } from "./list.tsx";
import { ModelPickerView } from "./model-picker.tsx";
import { TextPanel } from "./text-panel.tsx";
import { TreeView } from "./tree.tsx";

type Of<K extends Dialog["kind"]> = Accessor<Extract<Dialog, { readonly kind: K }>>;

function Body(props: { readonly dialog: Dialog }): JSX.Element {
  const app = useApp();
  const list = () => (props.dialog.kind === "list" ? props.dialog : null);
  const model = () => (props.dialog.kind === "model" ? props.dialog : null);
  const tree = () => (props.dialog.kind === "tree" ? props.dialog : null);
  const inspector = () => (props.dialog.kind === "inspector" ? props.dialog : null);
  const text = () => (props.dialog.kind === "text" ? props.dialog : null);
  const auth = () => (props.dialog.kind === "auth" ? props.dialog : null);
  let frame: BoxRenderable | undefined;

  onMount(() => frame?.focus());

  return (
    <box
      ref={(box) => (frame = box)}
      focusable
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      onPaste={(event) => {
        event.preventDefault();
        app.dispatch({
          kind: "dialog",
          command: { kind: "paste", text: decodePasteBytes(event.bytes) },
        });
      }}
    >
      <Switch>
        <Match when={list()}>{(dialog: Of<"list">) => <ListView dialog={dialog()} />}</Match>
        <Match when={model()}>
          {(dialog: Of<"model">) => <ModelPickerView dialog={dialog()} />}
        </Match>
        <Match when={tree()}>{(dialog: Of<"tree">) => <TreeView dialog={dialog()} />}</Match>
        <Match when={inspector()}>
          {(dialog: Of<"inspector">) => (
            <InspectorView
              dialog={dialog()}
              task={app.screen().tasks.find((task) => task.id === dialog().task) ?? null}
            />
          )}
        </Match>
        <Match when={text()}>{(dialog: Of<"text">) => <TextPanel dialog={dialog()} />}</Match>
        <Match when={auth()}>{(dialog: Of<"auth">) => <AuthView dialog={dialog()} />}</Match>
      </Switch>
    </box>
  );
}

export function DialogHost(): JSX.Element {
  const app = useApp();
  const dialog = () => app.screen().dialog;

  return (
    <Show when={dialog()}>
      {(current: Accessor<Dialog>) => (
        <Switch>
          <Match when={placement(current()) === "overlay"}>
            <box
              position="absolute"
              top={0}
              left={0}
              right={0}
              height="100%"
              zIndex={1}
              flexDirection="column"
              backgroundColor={app.kit.theme().background}
            >
              <Body dialog={current()} />
            </box>
          </Match>
          <Match when={placement(current()) === "screen"}>
            <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
              <Body dialog={current()} />
            </box>
          </Match>
          <Match when>
            <box flexDirection="column" flexShrink={0}>
              <Body dialog={current()} />
            </box>
          </Match>
        </Switch>
      )}
    </Show>
  );
}
