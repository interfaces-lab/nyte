/**
 * The layout, top to bottom: loading line, the transcript (or a `screen`
 * dialog in its place, or an `overlay` dialog over it), then the live column:
 * reports, queue rows, tasks line, composer with its powerline rule, the
 * slot (completion, a `slot` dialog, or the notice line), hints. Heights come
 * from Yoga; nothing here measures in a frame callback. The transcript and
 * the composer stay mounted behind a screen dialog, so the scroll position
 * and the draft survive it.
 */
import { useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { Match, Show, Switch } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../app/context.tsx";
import { placement } from "../model/dialogs/dialog.ts";
import type { CompletionModel } from "../model/completion.ts";
import type { PreviewModel } from "../model/screen.ts";
import { Hints } from "./chrome/hints.tsx";
import { NoticeLine } from "./chrome/notice.tsx";
import { TasksLine } from "./chrome/tasks-line.tsx";
import { Welcome } from "./chrome/welcome.tsx";
import { CompletionMenu } from "./composer/completion.tsx";
import { Composer, pasteMessage } from "./composer/composer.tsx";
import { AttachmentPreview } from "./composer/preview.tsx";
import { QueueRows } from "./composer/queue.tsx";
import { DialogHost } from "./dialogs/dialog-host.tsx";
import { Transcript } from "./transcript/transcript.tsx";

export function Screen(): JSX.Element {
  const app = useApp();
  const dimensions = useTerminalDimensions();
  const screen = app.screen;
  const tiny = () => dimensions().height <= 3;

  const where = () => {
    const dialog = screen().dialog;

    return dialog === null ? null : placement(dialog);
  };

  return (
    <box
      id="app"
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={app.kit.theme().background}
    >
      <Show when={dimensions().height >= 5 ? screen().loading : null}>
        {(loading: Accessor<string>) => (
          <text
            id="session-loading"
            fg={app.kit.theme().dim}
            height={1}
            flexShrink={0}
            marginLeft={3}
          >
            {loading()}
          </text>
        )}
      </Show>
      <Show when={where() === "screen"}>
        <box id="screen" flexGrow={1} minHeight={0} flexDirection="column">
          <DialogHost />
        </box>
      </Show>
      <box id="conversation" flexGrow={1} minHeight={0} visible={where() !== "screen" && !tiny()}>
        <Transcript
          model={() => screen().transcript}
          tasks={() => screen().tasks}
          accelerated={() => screen().scrollAcceleration}
          attach={(port) => app.kit.attach.scroll(port)}
          onScrolled={(atBottom) => app.dispatch({ kind: "scrolled", atBottom })}
          onRevealEarlier={() => app.dispatch({ kind: "reveal-earlier" })}
          onPaste={(event) => {
            app.dispatch({ kind: "focus-composer" });
            app.dispatch({ kind: "paste", source: pasteMessage(event) });
          }}
        />
        <Show when={screen().welcome}>
          <Welcome />
        </Show>
        <Show when={where() === "overlay"}>
          <box id="overlay" position="absolute" top={0} right={0} bottom={0} left={0}>
            <DialogHost />
          </box>
        </Show>
      </box>
      <box
        id="live"
        width="100%"
        flexShrink={0}
        flexDirection="column"
        visible={where() !== "screen"}
        backgroundColor={app.kit.theme().background}
      >
        <Show when={!tiny()}>
          <QueueRows />
          <TasksLine />
          <Show when={screen().preview}>
            {(preview: Accessor<PreviewModel>) => (
              <AttachmentPreview marker={preview().marker} part={preview().part} />
            )}
          </Show>
        </Show>
        <Composer markers={screen().markers} />
        <Show when={!tiny()}>
          <Switch fallback={<NoticeLine />}>
            <Match when={screen().completion}>
              {(model: Accessor<CompletionModel>) => <CompletionMenu model={model()} />}
            </Match>
            <Match when={where() === "slot"}>
              <DialogHost />
            </Match>
          </Switch>
        </Show>
      </box>
      <Show when={!tiny()}>
        <Hints />
      </Show>
    </box>
  );
}
