import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { AppMessage, PageState, SheetError } from "@nyte-ai/plugin/design/board-protocol";
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

export type Refusal = Extract<AppMessage, { kind: "refused" }>["reason"] | "too-long";

const REFUSALS: Readonly<Record<Refusal, string>> = {
  changed: "File changed, try again",
  "not-editable": "Can't edit this here",
  "too-long": "Too long to save",
};

export function describeSheetError(error: SheetError): string {
  const place = [error.path, error.line, error.column].filter((part) => part !== null).join(":");

  return place === "" ? error.message : `${error.message} (${place})`;
}

/** The ring the board draws around what the pointer is on, what is selected, or the words being typed into. */
export function Ring(input: {
  readonly rect: WorldRect;
  readonly kind: "you" | "edit" | "hover";
  readonly tag: "read-only" | Refusal | null;
}): ReactElement {
  const rect = input.rect;
  const tag = input.tag;

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
      {tag === "read-only" && (
        <div {...props(boardStyles.tag)} data-read-only>
          <span {...props(text.xs, boardStyles.tagText, boardStyles.readOnly)}>Read-only</span>
        </div>
      )}
      {tag !== null && tag !== "read-only" && (
        <div {...props(intent.danger, boardStyles.tag)} data-refused={tag} role="status">
          <span {...props(text.xs, boardStyles.tagText)}>{REFUSALS[tag]}</span>
        </div>
      )}
    </div>
  );
}

export function FrameChrome(input: {
  readonly sheet: string;
  readonly frame: FrameBox;
  readonly page: PageState | null;
  readonly at: Point;
  /** Where the person is carrying the frame: it lifts over the others, and says where it is. */
  readonly held: Point | null;
  /** How far the frame starts below the frame over it, in board pixels; its label shows only where it fits. */
  readonly room: number;
  readonly lit: boolean;
  /** The pointer is on the frame: with its label hidden, its name shows above it. */
  readonly pointed: boolean;
  readonly glowing: boolean;
  readonly error: SheetError | null;
}): ReactElement {
  const frame = input.frame;
  const error = input.error === null ? null : describeSheetError(input.error);
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
      data-page-state={input.page ?? undefined}
    >
      {input.page !== null && (
        <div {...props(boardStyles.page)} data-page-cover>
          <span {...props(text.sm, boardStyles.address)}>
            {frame.page?.replace(/^https?:\/\//u, "")}
          </span>
        </div>
      )}
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
        {error !== null && (
          <span {...props(intent.danger, boardStyles.labelError)} title={error} data-error>
            {error}
          </span>
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
