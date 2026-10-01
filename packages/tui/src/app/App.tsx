/**
 * The screen: a transcript with a welcome over it while empty, a one-row
 * latest control, and an opaque live column with the pending gutter, composer,
 * status rule, ephemeral slot, and hints. Every region has its own rows. Opening a notice or picker shrinks the
 * transcript viewport, whose exact text anchor keeps history in place.
 */
import {
  RenderableEvents,
  BoxRenderable,
  type Renderable,
  type CliRenderer,
  type ScrollBoxRenderable,
  type TextareaRenderable,
  type TextRenderable,
} from "@opentui/core";
import { onBlur, onFocus, render, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import {
  COMPOSER_PLACEHOLDER,
  keycap,
  keyStrokes,
  TRANSCRIPT_BOTTOM_PADDING,
} from "../constants.ts";
import { createScrollAcceleration } from "../scrolling.ts";
import { createChatKeymap } from "../keymap.ts";
import { LabelSyntax } from "../label-syntax.ts";
import type { DeliveryChoices } from "../lanes.ts";
import { PendingGutter } from "../pending-gutter.ts";
import { PendingTail } from "../pending-tail.ts";
import type { ActiveCliTheme, CliTheme } from "../theme.ts";
import { ToolOutputExpansion, type Transcript } from "../surface.ts";
import { Timeline } from "../timeline.ts";
import { createSubtleSyntaxStyle, createSyntaxStyle } from "../transcript.ts";
import {
  createUiStore,
  FocusController,
  framedPowerline,
  hintChunks,
  mergeCombiningMark,
  type Chunk,
  type Shell,
} from "./ui.ts";
import { MOON_FRAMES, MOON_RAMP } from "./moon.ts";
import { displayWidth } from "../width.ts";

const MAX_COMPOSER_ROWS = 8;

const MOON_FRAME_MS = 250;

/** The smallest screen that fits the moon beside the welcome and above the composer. */
const MOON_MIN_WIDTH = 80;

const MOON_MIN_HEIGHT = 30;

/** A row drawn as colored spans. */
function Spans(props: { readonly chunks: readonly Chunk[] }) {
  return (
    <For each={props.chunks}>{(chunk) => <span style={{ fg: chunk.fg }}>{chunk.text}</span>}</For>
  );
}

/** A color between two `#rrggbb` colors. */
function mix(from: string, to: string, amount: number): string {
  const channels = [1, 3, 5].map((start) => {
    const low = Number.parseInt(from.slice(start, start + 2), 16);
    const high = Number.parseInt(to.slice(start, start + 2), 16);

    return Math.round(low + (high - low) * amount)
      .toString(16)
      .padStart(2, "0");
  });

  return `#${channels.join("")}`;
}

/** The empty screen: the moon turning beside the ways in. */
function Welcome(props: { readonly theme: ActiveCliTheme; readonly visible: boolean }) {
  const dimensions = useTerminalDimensions();
  const [frame, setFrame] = createSignal(0);

  const showMoon = createMemo(
    () => dimensions().width >= MOON_MIN_WIDTH && dimensions().height >= MOON_MIN_HEIGHT,
  );

  createEffect(() => {
    if (!props.visible || !showMoon()) return;

    const timer = setInterval(
      () => setFrame((index) => (index + 1) % MOON_FRAMES.length),
      MOON_FRAME_MS,
    );

    onCleanup(() => clearInterval(timer));
  });

  // Earthshine grain takes the muted role; the brightest ground takes the moon's.
  const shades = createMemo(() =>
    Array.from({ length: MOON_RAMP.length }, (_, level) =>
      mix(props.theme.muted, props.theme.moon, (level / (MOON_RAMP.length - 1)) ** 0.7),
    ),
  );

  const rows = createMemo(() =>
    (MOON_FRAMES[frame()] ?? "").split("\n").map((line) => {
      const chunks: Chunk[] = [];

      for (const character of line) {
        const fg = shades()[MOON_RAMP.indexOf(character)] ?? props.theme.muted;
        const last = chunks.at(-1);

        if (last?.fg === fg) chunks[chunks.length - 1] = { fg, text: last.text + character };
        else chunks.push({ fg, text: character });
      }

      return chunks;
    }),
  );

  return (
    <box
      id="welcome"
      position="absolute"
      top={0}
      right={0}
      bottom={0}
      left={0}
      flexDirection="row"
      alignItems="center"
      justifyContent="center"
      gap={5}
      visible={props.visible}
    >
      <box flexDirection="column" flexShrink={0} visible={showMoon()}>
        <For each={rows()}>
          {(chunks) => (
            <text height={1} wrapMode="none" selectable={false}>
              <Spans chunks={chunks} />
            </text>
          )}
        </For>
      </box>
      <box flexDirection="column" flexShrink={0}>
        <text fg={props.theme.moon}>Welcome to Nyte</text>
        <text wrapMode="none">
          <span style={{ fg: props.theme.foreground }}>@</span>
          <span style={{ fg: props.theme.dim }}> for files · </span>
          <span style={{ fg: props.theme.foreground }}>!</span>
          <span style={{ fg: props.theme.dim }}> for shell</span>
        </text>
      </box>
    </box>
  );
}

/**
 * A host box whose only children are renderables adopted from the store. Not a
 * JSX child: the reconciler destroys a removed node on the next tick, and the
 * store hands out containers their owners keep (the completion dropdown holds
 * and releases the slot repeatedly).
 */
function adopt(host: BoxRenderable, child: () => BoxRenderable | undefined): void {
  createEffect((previous: BoxRenderable | undefined) => {
    if (previous !== undefined && previous.parent === host) host.remove(previous);
    const next = child();

    if (next !== undefined) host.add(next);

    return next;
  }, undefined);
}

function hasContent(node: Renderable): boolean {
  return node.visible && (!(node instanceof BoxRenderable) || node.getChildren().some(hasContent));
}

interface AppProps {
  readonly renderer: CliRenderer;
  readonly initialTheme: CliTheme;
  readonly roles: DeliveryChoices;
  readonly openPath: (path: string) => void;
  readonly onShell: (shell: Shell) => void;
}

function App(props: AppProps): BoxRenderable {
  const { renderer, roles, openPath } = props;
  const [ui, setUi] = createUiStore();
  const [theme, setTheme] = createStore<ActiveCliTheme>({ ...props.initialTheme });
  let counter = 0;
  const nextId = (prefix = "n"): string => `${prefix}-${String(counter++)}`;
  const userBlocks = new Set<BoxRenderable>();
  const userBlockWidth = (): number => Math.max(1, renderer.width - 4);
  const dimensions = useTerminalDimensions();
  const [inputFocused, setInputFocused] = createSignal(true);
  const [followingLatest, setFollowingLatest] = createSignal(true);
  const [latestHovered, setLatestHovered] = createSignal(false);
  const [transcriptEmpty, setTranscriptEmpty] = createSignal(true);
  const [inputRows, setInputRows] = createSignal(1);
  const [optionalRows, setOptionalRows] = createSignal(0);
  const inputWidthMethod = renderer.widthMethod;
  const pendingGutter = new PendingGutter(renderer, theme, roles, nextId);

  let root!: BoxRenderable;
  let scroll!: ScrollBoxRenderable;
  let input!: TextareaRenderable;
  let taskStatus!: TextRenderable;
  let pluginSlot!: BoxRenderable;
  let previewSlot!: BoxRenderable;
  let panelHost!: BoxRenderable;
  let screenHost!: BoxRenderable;
  let overlayHost!: BoxRenderable;
  let view!: Timeline;
  let acceleratedScrolling = false;
  const newScrollAcceleration = () => createScrollAcceleration(acceleratedScrolling);

  const tiny = createMemo(() => dimensions().height <= 3);
  const selecting = createMemo(
    () => ui.selecting && ui.slot.kind === "panel" && ui.overlay === undefined,
  );
  const layout = createMemo(() => {
    const height = dimensions().height;
    const loading = ui.loading !== undefined && height >= 5 ? 1 : 0;
    const hints = tiny() ? 0 : 1;
    const available = Math.max(0, height - loading - hints);
    const composer = ui.composerVisible && !(selecting() && height <= 8);
    const chrome = tiny() ? 0 : 2;
    const minimumComposer = composer ? chrome + 1 : 0;
    const cap =
      tiny() || (selecting() && height <= 8)
        ? available
        : Math.min(available, Math.max(minimumComposer, Math.floor((height * 2) / 3)));
    const requested =
      ui.slot.kind === "empty"
        ? 0
        : ui.slot.kind === "notice"
          ? ui.slot.notice.lines.length
          : ui.slot.rows;
    const slot =
      tiny() && !selecting() ? 0 : Math.max(0, Math.min(requested, cap - minimumComposer));
    const editor = composer ? Math.max(1, Math.min(inputRows(), cap - slot - chrome)) : 0;
    const optional =
      tiny() || selecting()
        ? 0
        : Math.max(0, Math.min(optionalRows(), cap - slot - editor - (composer ? chrome : 0)));
    return {
      loading,
      hints,
      composer,
      editor,
      optional,
      slot,
      live: optional + slot + editor + (composer ? chrome : 0),
    };
  });

  const noticeLines = createMemo(() =>
    ui.slot.kind === "notice" ? ui.slot.notice.lines.join("\n") : undefined,
  );

  const noticeColor = createMemo(() =>
    ui.slot.kind === "notice" ? (ui.slot.notice.color ?? theme.dim) : theme.dim,
  );

  const hints = createMemo(() => hintChunks(ui.hints, theme, dimensions().width - 2));

  // The rule stretches to the composer column: the screen minus its own margins.
  const powerline = createMemo(() =>
    framedPowerline(
      ui.status,
      Math.max(0, dimensions().width - 2),
      theme,
      inputFocused() ? theme.promptBorderFocused : theme.promptBorder,
    ),
  );

  const tree = (
    <box
      ref={(box) => (root = box)}
      id="app"
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={theme.background}
    >
      <text
        id="session-loading"
        fg={theme.dim}
        height={1}
        flexShrink={0}
        marginLeft={3}
        visible={layout().loading > 0}
      >
        {ui.loading ?? ""}
      </text>
      <box
        ref={(box) => (screenHost = box)}
        id="screen"
        flexGrow={1}
        minHeight={0}
        flexDirection="column"
        visible={ui.screen !== undefined}
      />
      <box
        id="conversation"
        flexGrow={1}
        minHeight={0}
        visible={ui.screen === undefined && !tiny()}
      >
        <scrollbox
          ref={(box) => (scroll = box)}
          id="transcript"
          flexGrow={1}
          minHeight={0}
          stickyScroll
          stickyStart="bottom"
          scrollX={false}
          scrollY
          paddingLeft={1}
          paddingRight={1}
          paddingBottom={TRANSCRIPT_BOTTOM_PADDING}
          onMouseScroll={() => view.beginManualScroll()}
          scrollAcceleration={newScrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.scrollbarTrack,
              foregroundColor: theme.scrollbarThumb,
            },
          }}
        />
        <Welcome theme={theme} visible={transcriptEmpty()} />
        <box
          id="latest"
          position="absolute"
          bottom={0}
          right={0}
          width="100%"
          height={1}
          flexShrink={0}
          flexDirection="row"
          justifyContent="flex-end"
          visible={ui.screen === undefined && !followingLatest() && !tiny() && !selecting()}
          paddingRight={2}
        >
          <box
            id="latest-control"
            paddingLeft={1}
            visible={!followingLatest()}
            onMouseOver={() => setLatestHovered(true)}
            onMouseOut={() => setLatestHovered(false)}
            onMouseUp={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              view.scrollToEnd();
            }}
          >
            <text
              id="latest-action"
              fg={latestHovered() ? theme.accent : theme.dim}
              selectable={false}
            >
              {`${keycap("chat.scroll.latest")} latest ↓`}
            </text>
          </box>
        </box>
      </box>
      <box
        id="live"
        width="100%"
        height={layout().live}
        flexShrink={0}
        flexDirection="column"
        visible={ui.screen === undefined}
        backgroundColor={theme.background}
      >
        <scrollbox
          id="optional"
          height={layout().optional}
          flexShrink={0}
          scrollX={false}
          scrollY
          visible={layout().optional > 0}
          verticalScrollbarOptions={{ visible: false }}
        >
          <box
            ref={(box) => (pluginSlot = box)}
            id="tui-plugins"
            width="100%"
            flexShrink={0}
            flexDirection="column"
          />
          {pendingGutter.container}
          <text
            ref={(text) => (taskStatus = text)}
            id="task-status"
            height={1}
            flexShrink={0}
            marginLeft={3}
            marginRight={2}
            wrapMode="none"
            truncate
            visible={false}
          />
          <box
            ref={(box) => (previewSlot = box)}
            id="preview-slot"
            width="100%"
            flexShrink={0}
            flexDirection="column"
          />
        </scrollbox>
        <box
          id="composer"
          width="100%"
          height={layout().editor + (tiny() ? 0 : 2)}
          flexShrink={0}
          flexDirection="column"
          visible={layout().composer}
        >
          <box
            id="input-box"
            // OpenTUI only highlights descendant focus on focusable boxes.
            focusable
            flexDirection="row"
            height={layout().editor + (tiny() ? 0 : 1)}
            flexShrink={0}
            border={tiny() ? [] : ["top", "right", "left"]}
            borderStyle="rounded"
            borderColor={theme.promptBorder}
            focusedBorderColor={theme.promptBorderFocused}
            titleColor={theme.dim}
            paddingLeft={1}
            paddingRight={1}
            marginLeft={1}
            marginRight={1}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              // Mouse auto-focus runs after bubbling and must not focus the border or
              // the disabled composer behind a panel.
              event.preventDefault();

              if (input.focusable) focusController.reset();
            }}
          >
            <text id="input-prompt" fg={theme.user} flexShrink={0} wrapMode="none">
              {ui.prompt}
            </text>
            <textarea
              ref={(area) => (input = area)}
              id="input"
              onKeyDown={(key) => mergeCombiningMark(input, key)}
              flexGrow={1}
              flexBasis={0}
              minWidth={1}
              height={Math.max(1, layout().editor)}
              flexShrink={0}
              wrapMode="word"
              placeholder={COMPOSER_PLACEHOLDER}
              placeholderColor={theme.dim}
              backgroundColor={theme.transparent}
              focusedBackgroundColor={theme.transparent}
              textColor={theme.foreground}
              focusedTextColor={theme.foreground}
              cursorColor={theme.user}
              selectionBg={theme.selectionBackground}
              selectionFg={theme.selectionForeground}
              keyBindings={[
                ...keyStrokes("chat.submit").map((key) => ({ ...key, action: "submit" as const })),
                ...keyStrokes("composer.newline").map((key) => ({
                  ...key,
                  action: "newline" as const,
                })),
              ]}
            />
          </box>
          <text
            id="powerline"
            visible={!tiny()}
            height={1}
            flexShrink={0}
            wrapMode="none"
            selectable={false}
            marginLeft={1}
            marginRight={1}
          >
            <Spans chunks={powerline()} />
          </text>
        </box>
        <box
          id="ephemeral"
          width="100%"
          height={layout().slot}
          flexShrink={0}
          flexDirection="column"
          visible={layout().slot > 0}
        >
          <scrollbox
            flexGrow={1}
            minHeight={0}
            scrollX={false}
            scrollY
            visible={noticeLines() !== undefined}
          >
            <text
              id="notice"
              fg={noticeColor()}
              flexShrink={0}
              wrapMode="none"
              marginLeft={3}
              marginRight={2}
            >
              {noticeLines() ?? ""}
            </text>
          </scrollbox>
          <box
            ref={(box) => (panelHost = box)}
            id="panel-host"
            width="100%"
            height="100%"
            minHeight={0}
            flexShrink={1}
            flexDirection="column"
            visible={ui.slot.kind === "panel"}
          />
        </box>
      </box>
      <text
        id="hints"
        height={1}
        wrapMode="none"
        truncate
        flexShrink={0}
        marginLeft={1}
        marginRight={1}
        visible={layout().hints > 0}
      >
        <Spans chunks={hints()} />
      </text>
      <box
        ref={(box) => (overlayHost = box)}
        id="overlay-host"
        position="absolute"
        width="100%"
        height="100%"
        visible={ui.screen === undefined && ui.overlay !== undefined}
      />
    </box>
  );

  adopt(panelHost, () => (ui.slot.kind === "panel" ? ui.slot.container : undefined));
  adopt(screenHost, () => ui.screen);
  adopt(overlayHost, () => ui.overlay);
  createEffect(() => renderer.setBackgroundColor(theme.terminal));
  createEffect(() => {
    void dimensions();

    for (const block of userBlocks) block.width = userBlockWidth();
    pendingGutter.resize();
  });

  const measureInput = (): void => {
    const width = Math.max(1, dimensions().width - (tiny() ? 4 : 6) - displayWidth(ui.prompt));
    const measured = input.editorView.measureForDimensions(width, MAX_COMPOSER_ROWS);
    setInputRows(
      Math.max(1, Math.min(MAX_COMPOSER_ROWS, measured?.lineCount ?? input.virtualLineCount)),
    );
  };
  input.on("line-info-change", measureInput);
  createEffect(measureInput);
  const measureOptional = async (): Promise<void> => {
    setOptionalRows(
      (hasContent(pluginSlot) ? Math.max(1, pluginSlot.height) : 0) +
        (pendingGutter.container.visible ? Math.max(1, pendingGutter.container.height) : 0) +
        (taskStatus.visible ? Math.max(1, taskStatus.height) : 0) +
        (hasContent(previewSlot) ? Math.max(1, previewSlot.height) : 0),
    );
  };
  renderer.setFrameCallback(measureOptional);
  onCleanup(() => {
    input.off("line-info-change", measureInput);
    renderer.removeFrameCallback(measureOptional);
  });

  const focusController = new FocusController(input);
  input.on(RenderableEvents.FOCUSED, () => setInputFocused(true));
  input.on(RenderableEvents.BLURRED, () => setInputFocused(false));
  onBlur(() => focusController.blur());
  onFocus(() => focusController.restore());
  onMount(() => focusController.restore());

  const transcript: Transcript = {
    renderer,
    container: scroll,
    syntaxStyle: createSyntaxStyle(theme),
    subtleSyntaxStyle: createSubtleSyntaxStyle(theme),
    theme,
    labelSyntax: new LabelSyntax(),
    toolOutput: new ToolOutputExpansion(),
    nextId,
    openPath,
    onFollowModeChange: setFollowingLatest,
    onEmptyChange: setTranscriptEmpty,
    tasks: () => [],
    userBlocks,
    userBlockWidth,
  };

  // Steer messages draw at the transcript's tail, in the shape of the turns they become.
  const pendingTail = new PendingTail(transcript, roles);
  view = new Timeline(transcript, { tail: pendingTail.container });
  // Syntax styles are built from theme roles, so a retheme rebuilds them and recolors the view.
  createEffect(
    on(
      () => Object.values(theme),
      () => {
        transcript.syntaxStyle = createSyntaxStyle(theme);
        transcript.subtleSyntaxStyle = createSubtleSyntaxStyle(theme);
        pendingGutter.retheme();
        pendingTail.retheme();
        view.retheme();
      },
      { defer: true },
    ),
  );

  props.onShell({
    renderer,
    keymap: createChatKeymap(renderer),
    ui,
    setUi,
    root,
    theme,
    setTheme,
    transcript,
    view,
    scroll,
    input,
    inputWidthMethod,
    pendingGutter,
    pendingTail,
    taskStatus,
    pluginSlot,
    previewSlot,
    focus: focusController,
    newScrollAcceleration,
    setScrollAcceleration: (accelerated) => {
      acceleratedScrolling = accelerated;
      scroll.scrollAcceleration = newScrollAcceleration();
    },
    nextId,
    closeCompletion: () => undefined,
    dismissInfoPanel: undefined,
  });

  return tree;
}

/** Mounts the screen and answers with the handle the rest of the terminal drives. */
export async function mountShell(input: Omit<AppProps, "onShell">): Promise<Shell> {
  let shell: Shell | undefined;
  await render(
    () => (
      <App
        renderer={input.renderer}
        initialTheme={input.initialTheme}
        roles={input.roles}
        openPath={input.openPath}
        onShell={(mounted) => (shell = mounted)}
      />
    ),
    input.renderer,
  );

  if (shell === undefined) throw new Error("The screen did not mount");

  return shell;
}
