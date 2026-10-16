import { decodePasteBytes, RenderableEvents, SyntaxStyle } from "@opentui/core";
import type { KeyEvent, PasteEvent, TextareaRenderable } from "@opentui/core";
import { onBlur, onFocus, useRenderer, useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { GLYPHS } from "../../lib/constants.ts";
import { cellOffset } from "../../lib/width.ts";
import type { MarkerSpan } from "../../model/draft.ts";
import type { Fact } from "../../model/msg.ts";
import type { ComposerPort } from "../../model/native.ts";
import type { Draft } from "../../model/state.ts";
import { Footer } from "../chrome/footer.tsx";

const MAX_COMPOSER_ROWS = 8;

const MARKER_TYPE = "composer-part";

type DraftChanged = Extract<Fact, { readonly kind: "draft-changed" }>;

function cursorRow(area: TextareaRenderable): Draft["row"] {
  const last = Math.max(0, area.editorView.getTotalVirtualLineCount() - 1);
  const row = area.scrollY + area.visualCursor.visualRow;

  if (last === 0) return "only";

  if (row <= 0) return "first";

  return row >= last ? "last" : "middle";
}

export function readDraft(area: TextareaRenderable): DraftChanged {
  return {
    kind: "draft-changed",
    text: area.plainText,
    cursor: area.editBuffer.getTextRange(0, area.cursorOffset).length,
    row: cursorRow(area),
  };
}

function offsetIn(area: TextareaRenderable, text: string, index: number): number {
  return cellOffset(
    text,
    index,
    area.ctx.widthMethod,
    area.editBuffer.getTabWidth(),
    area.ctx.nativeScene,
  );
}

export function syncMarkers(
  area: TextareaRenderable,
  styleId: number,
  spans: readonly MarkerSpan[],
): void {
  const text = area.plainText;
  const typeId = area.extmarks.registerType(MARKER_TYPE);
  const existing = area.extmarks.getAllForTypeId(typeId);
  const stale = new Set(existing);

  for (const span of spans) {
    if (text.slice(span.from, span.to) !== span.marker) continue;
    const start = offsetIn(area, text, span.from);
    const end = offsetIn(area, text, span.to);

    const kept = existing.find(
      (mark) => mark.start === start && mark.end === end && mark.styleId === styleId,
    );

    if (kept === undefined) area.extmarks.create({ start, end, virtual: true, styleId, typeId });
    else stale.delete(kept);
  }

  for (const mark of stale) area.extmarks.delete(mark.id);
}

function mergeCombiningMark(area: TextareaRenderable, key: KeyEvent): void {
  if (key.ctrl || key.meta || key.option || key.super || !/^\p{M}$/u.test(key.sequence)) return;

  if (area.hasSelection()) return;

  const base = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      area.editBuffer.getTextRange(0, area.cursorOffset),
    ),
  ].at(-1)?.segment;

  if (base === undefined || base === "\n") return;
  key.preventDefault();
  area.deleteCharBackward();
  area.insertText(base + key.sequence);
}

export function pasteMessage(event: PasteEvent): {
  readonly kind: "terminal";
  readonly text: string;
  readonly bytes: Uint8Array | null;
} {
  const binary =
    event.metadata?.kind === "binary" || event.metadata?.mimeType?.startsWith("image/") === true;

  return binary
    ? { kind: "terminal", text: "", bytes: event.bytes }
    : { kind: "terminal", text: decodePasteBytes(event.bytes), bytes: null };
}

export function Composer(props: { readonly markers: readonly MarkerSpan[] }): JSX.Element {
  const app = useApp();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [focused, setFocused] = createSignal(false);
  let terminalFocused = true;
  const theme = () => app.kit.theme();
  const tiny = () => dimensions().height <= 3;
  let area: TextareaRenderable | undefined;
  let attachment: { readonly style: SyntaxStyle; readonly id: number } | null = null;
  let reported: DraftChanged | null = null;
  let marked = false;

  const sync = (): void => {
    if (area === undefined || area.isDestroyed || attachment === null) return;

    // Reading extmarks wraps the editor's edit methods; a draft that never had a marker skips it.
    if (props.markers.length === 0 && !marked) return;
    marked = true;
    syncMarkers(area, attachment.id, props.markers);
  };

  const report = (): void => {
    if (area === undefined || area.isDestroyed) return;
    const next = readDraft(area);

    if (
      reported === null ||
      reported.text !== next.text ||
      reported.cursor !== next.cursor ||
      reported.row !== next.row
    ) {
      reported = next;
      app.dispatch(next);
    }

    sync();
  };

  const port: ComposerPort = {
    set: (draft) => {
      area?.setText(draft.text);
      area?.gotoBufferEnd();
    },
    insert: (text, at) => {
      if (area === undefined) return;

      if (at === "start") area.gotoBufferHome();
      area.insertText(text);

      if (at === "start") area.gotoBufferEnd();
    },
    replaceRange: (from, to, text) => {
      if (area === undefined) return;
      const current = area.plainText;
      const next = `${current.slice(0, from)}${text}${current.slice(to)}`;
      area.replaceText(next);
      area.cursorOffset = offsetIn(area, next, from + text.length);
    },
    clear: () => area?.clear(),
    focus: () => area?.focus(),
    cursor: (to) => {
      if (to === "start") area?.gotoBufferHome();
      else area?.gotoBufferEnd();
    },
  };

  createEffect(
    on(theme, (current) => {
      if (area === undefined) return;
      const previous = attachment;
      const style = SyntaxStyle.create(renderer.nativeScene);

      attachment = {
        style,
        id: style.registerStyle("attachment", {
          fg: current.pasteForeground,
          bg: current.pasteBackground,
        }),
      };

      area.syntaxStyle = style;
      sync();
      previous?.style.destroy();
    }),
  );

  createEffect(on(() => props.markers, sync));

  createEffect(
    on(
      () => app.screen().dialog === null,
      (free, wasFree) => {
        if (area === undefined) return;
        area.focusable = free;

        if (free && wasFree === false && terminalFocused) area.focus();
      },
    ),
  );

  onBlur(() => {
    terminalFocused = false;
    area?.blur();
  });

  onFocus(() => {
    terminalFocused = true;

    if (area?.focusable === true) area.focus();
  });

  const focusIn = (): void => {
    setFocused(true);
  };

  const focusOut = (): void => {
    setFocused(false);
  };

  onMount(() => {
    if (area === undefined) return;
    const target = area;
    target.on(RenderableEvents.FOCUSED, focusIn);
    target.on(RenderableEvents.BLURRED, focusOut);

    const detach = app.kit.attach.composer(port);
    target.focus();
    report();

    onCleanup(() => {
      detach();
      target.off(RenderableEvents.FOCUSED, focusIn);
      target.off(RenderableEvents.BLURRED, focusOut);

      if (!target.isDestroyed) target.syntaxStyle = null;
      attachment?.style.destroy();
      attachment = null;
    });
  });

  return (
    <box id="composer" width="100%" flexShrink={0} flexDirection="column">
      <box
        id="input-box"
        flexDirection="row"
        flexShrink={0}
        border={tiny() ? [] : ["top", "right", "left"]}
        borderStyle="rounded"
        borderColor={focused() ? theme().promptBorderFocused : theme().promptBorder}
        paddingLeft={1}
        paddingRight={1}
        marginLeft={1}
        marginRight={1}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();

          if (area?.focusable === true) area.focus();
        }}
      >
        <text id="input-prompt" fg={theme().user} flexShrink={0} wrapMode="none">
          {`${GLYPHS.prompt} `}
        </text>
        <textarea
          ref={(node) => (area = node)}
          id="input"
          flexGrow={1}
          flexBasis={0}
          minWidth={1}
          minHeight={1}
          maxHeight={Math.max(
            1,
            Math.min(MAX_COMPOSER_ROWS, Math.floor((dimensions().height * 2) / 3) - 2),
          )}
          wrapMode="word"
          placeholder={app.screen().placeholder}
          placeholderColor={theme().dim}
          backgroundColor={theme().transparent}
          focusedBackgroundColor={theme().transparent}
          textColor={theme().foreground}
          focusedTextColor={theme().foreground}
          cursorColor={theme().user}
          selectionBg={theme().selectionBackground}
          selectionFg={theme().selectionForeground}
          onContentChange={report}
          onCursorChange={report}
          onKeyDown={(key) => {
            if (area !== undefined) mergeCombiningMark(area, key);
          }}
          onPaste={(event) => {
            event.preventDefault();
            app.dispatch({ kind: "paste", source: pasteMessage(event) });
          }}
          onMouseUp={(event) => {
            if (event.button !== 0) return;

            if (renderer.getSelection()?.getSelectedText()) return;
            app.dispatch({ kind: "open-attachment" });
          }}
        />
      </box>
      <Show when={!tiny()}>
        <Footer focused={focused()} />
      </Show>
    </box>
  );
}
