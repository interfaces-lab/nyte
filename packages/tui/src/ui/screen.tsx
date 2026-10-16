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

    if (dialog === null) return null;

    const task =
      dialog.kind === "inspector"
        ? (screen().tasks.find((candidate) => candidate.id === dialog.task) ?? null)
        : null;

    return placement(dialog, task);
  };

  return (
    <box
      id="app"
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={app.kit.theme().backdrop}
    >
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
          onRevealLater={() => app.dispatch({ kind: "reveal-later" })}
          onPaste={(event) => {
            app.dispatch({ kind: "focus-composer" });
            app.dispatch({ kind: "paste", source: pasteMessage(event) });
          }}
        />
        <Show when={screen().welcome || screen().opening}>
          <Welcome opening={screen().opening} />
        </Show>
      </box>
      <box
        id="live"
        width="100%"
        flexShrink={0}
        flexDirection="column"
        visible={where() !== "screen"}
        backgroundColor={app.kit.theme().backdrop}
      >
        <Show when={!tiny() && screen().dialog === null}>
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
          <NoticeLine />
          <Switch>
            <Match when={screen().completion}>
              {(model: Accessor<CompletionModel>) => <CompletionMenu model={model()} />}
            </Match>
            <Match when={where() === "slot"}>
              <DialogHost />
            </Match>
          </Switch>
        </Show>
      </box>
      <Show when={!tiny() && screen().dialog === null}>
        <Hints />
      </Show>
    </box>
  );
}
