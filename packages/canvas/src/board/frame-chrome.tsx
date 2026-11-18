import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { mergeStyleProps } from "@nyte-ai/ui/style";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { boardStyles } from "./board.stylex.ts";
import type { FrameBox } from "./sheets.ts";

export interface WorldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The ring the board draws around what the pointer is on, what is selected, or the words being typed into. */
export function Ring(input: {
  readonly rect: WorldRect;
  readonly kind: "you" | "edit" | "hover";
  readonly readOnly: boolean;
}): ReactElement {
  const rect = input.rect;

  return (
    <div
      {...props(intent.primary, boardStyles.ring, input.kind === "hover" && boardStyles.hovered)}
      data-ring={input.kind}
      style={{
        insetInlineStart: rect.x,
        insetBlockStart: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    >
      {input.readOnly && (
        <div {...props(boardStyles.tag)} data-read-only>
          <span {...props(text.xs, boardStyles.tagText, boardStyles.readOnly)}>Read-only</span>
        </div>
      )}
    </div>
  );
}

/**
 * What the board draws over a frame: its edge, its name, where it is while carried, and an agent's change to it. A name
 * that ends in a variant, `Tonight · night`, shortens its name before its variant.
 */
export function FrameChrome(input: {
  readonly sheet: string;
  readonly frame: FrameBox;
  readonly at: Point;
  /** Where the person is carrying the frame: it lifts over the others, and says where it is. */
  readonly held: Point | null;
  /** How far the frame starts below the frame over it, in board pixels; its label shows only where it fits. */
  readonly room: number;
  readonly lit: boolean;
  /** The pointer is on the frame: with its label hidden, its name shows above it. */
  readonly pointed: boolean;
  readonly glowing: boolean;
}): ReactElement {
  const frame = input.frame;
  const place = input.held ?? frame;
  const corners = getComputedStyle(frame.node).borderRadius;
  const variant = frame.name.lastIndexOf(" · ");

  return (
    <div
      {...mergeStyleProps(
        props(
          boardStyles.box,
          boardStyles.room(input.room),
          (input.held !== null || input.pointed) && boardStyles.raised,
        ),
        undefined,
        {
          insetInlineStart: input.at.x + place.x,
          insetBlockStart: input.at.y + place.y,
          width: frame.width,
          height: frame.height,
          borderRadius: corners,
        },
      )}
      data-frame-box={frame.key}
      data-sheet={input.sheet}
    >
      <div
        {...props(
          text.sm,
          input.lit && intent.primary,
          boardStyles.label,
          !frame.movable && boardStyles.labelFixed,
          input.lit && boardStyles.labelLit,
        )}
        data-label={frame.key}
        data-name={frame.name}
      >
        <span {...props(boardStyles.labelName)}>
          {variant === -1 ? frame.name : frame.name.slice(0, variant)}
        </span>
        {variant !== -1 && (
          <span {...props(boardStyles.labelVariant)}>{frame.name.slice(variant)}</span>
        )}
      </div>
      {input.pointed && (
        <div {...props(boardStyles.name)}>
          <span {...props(text.xs, boardStyles.nameText)}>{frame.name}</span>
        </div>
      )}
      {input.held !== null && (
        <>
          <div {...props(boardStyles.held)} style={{ borderRadius: corners }} />
          <div {...props(intent.primary, boardStyles.tag)} data-place>
            <span {...props(text.xs, boardStyles.tagText)}>
              {`${String(input.held.x)}, ${String(input.held.y)}`}
            </span>
          </div>
        </>
      )}
      <div
        {...props(
          surfaceTheme.orange,
          boardStyles.ring,
          boardStyles.glow,
          input.glowing && boardStyles.glowLit,
        )}
        data-glow={input.glowing ? "on" : undefined}
      >
        {input.glowing && <div {...props(boardStyles.dot)} />}
      </div>
    </div>
  );
}
