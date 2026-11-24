import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Morph } from "@nyte-ai/ui/morph";
import { Popover } from "@nyte-ai/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { glyph, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { create, props } from "@stylexjs/stylex";
import { useImperativeHandle, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement, Ref } from "react";
import { addToChat, ADD_TO_CHAT_LABEL } from "../references/add-to-chat.ts";
import { publishDeferred } from "../lib/deferred.tsx";
import { imageViewerStyles } from "./image-viewer.stylex.ts";
import { MarkupDragOut } from "./markup-drag-out.tsx";
import { exportMarkup, imageTone } from "./markup-export.tsx";
import {
  MAX_ANGLE,
  clamp,
  fitAspect,
  fitCamera,
  mirror,
  mixCamera,
  mixEdit,
  orientedSize,
  settle,
  straighten,
  turnLeft,
  wholeImage,
} from "./markup-geometry.ts";
import type { Camera, Crop, Edit, Size } from "./markup-geometry.ts";
import { Stage } from "./markup-stage.tsx";
import type { Fresh } from "./markup-stage.tsx";
import { PENS, Tray } from "./markup-tray.tsx";
import { tween } from "./markup-tween.ts";
import { INKS, WIDTHS, highlighterColor, inkColor, laysInk } from "./markup.ts";
import type { Ink, Marker, Mark, Tool } from "./markup.ts";
import { StraightenDial } from "./straighten-dial.tsx";

const compact = "@media (max-width: 640px)";

const SETTLE_MS = 340;

const FIGURES = [
  {
    tool: "move",
    label: "Move",
    key: "V",
    path: "M12 3v18M3 12h18M12 3 9 6m3-3 3 3m-3 15-3-3m3 3 3-3M3 12l3-3m-3 3 3 3m15-3-3-3m3 3-3 3",
  },
  { tool: "circle", label: "Circle", key: "O", path: "M4 12a8 7 0 1 0 16 0 8 7 0 1 0-16 0" },
  { tool: "arrow", label: "Arrow", key: "A", path: "M5 19 19 5m-9 0h9v9" },
  { tool: "box", label: "Box", key: "R", path: "M5 6h14v12H5z" },
] as const;

const SIZES = [
  { label: "Fine", factor: 0.6, dot: "fine" },
  { label: "Medium", factor: 1, dot: "medium" },
  { label: "Bold", factor: 1.7, dot: "bold" },
] as const;

const ASPECTS = [
  { value: "free", label: "Free", ratio: undefined },
  { value: "original", label: "Original", ratio: undefined },
  { value: "square", label: "Square", ratio: 1 },
  { value: "4:3", label: "4:3", ratio: 4 / 3 },
  { value: "16:9", label: "16:9", ratio: 16 / 9 },
] as const;

type Aspect = (typeof ASPECTS)[number]["value"];

interface Doc {
  readonly edit: Edit;
  readonly marks: readonly Mark[];
  readonly aspect: Aspect;
}

const styles = create({
  body: { display: "contents" },
  canvas: { position: "absolute", inset: 0 },
  hidden: { display: "none" },
  name: {
    flex: 1,
    minWidth: 0,
    paddingInline: space.s1,
    overflow: "hidden",
    color: role.contentSecondary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    flexWrap: { default: "nowrap", [compact]: "wrap" },
    alignContent: "center",
    columnGap: space.s2,
    rowGap: { default: space.s2, [compact]: 0 },
    paddingInline: space.s1,
  },
  group: { display: "flex", alignItems: "center", gap: space.s0_5 },
  tools: { display: "contents" },
  crop: {
    display: "flex",
    alignItems: "center",
    gap: space.s0_5,
    flex: 1,
    minWidth: 0,
    order: { default: null, [compact]: 2 },
  },
  history: { order: { default: null, [compact]: 2 } },
  rowBreak: {
    display: { default: "none", [compact]: "block" },
    flexBasis: "100%",
    height: space.s2,
    order: 1,
  },
  divider: {
    display: { default: "block", [compact]: "none" },
    width: space.px,
    height: glyph.lg,
    backgroundColor: role.strokeQuaternary,
  },
  glyph: { display: "block", width: glyph.md, height: glyph.md, flexShrink: 0 },
  swatch: (color: string) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: glyph.md,
    height: glyph.md,
    borderRadius: radius.pill,
    backgroundColor: color,
    color: role.contentOnInteractiveStrong,
    forcedColorAdjust: "none",
  }),
  dot: { display: "block", borderRadius: radius.pill, backgroundColor: role.contentPrimary },
  palette: { display: "flex", flexDirection: "column", gap: space.s1, padding: space.s1 },
  paletteRow: { display: "flex", alignItems: "center", gap: space.s0_5 },
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

const dots = create({
  fine: { width: space.s1, height: space.s1 },
  medium: { width: space.s2, height: space.s2 },
  bold: { width: space.s3, height: space.s3 },
});

function ImageViewerPopup(input: {
  readonly source: HTMLImageElement;
  readonly shortcuts: Ref<(event: KeyboardEvent<HTMLDivElement>) => void>;
  readonly name: string;
  readonly signal: AbortSignal;
  readonly marking: boolean;
  readonly onMarking: (marking: boolean) => void;
  readonly draft: Mark | undefined;
  readonly onDraft: (mark: Mark | undefined) => void;
  readonly onDragOut: (away: boolean) => void;
  readonly onClose: (target?: HTMLElement) => void;
}): ReactElement {
  const [photo] = useState(() => ({
    size: { width: input.source.naturalWidth, height: input.source.naturalHeight },
    tone: imageTone(input.source),
  }));

  const size: Size = photo.size;

  const [doc, setDoc] = useState<Doc>(() => ({
    edit: wholeImage(size),
    marks: [],
    aspect: "free",
  }));

  const [shown, setShown] = useState<Edit | undefined>(undefined);

  const [history, setHistory] = useState<{
    readonly past: readonly Doc[];
    readonly future: readonly Doc[];
  }>({
    past: [],
    future: [],
  });

  const [tool, setTool] = useState<Tool>("pen");

  const [inks, setInks] = useState<Readonly<Record<Marker, Ink>>>({
    pen: "red",
    highlight: "amber",
    circle: "red",
    arrow: "red",
    box: "red",
  });

  const [sizes, setSizes] = useState<Readonly<Record<Exclude<Tool, "move">, number>>>({
    pen: 1,
    highlight: 1,
    eraser: 1,
    circle: 1,
    arrow: 1,
    box: 1,
  });

  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [override, setOverride] = useState<Camera | undefined>(undefined);
  const [fresh, setFresh] = useState<Fresh | undefined>(undefined);
  const [straightening, setStraightening] = useState(false);
  const [panKey, setPanKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const snapshot = useRef<Doc | undefined>(undefined);
  const straightenFrom = useRef<Crop | undefined>(undefined);
  const editTween = useRef<() => void>(() => undefined);
  const cameraTween = useRef<() => void>(() => undefined);

  useMountEffect(() => {
    const release = (event: globalThis.KeyboardEvent) => {
      if (event.key === " ") setPanKey(false);
    };

    window.addEventListener("keyup", release);

    return () => {
      editTween.current();
      cameraTween.current();
      window.removeEventListener("keyup", release);
    };
  });

  const view = shown ?? doc.edit;
  const bounds = orientedSize(size, doc.edit.turns);
  const camera = override ?? fitCamera(view, viewport, 0);
  const ratio = aspectRatio(doc.aspect, size, doc.edit);

  const cropped =
    !sameCrop(doc.edit.crop, wholeImage(size).crop) ||
    doc.edit.angle !== 0 ||
    doc.edit.turns !== 0 ||
    doc.edit.flip;

  const changed = cropped || doc.marks.length > 0;
  const marker = laysInk(tool) ? tool : "pen";
  const ink = inks[marker];
  const width = tool === "move" ? 0 : WIDTHS[tool] * (SIZES[sizes[tool]]?.factor ?? 1);
  const fileName = `${input.name.replace(/\.[^./]+$/u, "")}-marked.png`;

  const record = (before: Doc): void => {
    setHistory((current) => ({ past: [...current.past, before].slice(-100), future: [] }));
  };

  const recordSnapshot = (): void => {
    const before = snapshot.current;

    snapshot.current = undefined;

    if (before !== undefined) record(before);
  };

  const interrupt = (): void => {
    editTween.current();
    setShown(undefined);
    straightenFrom.current = undefined;
    recordSnapshot();
  };

  const showChange = (from: Edit, to: Edit): void => {
    editTween.current();
    editTween.current = tween(SETTLE_MS, (t) =>
      setShown(t >= 1 ? undefined : mixEdit(from, to, t)),
    );
  };

  const apply = (next: Doc, animate: boolean): void => {
    interrupt();
    record(doc);
    setDoc(next);

    if (animate) showChange(view, next.edit);
  };

  const settleCamera = (from: Camera, to: Camera): void => {
    cameraTween.current();
    setOverride(from);
    cameraTween.current = tween(SETTLE_MS, (t) =>
      setOverride(t >= 1 ? undefined : mixCamera(from, to, t)),
    );
  };

  const undo = (): void => {
    const previous = history.past.at(-1);

    if (previous === undefined) return;
    interrupt();
    setHistory({ past: history.past.slice(0, -1), future: [doc, ...history.future] });
    setDoc(previous);
    showChange(view, previous.edit);
  };

  const redo = (): void => {
    const next = history.future[0];

    if (next === undefined) return;
    interrupt();
    setHistory({ past: [...history.past, doc], future: history.future.slice(1) });
    setDoc(next);
    showChange(view, next.edit);
  };

  const chooseAspect = (next: Aspect): void => {
    const wanted = aspectRatio(next, size, doc.edit);

    apply(
      {
        ...doc,
        aspect: next,
        edit:
          wanted === undefined
            ? doc.edit
            : {
                ...doc.edit,
                crop: settle(fitAspect(doc.edit.crop, wanted), doc.edit.angle, bounds),
              },
      },
      wanted !== undefined,
    );
  };

  const reset = (): void => {
    const next = wholeImage(size);

    apply(
      { ...doc, aspect: "free", edit: next },
      next.turns === doc.edit.turns && next.flip === doc.edit.flip,
    );
  };

  const rotate = (): void => {
    const next = turnLeft(doc.edit, size);
    const target = fitCamera(next, viewport, 0);

    apply({ ...doc, edit: next }, false);
    settleCamera({ ...target, scale: camera.scale, angle: target.angle + 90 }, target);
  };

  const flip = (): void => {
    const next = mirror(doc.edit, size);
    const target = fitCamera(next, viewport, 0);

    apply({ ...doc, edit: next }, false);
    settleCamera({ ...target, squash: -1 }, target);
  };

  const chooseTool = (next: Tool): void => {
    input.onDraft(undefined);
    setTool(next);
  };

  const chooseInk = (next: Ink): void => {
    setInks({ ...inks, [marker]: next });
    chooseTool(marker);
  };

  const attach = async (): Promise<void> => {
    if (saving || input.signal.aborted || !changed || input.draft !== undefined) return;

    setSaving(true);
    setError(undefined);

    try {
      const file = await exportMarkup(input.source, doc.edit, doc.marks, photo.tone, fileName);

      if (!input.signal.aborted) {
        const target = await addToChat({ image: file, signal: input.signal });

        if (!input.signal.aborted) input.onClose(target);
      }
    } catch (failure) {
      if (!input.signal.aborted) {
        setError(
          failure instanceof Error
            ? failure.message
            : "The marked image could not be attached. Try again.",
        );
      }
    }

    if (!input.signal.aborted) setSaving(false);
  };

  const shortcuts = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!input.marking || event.defaultPrevented || event.nativeEvent.isComposing || saving) return;

    const target = event.target;
    const command = event.metaKey || event.ctrlKey;

    if (command && !event.altKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      input.onDraft(undefined);

      if (event.shiftKey) redo();
      else undo();

      return;
    }

    if (command || event.altKey) return;

    if (target instanceof HTMLElement && target.getAttribute("role") === "slider") return;

    if (event.key === " " && !(target instanceof HTMLButtonElement)) {
      event.preventDefault();
      setPanKey(true);

      return;
    }

    const chosen = [...PENS, ...FIGURES].find(
      (each) => each.key.toLowerCase() === event.key.toLowerCase(),
    );

    if (chosen !== undefined) {
      event.preventDefault();
      chooseTool(chosen.tool);

      return;
    }

    const next = INKS[Number.parseInt(event.key, 10) - 1];

    if (next !== undefined) {
      event.preventDefault();
      chooseInk(next);
    }
  };

  useImperativeHandle(input.shortcuts, () => shortcuts);

  return (
    <div {...props(styles.body)}>
      <Morph.Title xstyle={srOnly}>{input.name}</Morph.Title>
      <div inert={saving} {...props(styles.canvas, !input.marking && styles.hidden)}>
        <Stage
          src={input.source.currentSrc || input.source.src}
          image={size}
          edit={view}
          marks={doc.marks}
          camera={camera}
          viewport={viewport}
          tool={tool}
          ink={ink}
          width={width}
          tone={photo.tone}
          aspect={ratio}
          straightening={straightening}
          panKey={panKey}
          fresh={fresh}
          nextId={Math.max(0, ...doc.marks.map((mark) => mark.id)) + 1}
          draft={input.draft}
          onDraft={input.onDraft}
          onViewport={setViewport}
          onMark={(mark, from) => {
            setFresh(from === undefined ? undefined : { id: mark.id, from });
            apply({ ...doc, marks: [...doc.marks, mark] }, false);
          }}
          onErase={(ids) =>
            apply({ ...doc, marks: doc.marks.filter((mark) => !ids.includes(mark.id)) }, false)
          }
          onCropStart={() => {
            interrupt();
            snapshot.current = doc;
          }}
          onCrop={(edit) => {
            recordSnapshot();
            setDoc((current) => ({ ...current, edit }));
          }}
          onFreeze={setOverride}
          onCropEnd={(edit) => {
            const settled = { ...edit, crop: settle(edit.crop, edit.angle, bounds) };

            snapshot.current = undefined;
            setDoc((current) => ({ ...current, edit: settled }));

            if (!sameCrop(settled.crop, edit.crop)) showChange(edit, settled);

            if (override !== undefined) settleCamera(override, fitCamera(settled, viewport, 0));
          }}
        />
      </div>

      <div
        role="toolbar"
        aria-label={input.marking ? "Markup" : "Image Preview"}
        {...props(imageViewerStyles.footer, styles.footer)}
      >
        {input.marking ? (
          <>
            <div inert={saving} {...props(styles.tools)}>
              <Tray tool={tool} inks={inks} onTool={chooseTool} />
              <ToggleGroup
                aria-label="Tools"
                value={FIGURES.some((each) => each.tool === tool) ? [tool] : []}
                onValueChange={(values) => {
                  const next = FIGURES.find((each) => each.tool === values.at(-1));

                  if (next !== undefined) chooseTool(next.tool);
                }}
              >
                {FIGURES.map((each) => (
                  <Toggle<Tool>
                    key={each.tool}
                    value={each.tool}
                    size="lg"
                    iconOnly
                    aria-label={each.label}
                    title={`${each.label} (${each.key})`}
                    aria-keyshortcuts={each.key}
                  >
                    <ToolGlyph path={each.path} />
                  </Toggle>
                ))}
              </ToggleGroup>
              <Popover.Root>
                <Popover.Trigger
                  render={
                    <Button
                      size="lg"
                      iconOnly
                      aria-label={`Ink and Size, ${capitalize(ink)}`}
                      title="Ink and Size (1–6)"
                    >
                      <span
                        {...props(
                          styles.swatch(
                            marker === "highlight" ? highlighterColor(ink) : inkColor(ink),
                          ),
                        )}
                      />
                    </Button>
                  }
                />
                <Popover.Portal>
                  <Popover.Positioner side="top" align="center" sideOffset={8}>
                    <Popover.Popup>
                      <div {...props(styles.palette)}>
                        <div role="group" aria-label="Ink" {...props(styles.paletteRow)}>
                          {INKS.map((each, index) => {
                            const chosen = laysInk(tool) && ink === each;

                            return (
                              <Toggle
                                key={each}
                                size="lg"
                                iconOnly
                                aria-label={capitalize(each)}
                                title={`${capitalize(each)} (${index + 1})`}
                                aria-keyshortcuts={String(index + 1)}
                                pressed={chosen}
                                onPressedChange={() => chooseInk(each)}
                              >
                                <span
                                  {...props(
                                    styles.swatch(
                                      marker === "highlight"
                                        ? highlighterColor(each)
                                        : inkColor(each),
                                    ),
                                  )}
                                >
                                  {chosen && <Icon name="checkmark" size="xs" />}
                                </span>
                              </Toggle>
                            );
                          })}
                        </div>
                        {tool !== "move" && (
                          <div role="group" aria-label="Size" {...props(styles.paletteRow)}>
                            {SIZES.map((each, index) => (
                              <Toggle
                                key={each.label}
                                size="lg"
                                iconOnly
                                aria-label={each.label}
                                pressed={sizes[tool] === index}
                                onPressedChange={() => setSizes({ ...sizes, [tool]: index })}
                              >
                                <span {...props(styles.dot, dots[each.dot])} />
                              </Toggle>
                            ))}
                          </div>
                        )}
                      </div>
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
              <span aria-hidden="true" {...props(styles.divider)} />
              <span aria-hidden="true" {...props(styles.rowBreak)} />
              <div role="group" aria-label="Crop" {...props(styles.crop)}>
                <Button
                  size="lg"
                  iconOnly
                  aria-label="Rotate Left"
                  title="Rotate Left"
                  onClick={rotate}
                >
                  <ToolGlyph path="M8 10h10v10H8zM4 14V8a4 4 0 0 1 4-4h5m-3-3 3 3-3 3" />
                </Button>
                <StraightenDial
                  angle={doc.edit.angle}
                  onStart={() => {
                    interrupt();
                    snapshot.current = doc;
                    straightenFrom.current = doc.edit.crop;
                    setStraightening(true);
                  }}
                  onChange={(angle) => {
                    const from = straightenFrom.current;

                    if (from === undefined) return;
                    recordSnapshot();
                    setDoc((current) => ({
                      ...current,
                      edit: {
                        ...current.edit,
                        angle,
                        crop: straighten(
                          from,
                          clamp(angle, -MAX_ANGLE * 1.2, MAX_ANGLE * 1.2),
                          bounds,
                        ),
                      },
                    }));
                  }}
                  onEnd={() => {
                    straightenFrom.current = undefined;
                    setStraightening(false);
                  }}
                />
                <Button
                  size="lg"
                  iconOnly
                  aria-label="Flip Horizontal"
                  title="Flip Horizontal"
                  onClick={flip}
                >
                  <ToolGlyph path="M12 3v18M9 6 3 18h6zm6 0 6 12h-6z" />
                </Button>
                <Select
                  items={ASPECTS}
                  value={doc.aspect}
                  onValueChange={(next) => {
                    const chosen = ASPECTS.find((entry) => entry.value === next);

                    if (chosen !== undefined) chooseAspect(chosen.value);
                  }}
                >
                  <SelectTrigger aria-label="Aspect Ratio">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="center">
                    {ASPECTS.map((entry) => (
                      <SelectItem key={entry.value} value={entry.value} label={entry.label}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="lg"
                  iconOnly
                  icon="refresh"
                  aria-label="Reset Crop"
                  title="Reset Crop"
                  disabled={!cropped}
                  onClick={reset}
                />
              </div>
              <span aria-hidden="true" {...props(styles.divider)} />
              <div role="group" aria-label="History" {...props(styles.group, styles.history)}>
                <Button
                  size="lg"
                  iconOnly
                  aria-label="Undo"
                  title="Undo (⌘/Ctrl+Z)"
                  aria-keyshortcuts="Meta+Z Control+Z"
                  disabled={history.past.length === 0}
                  onClick={undo}
                >
                  <ToolGlyph path="m9 5-5 5 5 5M4 10h10a5 5 0 0 1 0 10h-2" />
                </Button>
                <Button
                  size="lg"
                  iconOnly
                  aria-label="Redo"
                  title="Redo (⇧⌘/Ctrl+Z)"
                  aria-keyshortcuts="Shift+Meta+Z Shift+Control+Z"
                  disabled={history.future.length === 0}
                  onClick={redo}
                >
                  <ToolGlyph path="m15 5 5 5-5 5m5-5H10a5 5 0 0 0 0 10h2" />
                </Button>
              </div>
              <MarkupDragOut
                image={input.source}
                size={size}
                edit={doc.edit}
                marks={doc.marks}
                tone={photo.tone}
                name={fileName}
                onAway={input.onDragOut}
                onDroppedInChat={input.onClose}
              />
            </div>
            <Button
              size="lg"
              variant="solid"
              icon="paperclip"
              disabled={!changed || input.draft !== undefined}
              loading={saving}
              onClick={() => void attach()}
            >
              {ADD_TO_CHAT_LABEL}
            </Button>
          </>
        ) : (
          <span {...props(text.sm, styles.name)}>{input.name}</span>
        )}
        <Toggle
          size="lg"
          iconOnly
          icon="pencil"
          aria-label="Markup"
          disabled={saving}
          pressed={input.marking}
          onPressedChange={(next) => {
            input.onDraft(undefined);
            setPanKey(false);
            input.onMarking(next);
          }}
        />
        <Morph.Close
          render={<Button size="lg" iconOnly aria-label="Close Image Preview" icon="x" />}
        />
      </div>
      <span aria-live="polite" {...props(srOnly)}>
        {doc.marks.length} {doc.marks.length === 1 ? "mark" : "marks"}
      </span>
      {error !== undefined && (
        <p role="alert" {...props(surfaceTheme.red, text.sm, styles.error)}>
          {error}
        </p>
      )}
    </div>
  );
}

function ToolGlyph(input: { readonly path: string }): ReactElement {
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
      <path d={input.path} />
    </svg>
  );
}

function aspectRatio(aspect: Aspect, image: Size, edit: Edit): number | undefined {
  const choice = ASPECTS.find((each) => each.value === aspect);
  const oriented = orientedSize(image, edit.turns);
  const base = aspect === "original" ? oriented.width / oriented.height : choice?.ratio;

  if (base === undefined) return undefined;

  return edit.crop.h > edit.crop.w === base > 1 ? 1 / base : base;
}

function sameCrop(a: Crop, b: Crop): boolean {
  return [a.cx - b.cx, a.cy - b.cy, a.w - b.w, a.h - b.h].every((delta) => Math.abs(delta) < 0.5);
}

function capitalize(word: string): string {
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
}

export const imageViewerRuntime = { ImageViewerPopup };

publishDeferred("images", imageViewerRuntime);
