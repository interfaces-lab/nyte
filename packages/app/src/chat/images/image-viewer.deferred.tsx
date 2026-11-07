import { Button } from "@nyte-ai/ui/button";
import { Morph } from "@nyte-ai/ui/morph";
import { Icon } from "@nyte-ai/ui/icon";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { control, glyph, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { Toggle } from "@nyte-ai/ui/toggle";
import { create, props } from "@stylexjs/stylex";
import { useImperativeHandle, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement, Ref } from "react";
import { addToChat, ADD_TO_CHAT_LABEL } from "../../references/add-to-chat.ts";
import { imageViewer } from "../../theme/schema.stylex.ts";
import { publishDeferred } from "../../lib/deferred.tsx";
import { ImageMarkup } from "./image-markup.tsx";
import { imageViewerStyles } from "./image-viewer.stylex.ts";
import { flattenMarkup, needsLightUnderstroke, markPath, markupInk } from "./markup.ts";
import type { Ink, Mark } from "./markup.ts";

const compact = "@media (max-width: 640px)";

const styles = create({
  body: { display: "contents" },
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    height: imageViewer.headerHeight,
    flexShrink: 0,
    paddingInlineStart: space.s2,
    paddingInlineEnd: `calc(${control.heightLg} + ${space.s2} * 2)`,
  },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    color: role.contentPrimary,
    fontWeight: type.weightMedium,
  },
  dimensions: {
    margin: 0,
    flexShrink: 0,
    color: role.contentTertiary,
    display: { default: "block", [compact]: "none" },
  },
  mode: { width: imageViewer.modeWidth },

  footer: {
    display: "grid",
    gridTemplateColumns: { default: "auto auto auto 1fr auto", [compact]: "1fr auto" },
    alignItems: "center",
    gap: { default: space.s4, [compact]: space.s2 },
    height: { default: imageViewer.footerHeight, [compact]: imageViewer.compactFooterHeight },
    flexShrink: 0,
    paddingBlock: space.s3,
    paddingInline: space.s2,
  },
  group: { display: "flex", alignItems: "center", gap: space.s1 },
  hidden: { visibility: "hidden" },
  add: { gridColumn: { default: "5", [compact]: "2" }, justifySelf: "end" },
  glyph: { display: "block", width: glyph.md, height: glyph.md, flexShrink: 0 },
  swatch: (ink: Ink) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: glyph.md,
    height: glyph.md,
    borderRadius: radius.pill,
    backgroundColor: markupInk[ink],
    color: role.contentOnInteractiveStrong,
    forcedColorAdjust: "none",
  }),
  error: {
    position: "absolute",
    insetBlockEnd: space.s2,
    insetInline: space.s2,
    margin: 0,
    paddingInline: space.s2,
    paddingBlock: space.s1,
    borderRadius: radius.control,
    backgroundColor: role.popupMaterial,
    color: role.contentAccent,
  },
});

const tools = [
  { kind: "pen", label: "Pen", key: "P" },
  { kind: "ellipse", label: "Ellipse", key: "E" },
  { kind: "arrow", label: "Arrow", key: "A" },
  { kind: "box", label: "Box", key: "B" },
] as const;

const inks = [
  { ink: "red", label: "Red", key: "1" },
  { ink: "orange", label: "Orange", key: "2" },
  { ink: "blue", label: "Blue", key: "3" },
] as const;

function ImageViewerPopup(input: {
  readonly source: HTMLImageElement;
  readonly shortcuts: Ref<(event: KeyboardEvent<HTMLDivElement>) => void>;
  readonly name: string;
  readonly signal: AbortSignal;
  readonly draft: Mark | undefined;
  readonly onDraft: (mark: Mark | undefined) => void;
  readonly onClose: (target?: HTMLElement) => void;
}): ReactElement {
  const [mode, setMode] = useState<"view" | "markup">("view");
  const [tool, setTool] = useState<Mark["kind"]>("pen");
  const [ink, setInk] = useState<Ink>("red");

  const [drawing, setDrawing] = useState<{
    readonly marks: readonly Mark[];
    readonly undo: readonly (readonly Mark[])[];
  }>({ marks: [], undo: [] });

  const [size] = useState(() => ({
    width: input.source.naturalWidth,
    height: input.source.naturalHeight,
    dark: needsLightUnderstroke(input.source),
  }));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const body = useRef<HTMLDivElement | null>(null);

  const commit = (marks: readonly Mark[]): void => {
    setDrawing((current) => ({ marks, undo: [...current.undo, current.marks] }));
  };

  const undo = (): void => {
    input.onDraft(undefined);
    setDrawing((current) => {
      const previous = current.undo.at(-1);

      return previous === undefined
        ? current
        : { marks: previous, undo: current.undo.slice(0, -1) };
    });
  };

  const attach = async (): Promise<void> => {
    const image = input.source;

    if (saving || input.signal.aborted || drawing.marks.length === 0 || input.draft !== undefined)
      return;

    setSaving(true);
    setError(undefined);

    try {
      const file = await flattenMarkup(
        image,
        drawing.marks,
        `${input.name.replace(/\.[^./]+$/u, "")}-marked.png`,
      );

      if (!input.signal.aborted) {
        const target = await addToChat({ image: file, signal: input.signal });

        if (!input.signal.aborted) input.onClose(target);
      }
    } catch (failure) {
      if (!input.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "The marked image could not be attached. Try again.",
        );
    }

    if (!input.signal.aborted) setSaving(false);
  };

  const shortcuts = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || saving) return;

    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "z"
    ) {
      event.preventDefault();
      undo();

      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const nextTool = tools.find(
      (candidate) => candidate.key.toLowerCase() === event.key.toLowerCase(),
    );

    if (nextTool !== undefined) {
      event.preventDefault();
      input.onDraft(undefined);
      setTool(nextTool.kind);
      setMode("markup");
      body.current
        ?.querySelector<SVGSVGElement>("[data-image-markup]")
        ?.focus({ preventScroll: true });

      return;
    }

    const nextInk = inks.find((candidate) => candidate.key === event.key);

    if (nextInk !== undefined) {
      event.preventDefault();
      setInk(nextInk.ink);
    }
  };

  useImperativeHandle(input.shortcuts, () => shortcuts);

  return (
    <div ref={body} {...props(styles.body)}>
      <div {...props(imageViewerStyles.header, styles.header)}>
        <Morph.Title xstyle={[text.base, styles.title]}>{input.name}</Morph.Title>
        <span {...props(text.sm, styles.dimensions)}>
          {size.width} × {size.height}
        </span>
        <Button
          size="lg"
          icon={mode === "view" ? "pencil" : "eye"}
          xstyle={styles.mode}
          disabled={saving}
          onClick={() => {
            input.onDraft(undefined);
            setMode(mode === "view" ? "markup" : "view");
          }}
        >
          {mode === "view" ? "Markup" : "View image"}
        </Button>
      </div>
      <ImageMarkup
        width={size.width}
        height={size.height}
        dark={size.dark}
        enabled={mode === "markup" && !saving}
        tool={tool}
        ink={ink}
        marks={drawing.marks}
        draft={input.draft}
        onDraft={input.onDraft}
        onMark={(mark) => commit([...drawing.marks, mark])}
      />
      <div {...props(imageViewerStyles.footer, styles.footer)}>
        <div
          role="group"
          aria-label="Drawing tools"
          {...props(styles.group, mode === "view" && styles.hidden)}
        >
          {tools.map((choice) => (
            <Toggle
              key={choice.kind}
              size="lg"
              iconOnly
              aria-label={choice.label}
              title={`${choice.label} (${choice.key})`}
              aria-keyshortcuts={choice.key}
              pressed={tool === choice.kind}
              disabled={saving}
              onPressedChange={() => {
                input.onDraft(undefined);
                setTool(choice.kind);
              }}
            >
              <ToolIcon kind={choice.kind} />
            </Toggle>
          ))}
        </div>
        <div
          role="group"
          aria-label="Ink"
          {...props(styles.group, mode === "view" && styles.hidden)}
        >
          {inks.map((choice) => (
            <Toggle
              key={choice.ink}
              size="lg"
              iconOnly
              aria-label={choice.label}
              title={`${choice.label} (${choice.key})`}
              aria-keyshortcuts={choice.key}
              pressed={ink === choice.ink}
              disabled={saving}
              onPressedChange={() => setInk(choice.ink)}
            >
              <span {...props(styles.swatch(choice.ink))}>
                {ink === choice.ink && <Icon name="checkmark" size="xs" />}
              </span>
            </Toggle>
          ))}
        </div>
        <div
          role="group"
          aria-label="Drawing history"
          {...props(styles.group, mode === "view" && styles.hidden)}
        >
          <Button
            size="lg"
            iconOnly
            aria-label="Undo"
            title="Undo (⌘/Ctrl+Z)"
            aria-keyshortcuts="Meta+Z Control+Z"
            disabled={drawing.undo.length === 0 || saving}
            onClick={undo}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              {...props(styles.glyph)}
            >
              <path d="m9 5-5 5 5 5M4 10h10a5 5 0 0 1 0 10h-2" />
            </svg>
          </Button>
          <Button
            size="lg"
            disabled={drawing.marks.length === 0 || saving}
            onClick={() => {
              input.onDraft(undefined);
              commit([]);
            }}
          >
            Clear
          </Button>
        </div>
        <Button
          size="lg"
          variant="solid"
          icon="paperclip"
          xstyle={styles.add}
          disabled={drawing.marks.length === 0 || input.draft !== undefined}
          loading={saving}
          onClick={() => void attach()}
        >
          {ADD_TO_CHAT_LABEL}
        </Button>
      </div>
      <span aria-live="polite" {...props(srOnly)}>
        {drawing.marks.length} {drawing.marks.length === 1 ? "mark" : "marks"}
      </span>
      {error !== undefined && (
        <p role="alert" {...props(surfaceTheme.red, text.sm, styles.error)}>
          {error}
        </p>
      )}
    </div>
  );
}

function ToolIcon(input: { readonly kind: Mark["kind"] }): ReactElement {
  if (input.kind === "pen") return <Icon name="pencil" size="md" />;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props(styles.glyph)}
    >
      <path
        d={markPath({
          kind: input.kind,
          ink: "red",
          from: { x: 4, y: input.kind === "arrow" ? 20 : 6, pressure: 0.5 },
          to: { x: 20, y: input.kind === "arrow" ? 4 : 18, pressure: 0.5 },
        })}
      />
    </svg>
  );
}

export const imageViewerRuntime = { ImageViewerPopup };

publishDeferred("images", imageViewerRuntime);
