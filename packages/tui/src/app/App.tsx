/**
 * The screen: transcript above, an opaque live column below with the pending
 * gutter, the composer, its status rule, the ephemeral slot, and the hint row.
 * Everything that changes is read from the UI store and the theme store; the
 * leaf widgets that only draw are mounted where the store says they belong.
 *
 * The ephemeral slot borrows rows from the transcript's tail rather than
 * taking them: a negative bottom margin on the scroll box cancels the slot's
 * height, so the viewport keeps its size, nothing re-anchors, and the
 * composer rides up over the chat as far as the slot is tall. The same count
 * goes onto the transcript's bottom padding, so a view pinned to the bottom
 * keeps its newest rows above the cover.
 */
import {
  MacOSScrollAccel,
  RenderableEvents,
  type BoxRenderable,
  type CliRenderer,
  type ScrollBoxRenderable,
  type TextareaRenderable,
  type TextRenderable,
} from "@opentui/core";
import { onBlur, onFocus, render, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, on, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { COMPOSER_PLACEHOLDER, keyStrokes, TRANSCRIPT_BOTTOM_PADDING } from "../constants.ts";
import { createChatKeymap } from "../keymap.ts";
import { LabelSyntax } from "../label-syntax.ts";
import type { LaneRoles } from "../lanes.ts";
import { PendingGutter } from "../pending-gutter.ts";
import type { ActiveCliTheme, CliTheme } from "../theme.ts";
import {
  createSubtleSyntaxStyle,
  createSyntaxStyle,
  ToolOutputExpansion,
  TranscriptView,
  type Transcript,
} from "../transcript.ts";
import {
  createUiStore,
  FocusController,
  framedPowerline,
  hintChunks,
  mergeCombiningMark,
  type Chunk,
  type Shell,
  type Slot,
} from "./ui.ts";

const MAX_COMPOSER_ROWS = 8;
const COMPOSER_CHROME_ROWS = 4;
const MAX_NOTICE_SHARE = 0.4;

function composerRowsForHeight(height: number): number {
  return Math.max(1, Math.min(MAX_COMPOSER_ROWS, height - COMPOSER_CHROME_ROWS));
}

/** The rows a slot occupant needs; a notice never takes more than its share of the screen. */
function slotRows(slot: Slot, height: number): number {
  switch (slot.kind) {
    case "empty":
      return 0;
    case "notice":
      return Math.min(slot.notice.lines.length, Math.max(1, Math.floor(height * MAX_NOTICE_SHARE)));
    case "panel":
      return Math.max(0, Math.floor(slot.rows));
    default: {
      const _exhaustive: never = slot;
      return _exhaustive;
    }
  }
}

/** A row drawn as colored spans. */
function Spans(props: { readonly chunks: readonly Chunk[] }) {
  return (
    <For each={props.chunks}>{(chunk) => <span style={{ fg: chunk.fg }}>{chunk.text}</span>}</For>
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

interface AppProps {
  readonly renderer: CliRenderer;
  readonly initialTheme: CliTheme;
  readonly roles: LaneRoles;
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

  const rows = createMemo(() => slotRows(ui.slot, dimensions().height));
  const noticeLines = createMemo(() =>
    ui.slot.kind === "notice" ? ui.slot.notice.lines.slice(0, rows()).join("\n") : undefined,
  );
  const noticeColor = createMemo(() =>
    ui.slot.kind === "notice" ? (ui.slot.notice.color ?? theme.dim) : theme.dim,
  );
  const hints = createMemo(() => hintChunks(ui.hints, theme));
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
        visible={ui.loading !== undefined}
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
      <scrollbox
        ref={(box) => (scroll = box)}
        id="transcript"
        flexGrow={1}
        minHeight={0}
        visible={ui.screen === undefined}
        stickyScroll
        stickyStart="bottom"
        scrollX={false}
        scrollY
        paddingLeft={1}
        paddingRight={1}
        paddingBottom={TRANSCRIPT_BOTTOM_PADDING + rows()}
        marginBottom={-rows()}
        scrollAcceleration={new MacOSScrollAccel()}
        verticalScrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.scrollbarTrack,
            foregroundColor: theme.scrollbarThumb,
          },
        }}
      />
      <box
        id="live"
        width="100%"
        flexShrink={0}
        flexDirection="column"
        visible={ui.screen === undefined}
        backgroundColor={theme.background}
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
          id="composer"
          width="100%"
          flexShrink={0}
          flexDirection="column"
          visible={ui.composerVisible}
        >
          <box
            id="input-box"
            // OpenTUI only highlights descendant focus on focusable boxes.
            focusable
            flexDirection="row"
            flexShrink={0}
            border={["top", "right", "left"]}
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
            <text id="input-prompt" fg={theme.user}>
              {ui.prompt}
            </text>
            <textarea
              ref={(area) => (input = area)}
              id="input"
              onKeyDown={(key) => mergeCombiningMark(input, key)}
              flexGrow={1}
              maxHeight={composerRowsForHeight(dimensions().height)}
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
          ref={(box) => (previewSlot = box)}
          id="preview-slot"
          width="100%"
          flexShrink={0}
          flexDirection="column"
        />
        <box
          id="ephemeral"
          width="100%"
          flexShrink={0}
          flexDirection="column"
          height={rows()}
          visible={rows() > 0}
        >
          <text
            id="notice"
            fg={noticeColor()}
            visible={noticeLines() !== undefined}
            height={rows()}
            wrapMode="none"
            marginLeft={3}
            marginRight={2}
          >
            {noticeLines() ?? ""}
          </text>
          <box
            ref={(box) => (panelHost = box)}
            id="panel-host"
            width="100%"
            flexDirection="column"
          />
        </box>
      </box>
      <text id="hints" wrapMode="word" flexShrink={0} marginLeft={1} marginRight={1}>
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
    children: () => [],
    userBlocks,
    userBlockWidth,
  };
  const view = new TranscriptView(transcript);
  // Syntax styles are built from theme roles, so a retheme rebuilds them and recolors the view.
  createEffect(
    on(
      () => Object.values(theme),
      () => {
        transcript.syntaxStyle = createSyntaxStyle(theme);
        transcript.subtleSyntaxStyle = createSubtleSyntaxStyle(theme);
        pendingGutter.retheme();
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
    taskStatus,
    pluginSlot,
    previewSlot,
    focus: focusController,
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
