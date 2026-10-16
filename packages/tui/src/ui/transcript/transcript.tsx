import { MacOSScrollAccel } from "@opentui/core";
import type {
  BoxRenderable,
  PasteEvent,
  Renderable,
  ScrollAcceleration,
  ScrollBoxRenderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { GLYPHS, keycap, TRANSCRIPT_BOTTOM_PADDING } from "../../lib/constants.ts";
import type { Task } from "../../lib/tasks.ts";
import type { ScrollPort } from "../../model/native.ts";
import type { Row, TranscriptModel } from "../../model/transcript.ts";
import { Column } from "./block.tsx";
import { Keyed, sameItems } from "./keyed.tsx";
import { RowView } from "./row.tsx";
import { TranscriptScopeProvider } from "./scope.tsx";

export interface TranscriptProps {
  readonly model: Accessor<TranscriptModel>;
  readonly tasks?: Accessor<readonly Task[]>;
  readonly attach: (port: ScrollPort) => () => void;
  readonly onScrolled: (atBottom: boolean) => void;
  readonly onRevealEarlier: () => void;
  readonly onRevealLater?: () => void;
  readonly onLatest?: () => void;
  readonly onPaste?: (event: PasteEvent) => void;
  readonly accelerated?: Accessor<boolean>;
}

const FIXED_SCROLL_STEP: ScrollAcceleration = { tick: () => 3, reset: () => undefined };

const NO_TASKS: readonly Task[] = [];

const NO_ROWS: readonly Row[] = [];

const SCROLL_EDGE_THRESHOLD = 1;

const SETTLE_FRAMES = 3;

export function Transcript(props: TranscriptProps): JSX.Element {
  const app = useApp();
  const { kit } = app;
  const renderer = useRenderer();
  const anchors = new Map<string, BoxRenderable>();
  const [hovered, setHovered] = createSignal(false);
  let box: ScrollBoxRenderable | undefined;
  let reported: boolean | null = null;
  let held: { readonly node: BoxRenderable; readonly offset: number } | null = null;
  const tasks = createMemo(() => props.tasks?.() ?? NO_TASKS);

  const acceleration = createMemo((): ScrollAcceleration =>
    props.accelerated?.() === true ? new MacOSScrollAccel() : FIXED_SCROLL_STEP,
  );

  const rows = createMemo(
    () => {
      const model = props.model();

      return model.rows.slice(model.window.start, model.window.end);
    },
    NO_ROWS,
    { equals: sameItems },
  );

  const report = (): void => {
    if (box === undefined || box.isDestroyed) return;
    const value = box.scrollTop >= box.scrollHeight - box.viewport.height - SCROLL_EDGE_THRESHOLD;

    if (value === reported) return;
    reported = value;
    props.onScrolled(value);
  };

  const later = (): void => queueMicrotask(report);

  const layoutTop = (node: Renderable): number => {
    let top = 0;
    let current: Renderable | null = node;

    while (current !== null && current !== box?.content) {
      top += current.getComputedLayout().top;
      current = current.parent;
    }

    return top;
  };

  const scrollTo = (position: number): void => {
    box?.scrollTo(Math.max(0, position));
    later();
  };

  const reveal = (direction: -1 | 1): void => {
    if (box === undefined) return;
    const { rows: all, window } = props.model();

    if (direction === -1 && window.start > 0 && box.scrollTop <= box.viewport.height)
      props.onRevealEarlier();

    if (
      direction === 1 &&
      window.end < all.length &&
      box.scrollTop + 2 * box.viewport.height >= box.scrollHeight
    )
      props.onRevealLater?.();
  };

  const settle = (): void => {
    if (box !== undefined && held !== null && !held.node.isDestroyed)
      box.scrollTo(Math.max(0, layoutTop(held.node) - held.offset));
  };

  const release = (frames: number): void => {
    renderer.requestAnimationFrame(() => {
      settle();

      if (frames > 1) {
        release(frames - 1);

        return;
      }

      held = null;

      if (box !== undefined) box.stickyScroll = true;
      report();
    });
  };

  const contentResized = (): void => {
    settle();
    report();
  };

  const port: ScrollPort = {
    page(direction) {
      if (box === undefined) return;
      box.scrollBy(direction * Math.max(1, Math.floor(box.viewport.height / 2)));
      reveal(direction);
      later();
    },
    by(lines) {
      if (box === undefined) return;
      box.scrollBy(lines);
      later();
    },
    latest() {
      if (box === undefined) return;
      box.scrollTo(box.scrollHeight);
      box.stickyScroll = true;
      later();
    },
    row(key) {
      const node = anchors.get(key);

      if (node !== undefined) scrollTo(layoutTop(node));
    },
    keepViewport() {
      if (box === undefined) return;
      const top = box.scrollTop;

      const node = rows()
        .map((row) => anchors.get(row.key))
        .find(
          (candidate) => candidate !== undefined && layoutTop(candidate) + candidate.height > top,
        );

      if (node === undefined) return;

      const pending = held === null;
      held = { node, offset: layoutTop(node) - top };
      box.stickyScroll = false;

      if (pending) release(SETTLE_FRAMES);
    },
    turn(direction) {
      if (box === undefined) return;
      const top = box.scrollTop;

      const tops = rows().flatMap((row) => {
        const node = row.kind === "turn" ? anchors.get(row.key) : undefined;

        return node === undefined ? [] : [layoutTop(node)];
      });

      const target =
        direction === 1
          ? tops.find((candidate) => candidate > top)
          : tops.findLast((candidate) => candidate < top);

      if (target !== undefined) scrollTo(target);
    },
  };

  onMount(() => onCleanup(props.attach(port)));

  return (
    <TranscriptScopeProvider scope={{ model: props.model, tasks }}>
      <box flexGrow={1} minHeight={0} flexDirection="column" width="100%">
        <scrollbox
          id="transcript"
          ref={(node) => {
            box = node;
            node.content.on("resize", contentResized);
            node.viewport.on("resize", report);
            onCleanup(() => {
              node.content.off("resize", contentResized);
              node.viewport.off("resize", report);
            });
          }}
          stickyScroll
          stickyStart="bottom"
          viewportCulling
          scrollX={false}
          scrollY
          flexGrow={1}
          minHeight={0}
          paddingTop={1}
          paddingLeft={1}
          paddingRight={1}
          paddingBottom={TRANSCRIPT_BOTTOM_PADDING}
          scrollAcceleration={acceleration()}
          onPaste={(event) => {
            if (props.onPaste === undefined) return;
            event.preventDefault();
            props.onPaste(event);
          }}
          onMouse={later}
          onMouseScroll={(event) => {
            if (event.scroll?.direction === "up") reveal(-1);

            if (event.scroll?.direction === "down") reveal(1);
            later();
          }}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: kit.theme().scrollbarTrack,
              foregroundColor: kit.theme().scrollbarThumb,
            },
          }}
        >
          <Column>
            <Show when={props.model().window.start > 0}>
              <text fg={kit.theme().dim} selectable={false} wrapMode="none">
                {`${GLYPHS.steer} ${String(props.model().window.start)} earlier · scroll up`}
              </text>
            </Show>
            <Keyed each={rows()} by={(row) => row.key}>
              {(row) => (
                <RowView
                  row={row}
                  anchor={(node) => {
                    const { key } = row();
                    anchors.set(key, node);
                    onCleanup(() => anchors.delete(key));
                  }}
                />
              )}
            </Keyed>
            <Show when={props.model().rows.length - props.model().window.end}>
              {(count: Accessor<number>) => (
                <text fg={kit.theme().dim} selectable={false} wrapMode="none">
                  {`${String(count())} later · scroll down`}
                </text>
              )}
            </Show>
          </Column>
        </scrollbox>
        <Show when={!props.model().following}>
          <box
            height={1}
            flexShrink={0}
            flexDirection="row"
            justifyContent="flex-end"
            paddingRight={2}
          >
            <box
              paddingLeft={1}
              onMouseOver={() => setHovered(true)}
              onMouseOut={() => setHovered(false)}
              onMouseUp={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();

                if (props.onLatest === undefined) app.dispatch({ kind: "scroll", to: "latest" });
                else props.onLatest();
              }}
            >
              <text fg={hovered() ? kit.theme().accent : kit.theme().dim} selectable={false}>
                {`${keycap("chat.scroll.latest")} latest ↓`}
              </text>
            </box>
          </box>
        </Show>
      </box>
    </TranscriptScopeProvider>
  );
}
