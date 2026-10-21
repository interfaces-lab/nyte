import type { ScrollBoxRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { createEffect, createMemo, createSignal, Match, on, Show, Switch } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { keycap } from "../../lib/constants.ts";
import { formatTiming } from "../../lib/format.ts";
import type { Task } from "../../lib/tasks.ts";
import {
  canStopTask,
  statusMark,
  taskAgent,
  taskConfiguration,
  taskLabel,
  taskStatus,
  taskTiming,
  unfinishedTask,
} from "../../lib/tasks.ts";
import type { InspectorDialog, InspectorScroll } from "../../model/dialogs/tasks.ts";
import { placement } from "../../model/dialogs/dialog.ts";
import type { ScrollPort } from "../../model/native.ts";
import type { TranscriptLocal } from "../../model/state.ts";
import { deriveTranscript } from "../../model/transcript.ts";
import type { TranscriptModel } from "../../model/transcript.ts";
import { Transcript } from "../transcript/transcript.tsx";
import { hint, joinHints, Note, Panel, useRowCap } from "./panel.tsx";

const NO_DISCLOSURES: ReadonlySet<string> = new Set();

function AgentTranscript(props: {
  readonly task: Extract<Task, { kind: "agent" }>;
  readonly dialog: InspectorDialog;
}): JSX.Element {
  const app = useApp();
  const renderer = useRenderer();
  const cap = useRowCap();
  let previous: TranscriptModel | null = null;
  let port: ScrollPort | null = null;

  const model = createMemo(() => {
    const local: TranscriptLocal = {
      following: props.dialog.following,
      window: { kind: "tail" },
      toolOutput: "expanded",
      disclosures: NO_DISCLOSURES,
    };

    previous = deriveTranscript(props.task.view ?? null, [], local, previous);

    return previous;
  });

  createEffect(
    on(
      () => props.dialog.scroll?.seq,
      () => {
        const request = props.dialog.scroll;

        if (request === null || port === null) return;

        switch (request.by) {
          case "line-up":
            port.by(-1);

            return;
          case "line-down":
            port.by(1);

            return;
          case "page-up":
            port.page(-1);

            return;
          case "page-down":
            port.page(1);

            return;
          case "bottom":
            port.latest();

            return;
          default: {
            const _exhaustive: never = request.by;

            throw new Error(_exhaustive);
          }
        }
      },
    ),
  );

  const transcript = (
    <Transcript
      model={model}
      attach={(handle) => {
        port = handle;

        return () => {
          port = null;
        };
      }}
      onScrolled={() => {}}
      onRevealEarlier={() => {}}
      onLatest={() =>
        app.dispatch({ kind: "dialog", command: { kind: "key", name: "chat.scroll.latest" } })
      }
    />
  );

  return renderer.screenMode === "split-footer" ? (
    <box height={cap()} minHeight={1} flexShrink={0}>
      {transcript}
    </box>
  ) : (
    transcript
  );
}

function JobOutput(props: {
  readonly task: Extract<Task, { kind: "job" }>;
  readonly dialog: InspectorDialog;
}): JSX.Element {
  const { kit } = useApp();
  const cap = useRowCap();
  const [contentRows, setContentRows] = createSignal(1);
  let scroll: ScrollBoxRenderable | undefined;

  const apply = (by: InspectorScroll): void => {
    if (scroll === undefined) return;

    switch (by) {
      case "line-up":
        scroll.scrollBy(-1);

        return;
      case "line-down":
        scroll.scrollBy(1);

        return;
      case "page-up":
        scroll.scrollBy(-0.5, "viewport");

        return;
      case "page-down":
        scroll.scrollBy(0.5, "viewport");

        return;
      case "bottom":
        scroll.scrollTo(scroll.scrollHeight);

        return;
      default: {
        const _exhaustive: never = by;

        throw new Error(_exhaustive);
      }
    }
  };

  createEffect(
    on(
      () => props.dialog.scroll?.seq,
      () => {
        if (props.dialog.scroll !== null) apply(props.dialog.scroll.by);
      },
    ),
  );

  return (
    <scrollbox
      ref={(box) => {
        scroll = box;
      }}
      height={Math.max(1, Math.min(contentRows(), cap()))}
      flexShrink={0}
      minHeight={1}
      scrollX={false}
      scrollY
      stickyScroll={props.dialog.following}
      stickyStart="bottom"
      paddingLeft={1}
      paddingRight={1}
    >
      <box
        flexShrink={0}
        onSizeChange={function () {
          setContentRows(this.height);
        }}
      >
        <text fg={kit.theme().foreground} wrapMode="word">
          {props.task.job.tail || "No output yet."}
        </text>
      </box>
    </scrollbox>
  );
}

const CLOCK_INTERVAL_MS = 1_000;

function metadata(task: Task, now: number): string {
  const timing = taskTiming(task);

  return [
    taskStatus(task),
    task.kind === "agent" ? taskConfiguration(task) : undefined,
    timing === null ? undefined : formatTiming(timing, now),
  ]
    .filter((value) => value !== undefined && value !== "")
    .join(" · ");
}

function TickingMetadata(props: { readonly task: Task }): JSX.Element {
  const { kit } = useApp();
  const tick = kit.ticker(CLOCK_INTERVAL_MS);

  const text = (): string => {
    tick();

    return metadata(props.task, kit.now());
  };

  return <Note text={text()} />;
}

function Metadata(props: { readonly task: Task }): JSX.Element {
  const { kit } = useApp();

  return (
    <Show
      when={unfinishedTask(props.task)}
      fallback={<Note text={metadata(props.task, kit.now())} />}
    >
      <TickingMetadata task={props.task} />
    </Show>
  );
}

export function InspectorView(props: {
  readonly dialog: InspectorDialog;
  readonly task: Task | null;
}): JSX.Element {
  const { kit } = useApp();
  const renderer = useRenderer();
  const theme = kit.theme;

  const hints = () =>
    joinHints([
      hint("picker.close", "back"),
      `${keycap("picker.previous", "symbol")}${keycap("picker.next", "symbol")} scroll`,
      `${keycap("picker.page.up")}/${keycap("picker.page.down")} page`,
      hint("chat.tools.toggle", "follow"),
      `${keycap("chat.message.previous", "symbol")}/${keycap("chat.message.next", "symbol")} task`,
      ...(props.task !== null && canStopTask(props.task) ? [hint("chat.task.stop", "cancel")] : []),
    ]);

  return (
    <Panel
      title="Tasks"
      hints={hints()}
      fill={
        renderer.screenMode !== "split-footer" && placement(props.dialog, props.task) === "screen"
      }
    >
      <Show when={props.task} fallback={<Note text={`${props.dialog.task} · Loading…`} />}>
        {(task: Accessor<Task>) => {
          const mark = () => statusMark(taskStatus(task()));

          const agent = () => {
            const current = task();

            return current.kind === "agent" ? current : null;
          };

          const job = () => {
            const current = task();

            return current.kind === "job" ? current : null;
          };

          return (
            <>
              <text height={1} wrapMode="none" selectable={false} flexShrink={0}>
                <span style={{ fg: theme()[mark().tone] }}>{mark().glyph}</span>
                <span style={{ fg: theme().foreground }}>{` ${taskAgent(task())}`}</span>
                <span style={{ fg: theme().muted }}> │ </span>
                <span style={{ fg: theme().foreground }}>{taskLabel(task())}</span>
              </text>
              <Metadata task={task()} />
              <Switch>
                <Match when={agent()}>
                  {(child: Accessor<Extract<Task, { kind: "agent" }>>) => (
                    <Show when={child().view} fallback={<Note text="Loading…" />}>
                      <AgentTranscript task={child()} dialog={props.dialog} />
                    </Show>
                  )}
                </Match>
                <Match when={job()}>
                  {(command: Accessor<Extract<Task, { kind: "job" }>>) => (
                    <JobOutput task={command()} dialog={props.dialog} />
                  )}
                </Match>
              </Switch>
            </>
          );
        }}
      </Show>
    </Panel>
  );
}
