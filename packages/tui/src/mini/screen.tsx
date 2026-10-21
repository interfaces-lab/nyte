import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { createMemo, For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../app/context.tsx";
import { keycap } from "../lib/constants.ts";
import { displayWidth, truncateDisplay } from "../lib/width.ts";
import type { CompletionModel } from "../model/completion.ts";
import type { PreviewModel } from "../model/screen.ts";
import type { TurnStatus } from "../model/transcript.ts";
import { NoticeLine } from "../ui/chrome/notice.tsx";
import { TasksLine } from "../ui/chrome/tasks-line.tsx";
import { CompletionMenu } from "../ui/composer/completion.tsx";
import { Composer } from "../ui/composer/composer.tsx";
import { AttachmentPreview } from "../ui/composer/preview.tsx";
import { QueueRows } from "../ui/composer/queue.tsx";
import { DialogHost } from "../ui/dialogs/dialog-host.tsx";
import { Transcript } from "../ui/transcript/transcript.tsx";
import { TurnStatusRow } from "../ui/transcript/turn-status.tsx";
import { projectMiniTranscript } from "./transcript.ts";

export function MiniScreen(): JSX.Element {
  const app = useApp();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const screen = app.screen;
  const plan = createMemo(() => projectMiniTranscript(screen().transcript, screen().tasks));

  const terminalHeight = () => {
    dimensions();

    return renderer.terminalHeight;
  };

  const limit = () => Math.max(2, Math.floor((terminalHeight() * 2) / 3));

  const liveHeight = () => {
    const width = Math.max(1, dimensions().width - 4);

    const rows = plan().live.reduce(
      (sum, entry) =>
        sum +
        entry.content
          .split("\n")
          .reduce((count, line) => count + Math.max(1, Math.ceil(displayWidth(line) / width)), 0),
      0,
    );

    return Math.min(rows, Math.max(1, Math.floor(terminalHeight() / 4)));
  };

  const activity = () => {
    const status = plan().status;

    return status?.kind === "settled" || status?.kind === "unanswered" ? null : status;
  };

  const metadata = () => {
    const { model, effort } = screen().footer.powerline;
    const hints = screen().hints.filter((hint) => hint.tier === "primary");
    const width = Math.max(1, dimensions().width - 4);

    let text = truncateDisplay(
      screen().opening ? "Opening…" : (model ?? "Select a model with /model"),
      width,
    );

    for (const part of [effort, ...hints.map((hint) => `${hint.keycap} ${hint.label}`.trim())]) {
      if (part === undefined) continue;
      const next = `${text} · ${part}`;

      if (displayWidth(next) > width) break;
      text = next;
    }

    return text;
  };

  return (
    <box
      id="mini"
      width="100%"
      flexDirection="column"
      flexShrink={0}
      maxHeight={limit()}
      overflow="hidden"
      backgroundColor={app.kit.theme().backdrop}
      onSizeChange={function () {
        const height = Math.max(2, Math.min(limit(), Math.ceil(this.getComputedLayout().height)));

        if (renderer.footerHeight !== height) renderer.footerHeight = height;
      }}
    >
      <Show when={screen().dialog === null}>
        <Show when={plan().live.length > 0}>
          <scrollbox
            id="mini-stream"
            height={liveHeight()}
            minHeight={1}
            flexShrink={1}
            stickyScroll
            stickyStart="bottom"
            scrollbarOptions={{ visible: false }}
            marginLeft={2}
            marginRight={2}
          >
            <For each={plan().live}>
              {(entry) => (
                <text fg={app.kit.theme()[entry.style === "answer" ? "foreground" : entry.style]}>
                  {entry.content}
                </text>
              )}
            </For>
          </scrollbox>
        </Show>
        <Show when={activity()}>
          {(status: Accessor<TurnStatus>) => (
            <box marginLeft={2} flexShrink={0}>
              <TurnStatusRow status={status()} />
            </box>
          )}
        </Show>
        <Show when={screen().transcript.toolOutput === "expanded"}>
          <text fg={app.kit.theme().dim} marginLeft={2} height={1} flexShrink={0}>
            {`Tool output · ${keycap("chat.tools.toggle")} close`}
          </text>
          <box height={Math.max(3, Math.floor(terminalHeight() / 3))} minHeight={1} flexShrink={1}>
            <Transcript
              model={() => screen().transcript}
              tasks={() => screen().tasks}
              attach={(port) => app.kit.attach.scroll(port)}
              onScrolled={(atBottom) => app.dispatch({ kind: "scrolled", atBottom })}
              onRevealEarlier={() => app.dispatch({ kind: "reveal-earlier" })}
              onRevealLater={() => app.dispatch({ kind: "reveal-later" })}
            />
          </box>
        </Show>
      </Show>
      <box flexDirection="column" flexShrink={0} visible={screen().dialog === null}>
        <QueueRows />
        <TasksLine />
        <Show when={screen().preview}>
          {(preview: Accessor<PreviewModel>) => (
            <AttachmentPreview marker={preview().marker} part={preview().part} />
          )}
        </Show>
        <Composer compact markers={screen().markers} />
        <Show when={screen().completion}>
          {(completion: Accessor<CompletionModel>) => <CompletionMenu model={completion()} />}
        </Show>
      </box>
      <Show when={screen().dialog !== null}>
        <DialogHost />
      </Show>
      <NoticeLine />
      <text
        id="mini-meta"
        height={1}
        flexShrink={0}
        wrapMode="none"
        fg={app.kit.theme().dim}
        marginLeft={2}
        marginRight={2}
      >
        {metadata()}
      </text>
    </box>
  );
}
