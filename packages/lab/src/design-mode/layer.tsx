import { create, props } from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent, ReactElement, ReactNode, RefObject } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { avatar, button, radius } from "@nyte-ai/ui/styles/schema.stylex";
import { motion, type } from "@nyte-ai/ui/styles/vars.stylex";
import { design, inverse } from "./design.stylex";
import { OverlayCanvas } from "./overlay";
import type { Scene } from "./overlay";
import {
  DRAG_THRESHOLD,
  MIN_AREA,
  boxBetween,
  clipBox,
  contentBox,
  coveredOutlines,
  anchorFor,
  findAnchor,
  findElements,
  labelFor,
  labelParts,
  meaningfulAncestor,
  meaningfulElement,
  measureOutline,
  splitLabel,
  visibleOutlines,
} from "./picker";
import type { Box, LabelParts, Outline, Target } from "./picker";

const XRAY_LIMIT = 600;

const ARROW = 8;

const LABEL_GAP = 4;

const EDGE = 8;

const ARROW_INSET = 16;

const INPUT_MAX_HEIGHT = 95;

export type Placement = "page" | "chat";

export interface Draft {
  readonly target: Target;
  readonly comment: string;
  readonly commentId?: number;
}

export interface QueuedComment {
  readonly id: number;
  readonly number: number;
  readonly target: Target;
  readonly comment: string;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Gesture {
  readonly origin: Point;
  dragging: boolean;
}

/** How the overlay maps to the page under it: the frame's zoom and where page content starts. */
interface Frame {
  readonly zoom: number;
  readonly origin: Point;
  readonly width: number;
  readonly height: number;
}

export function DesignLayer({
  viewportRef,
  scrollerRef,
  rootRef,
  placement,
  xray,
  draft,
  comments,
  onDraftChange,
  onSave,
  onRemove,
  onAttach,
  onExit,
}: {
  readonly viewportRef: RefObject<HTMLDivElement | null>;
  readonly scrollerRef: RefObject<HTMLDivElement | null>;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly placement: Placement;
  readonly xray: boolean;
  readonly draft: Draft | undefined;
  readonly comments: readonly QueuedComment[];
  readonly onDraftChange: (draft: Draft | undefined) => void;
  readonly onSave: (draft: Draft) => void;
  readonly onRemove: (id: number) => void;
  readonly onAttach: (target: Target) => void;
  readonly onExit: () => void;
}): ReactElement {
  const [path, setPath] = useState<readonly Element[]>([]);
  const [marquee, setMarquee] = useState<Box>();
  const [frame, setFrame] = useState<Frame>();
  const [, setRevision] = useState(0);
  const [cursor, setCursor] = useState<Point>();
  const catcherRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | undefined>(undefined);
  const pointer = useRef<Point | undefined>(undefined);
  const hovered = draft === undefined && marquee === undefined ? path.at(-1) : undefined;

  const hitAt = (clientX: number, clientY: number): Element | undefined => {
    const root = rootRef.current;

    if (root === null) return undefined;

    const hit = document
      .elementsFromPoint(clientX, clientY)
      .find((element) => element !== root && root.contains(element));

    return hit === undefined ? undefined : meaningfulElement(hit, root);
  };

  const hoverAt = (clientX: number, clientY: number): void => {
    const hit = hitAt(clientX, clientY);

    setPath((current) => {
      if (hit === undefined) return [];

      return current[0] === hit ? current : [hit];
    });
  };

  // oxlint-disable-next-line nyte-code/no-direct-effect -- remeasures the overlay as the page scrolls or the frame resizes
  useEffect(() => {
    const viewport = viewportRef.current;
    const scroller = scrollerRef.current;
    const root = rootRef.current;

    if (viewport === null || scroller === null || root === null) return;
    let queued = 0;

    const measure = (): void => {
      queued = 0;
      const next = measureFrame(viewport, root);

      setFrame((current) =>
        current?.zoom === next.zoom &&
        current.origin.x === next.origin.x &&
        current.origin.y === next.origin.y &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : next,
      );
      const at = pointer.current;

      if (at !== undefined && gesture.current === undefined) hoverAt(at.x, at.y);
    };

    const schedule = (): void => {
      if (queued === 0) queued = requestAnimationFrame(measure);
    };

    measure();
    scroller.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    const mutations = new MutationObserver(() => setRevision((revision) => revision + 1));

    observer.observe(viewport);
    observer.observe(root);
    mutations.observe(root, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(queued);
      scroller.removeEventListener("scroll", schedule);
      observer.disconnect();
      mutations.disconnect();
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- hoverAt reads only refs and a state setter, so the first render's copy stays correct
  }, [viewportRef, scrollerRef, rootRef]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- an element comment whose elements left the page lets go, as Cursor's does
  useEffect(() => {
    const root = rootRef.current;

    if (root === null || draft?.target.kind !== "element") return;

    if (findElements(draft.target, root) === undefined) onDraftChange(undefined);
  });

  // oxlint-disable-next-line nyte-code/no-direct-effect -- the wheel has to be cancelled natively so the lab page stays put
  useEffect(() => {
    const catcher = catcherRef.current;
    const scroller = scrollerRef.current;

    if (catcher === null || scroller === null) return;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      scroller.scrollBy({ left: event.deltaX, top: event.deltaY });
    };

    catcher.addEventListener("wheel", onWheel, { passive: false });

    return () => catcher.removeEventListener("wheel", onWheel);
  }, [scrollerRef]);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- Escape and the arrow keys work wherever focus is, except in a text field
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;

      if (
        event.defaultPrevented ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();

        if (marquee !== undefined) {
          gesture.current = undefined;
          setMarquee(undefined);
        } else if (draft !== undefined) onDraftChange(undefined);
        else onExit();

        return;
      }

      const root = rootRef.current;
      const top = path.at(-1);

      if (root === null || top === undefined || draft !== undefined) return;

      if (event.key === "ArrowUp" && !hasModifier(event)) {
        const parent = meaningfulAncestor(top, root);

        event.preventDefault();

        if (parent !== undefined) setPath([...path, parent]);
      } else if (event.key === "ArrowDown" && !hasModifier(event)) {
        event.preventDefault();

        if (path.length > 1) setPath(path.slice(0, -1));
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  });

  const local = (event: PointerEvent): Point => {
    const viewport = viewportRef.current;

    if (viewport === null || frame === undefined) return { x: 0, y: 0 };
    const rect = viewport.getBoundingClientRect();

    return {
      x: (event.clientX - rect.left) / frame.zoom,
      y: (event.clientY - rect.top) / frame.zoom,
    };
  };

  const begin = (target: Target): void => {
    setPath([]);

    if (placement === "chat") {
      onAttach(target);

      return;
    }

    onDraftChange({
      target,
      comment: draft?.commentId === undefined ? (draft?.comment ?? "") : "",
    });
  };

  const pick = (clientX: number, clientY: number, shift: boolean): void => {
    const hit = hitAt(clientX, clientY);

    if (hit === undefined) return;
    const element = path[0] === hit ? (path.at(-1) ?? hit) : hit;

    const root = rootRef.current;

    if (root === null) return;

    if (shift && draft !== undefined && draft.target.kind === "element") {
      const held = draft.target.anchors.some((anchor) => findAnchor(anchor, root) === element);

      const anchors = held
        ? draft.target.anchors.filter((anchor) => findAnchor(anchor, root) !== element)
        : [...draft.target.anchors, anchorFor(element, root)];

      if (anchors.length > 0) onDraftChange({ ...draft, target: { kind: "element", anchors } });

      return;
    }

    begin({ kind: "element", anchors: [anchorFor(element, root)] });
  };

  const finishArea = (area: Box, clientCenter: Point): void => {
    const root = rootRef.current;

    if (root === null || frame === undefined) return;
    const clipped = clipBox(area, { x: 0, y: 0, width: frame.width, height: frame.height });

    if (clipped.width < MIN_AREA || clipped.height < MIN_AREA) return;

    begin({
      kind: "region",
      rect: { ...clipped, x: clipped.x - frame.origin.x, y: clipped.y - frame.origin.y },
      anchor: anchorFor(hitAt(clientCenter.x, clientCenter.y) ?? root, root),
    });
  };

  const root = rootRef.current;

  const toLocal = <Value extends Box>(box: Value): Value =>
    frame === undefined ? box : { ...box, x: box.x + frame.origin.x, y: box.y + frame.origin.y };

  const outlineAt = (element: Element): Outline =>
    root === null
      ? { x: 0, y: 0, width: 0, height: 0, radius: 0 }
      : toLocal(measureOutline(element, root));

  const scene: Scene = {
    xray:
      xray && root !== null && frame !== undefined
        ? visibleOutlines(
            root,
            { x: -frame.origin.x, y: -frame.origin.y, width: frame.width, height: frame.height },
            XRAY_LIMIT,
          ).map(toLocal)
        : [],
    covered:
      xray && marquee !== undefined && root !== null && frame !== undefined
        ? coveredOutlines(root, {
            ...marquee,
            x: marquee.x - frame.origin.x,
            y: marquee.y - frame.origin.y,
          }).map(toLocal)
        : [],
    marquee,
    hover: hovered === undefined ? undefined : outlineAt(hovered),
    selected:
      draft?.target.kind === "element" && root !== null
        ? (findElements(draft.target, root) ?? []).map(outlineAt)
        : [],
    region: draft?.target.kind === "region" ? toLocal(draft.target.rect) : undefined,
  };

  const markerBox = (target: Target): Box | undefined => {
    if (target.kind === "region") return toLocal(target.rect);
    const first = root === null ? undefined : findElements(target, root)?.[0];

    return first === undefined || root === null ? undefined : toLocal(contentBox(first, root));
  };

  const anchor = draft === undefined ? undefined : markerBox(draft.target);

  return (
    <div {...props(styles.layer)}>
      <div
        ref={catcherRef}
        {...props(styles.catcher)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = { origin: local(event), dragging: false };
        }}
        onPointerMove={(event) => {
          pointer.current = { x: event.clientX, y: event.clientY };
          const at = local(event);
          const current = gesture.current;

          setCursor(at);

          if (current === undefined) {
            hoverAt(event.clientX, event.clientY);

            return;
          }

          if (
            !current.dragging &&
            Math.hypot(at.x - current.origin.x, at.y - current.origin.y) >= DRAG_THRESHOLD
          ) {
            current.dragging = true;
          }

          if (current.dragging) setMarquee(boxBetween(current.origin, at));
        }}
        onPointerUp={(event) => {
          const current = gesture.current;

          gesture.current = undefined;

          if (current === undefined) return;

          if (!current.dragging) {
            pick(event.clientX, event.clientY, event.shiftKey);

            return;
          }

          const area = boxBetween(current.origin, local(event));
          const zoom = frame?.zoom ?? 1;
          const rect = event.currentTarget.getBoundingClientRect();

          setMarquee(undefined);
          finishArea(area, {
            x: rect.left + (area.x + area.width / 2) * zoom,
            y: rect.top + (area.y + area.height / 2) * zoom,
          });
        }}
        onPointerCancel={() => {
          gesture.current = undefined;
          setMarquee(undefined);
        }}
        onPointerLeave={() => {
          pointer.current = undefined;
          setCursor(undefined);

          if (gesture.current === undefined) setPath([]);
        }}
      />

      {frame !== undefined && (
        <OverlayCanvas width={frame.width} height={frame.height} zoom={frame.zoom} scene={scene} />
      )}

      <div aria-hidden="true" {...props(styles.glow, draft !== undefined && styles.glowOn)} />

      {comments
        .filter((comment) => comment.id !== draft?.commentId)
        .flatMap((comment) => {
          const box = markerBox(comment.target);

          if (box === undefined) return [];

          return (
            <button
              key={comment.id}
              type="button"
              aria-label={`Edit Comment ${String(comment.number)}`}
              {...props(styles.marker)}
              style={{ left: box.x - 10, top: box.y - 10 }}
              onClick={() =>
                onDraftChange({
                  target: comment.target,
                  comment: comment.comment,
                  commentId: comment.id,
                })
              }
            >
              {comment.number}
            </button>
          );
        })}

      {hovered !== undefined && frame !== undefined && (
        <Callout
          box={outlineAt(hovered)}
          anchorX={cursor?.x}
          frame={frame}
          variant="pill"
          interactive={false}
        >
          <Tag parts={splitLabel(labelFor(hovered))} />
        </Callout>
      )}

      {draft !== undefined && anchor !== undefined && frame !== undefined && (
        <Callout box={anchor} anchorX={undefined} frame={frame} variant="panel" interactive>
          <CommentPanel
            draft={draft}
            onChange={(comment) => onDraftChange({ ...draft, comment })}
            onSave={() => onSave(draft)}
            onCancel={() => onDraftChange(undefined)}
            onDelete={
              draft.commentId === undefined
                ? undefined
                : () => {
                    if (draft.commentId !== undefined) onRemove(draft.commentId);
                    onDraftChange(undefined);
                  }
            }
          />
        </Callout>
      )}
    </div>
  );
}

/**
 * react-grab's label: a surface hung under the selection by an arrow, centred on the cursor
 * (or the selection), pushed back inside the frame at its edges, and flipped above when the
 * space below runs out. The arrow keeps pointing at the anchor when the surface is pushed.
 */
function Callout({
  box,
  anchorX,
  frame,
  variant,
  interactive,
  children,
}: {
  readonly box: Box;
  readonly anchorX: number | undefined;
  readonly frame: Frame;
  readonly variant: "pill" | "panel";
  readonly interactive: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ readonly width: number; readonly height: number }>();

  // oxlint-disable-next-line nyte-code/no-direct-effect -- placement follows the label's own size as its content changes
  useEffect(() => {
    const element = ref.current;

    if (element === null) return;

    const observer = new ResizeObserver(() =>
      setSize({ width: element.offsetWidth, height: element.offsetHeight }),
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const center = Math.min(Math.max(anchorX ?? box.x + box.width / 2, box.x), box.x + box.width);
  const below = box.y + box.height + ARROW + LABEL_GAP;
  const fitsBelow = below + height <= frame.height - EDGE;
  const top = Math.max(EDGE, fitsBelow ? below : box.y - height - ARROW - LABEL_GAP);
  const left = Math.min(Math.max(center - width / 2, EDGE), frame.width - EDGE - width);
  const arrowX = Math.min(Math.max(center - left, ARROW_INSET), width - ARROW_INSET);

  return (
    <div
      ref={ref}
      {...props(styles.callout, interactive && styles.interactive)}
      style={{ left, top, opacity: size === undefined ? 0 : undefined }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <svg
        aria-hidden="true"
        width={ARROW * 2}
        height={ARROW}
        viewBox={`0 0 ${String(ARROW * 2)} ${String(ARROW)}`}
        {...props(styles.arrow, fitsBelow ? styles.arrowUp : styles.arrowDown)}
        style={{ left: arrowX }}
      >
        <path
          d={
            fitsBelow
              ? "M0 8 L7.3 0.7 A1 1 0 0 1 8.7 0.7 L16 8 Z"
              : "M0 0 L7.3 7.3 A1 1 0 0 0 8.7 7.3 L16 0 Z"
          }
        />
      </svg>
      <div {...props(styles.surface, variant === "pill" ? styles.pill : styles.panel)}>
        {children}
      </div>
    </div>
  );
}

function Tag({ parts }: { readonly parts: LabelParts }): ReactElement {
  return (
    <span {...props(styles.tag)}>
      {parts.name}
      {parts.detail !== "" && <span {...props(styles.tagDetail)}> {parts.detail}</span>}
    </span>
  );
}

/**
 * The label grown into an input: the tag stays on top, a hairline, then the comment. Return,
 * or the button, adds it to the chat composer as Cursor's ⌘L does; nothing is sent from here.
 */
function CommentPanel({
  draft,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  readonly draft: Draft;
  readonly onChange: (comment: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onDelete: (() => void) | undefined;
}): ReactElement {
  const empty = draft.comment.trim() === "";

  return (
    <div role="dialog" aria-label="Comment" {...props(styles.comment)}>
      <div {...props(styles.commentHead)}>
        <Tag parts={labelParts(draft.target)} />
        {onDelete !== undefined && (
          <button
            type="button"
            aria-label="Delete Comment"
            title="Delete Comment"
            {...props(styles.iconButton)}
            onClick={onDelete}
          >
            <Icon name="trash" size={12} />
          </button>
        )}
      </div>
      <div {...props(styles.commentBody)}>
        <textarea
          aria-label="Describe the change"
          aria-keyshortcuts="Enter Escape"
          placeholder="Describe the change"
          autoFocus
          rows={1}
          value={draft.comment}
          {...props(styles.input)}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;

            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            } else if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();

              if (!empty) onSave();
            }
          }}
        />
        <button
          type="button"
          aria-label={draft.commentId === undefined ? "Add to Chat" : "Update Comment"}
          title={draft.commentId === undefined ? "Add to Chat (Return)" : "Update Comment (Return)"}
          disabled={empty}
          {...props(styles.send)}
          onClick={onSave}
        >
          <Icon name="return" size={10} />
        </button>
      </div>
    </div>
  );
}

function measureFrame(viewport: HTMLElement, root: HTMLElement): Frame {
  const rect = viewport.getBoundingClientRect();
  const origin = root.getBoundingClientRect();
  const zoom = viewport.clientWidth === 0 ? 1 : rect.width / viewport.clientWidth;

  return {
    zoom,
    origin: { x: (origin.left - rect.left) / zoom, y: (origin.top - rect.top) / zoom },
    width: viewport.clientWidth,
    height: viewport.clientHeight,
  };
}

function hasModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
}

const styles = create({
  layer: { position: "absolute", inset: 0, overflow: "hidden" },
  catcher: { position: "absolute", inset: 0, cursor: "crosshair", touchAction: "none" },
  glow: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    opacity: 0,
    boxShadow: `inset 0 0 50px ${design.glow}`,
    transitionProperty: "opacity",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
  },
  glowOn: { opacity: 1 },
  marker: {
    position: "absolute",
    display: "grid",
    placeItems: "center",
    width: avatar.xs,
    height: avatar.xs,
    padding: 0,
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "white",
    borderRadius: "50%",
    backgroundColor: design.accent,
    color: "white",
    fontFamily: type.fontSans,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1,
    cursor: "pointer",
    boxShadow: "0 2px 6px rgb(0 0 0 / 0.25)",
  },
  callout: {
    position: "absolute",
    pointerEvents: "none",
    filter: design.labelShadow,
    fontFamily: type.fontSans,
    WebkitFontSmoothing: "antialiased",
  },
  interactive: { pointerEvents: "auto", cursor: "auto" },
  arrow: {
    position: "absolute",
    display: "block",
    zIndex: 1,
    fill: inverse.surface,
    transform: "translateX(-50%)",
  },
  arrowUp: { top: 1 - ARROW },
  arrowDown: { bottom: 1 - ARROW },
  surface: { backgroundColor: inverse.surface, color: inverse.text },
  pill: { borderRadius: 999, paddingBlock: 6, paddingInline: 8 },
  panel: { borderRadius: 14 },
  tag: {
    display: "block",
    maxWidth: 280,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    lineHeight: "16px",
    fontWeight: type.weightMedium,
  },
  tagDetail: { color: inverse.muted },
  comment: { display: "flex", flexDirection: "column", minWidth: 180, maxWidth: 280 },
  commentHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    paddingBlockStart: 6,
    paddingBlockEnd: 4,
    paddingInline: 8,
  },
  commentBody: {
    display: "flex",
    alignItems: "flex-end",
    gap: 4,
    paddingBlock: 6,
    paddingInline: 8,
    borderTopWidth: 0.5,
    borderTopStyle: "solid",
    borderTopColor: inverse.hairline,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: button.height2xs,
    maxHeight: INPUT_MAX_HEIGHT,
    margin: 0,
    padding: 0,
    borderStyle: "none",
    outline: "none",
    resize: "none",
    fieldSizing: "content",
    scrollbarWidth: "none",
    overflowWrap: "break-word",
    backgroundColor: "transparent",
    color: "inherit",
    fontFamily: "inherit",
    fontSize: 13,
    lineHeight: "16px",
    fontWeight: type.weightMedium,
    "::placeholder": { color: inverse.faint },
  },
  iconButton: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: button.height2xs,
    height: button.height2xs,
    padding: 0,
    borderStyle: "none",
    borderRadius: radius.indicator,
    backgroundColor: { default: "transparent", ":hover": inverse.hairline },
    color: { default: inverse.muted, ":hover": inverse.text },
    cursor: "pointer",
    "::before": { content: '""', position: "absolute", inset: -4 },
  },
  send: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: button.height2xs,
    height: button.height2xs,
    padding: 0,
    borderStyle: "none",
    borderRadius: "50%",
    backgroundColor: inverse.text,
    color: inverse.surface,
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.35 },
    transform: { default: "scale(1)", ":active": "scale(0.96)" },
    transitionProperty: "transform, opacity",
    transitionDuration: motion.durationFast,
    "::before": {
      content: '""',
      position: "absolute",
      inset: -4,
    },
  },
});
