/**
 * The composer frame's lower rule, carrying the powerline from
 * `screen().footer`. Segments drop as the rule narrows (usage, workspace,
 * queue, effort); the model always stays.
 */
import { useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { useApp } from "../../app/context.tsx";
import { GLYPHS } from "../../lib/constants.ts";
import { fitPowerlineSegments, powerlineSegments } from "../../lib/format.ts";
import type { PowerlineSegment, PowerlineState } from "../../lib/format.ts";
import type { CliTheme } from "../../lib/theme.ts";
import { displayWidth, truncateDisplay } from "../../lib/width.ts";
import { Spans } from "./spans.tsx";
import type { Chunk } from "./spans.tsx";

function segmentColor(theme: CliTheme, segment: PowerlineSegment): string {
  switch (segment.tone) {
    case "workspace":
      return theme.path;
    case "model":
      return theme.accent;
    case "effort":
      return theme.thinking;
    case "queue":
      return theme.warning;
    case "usage":
      if (segment.level === "error") return theme.error;

      return segment.level === "warning" ? theme.warning : theme.dim;
    default: {
      const _exhaustive: never = segment;

      return _exhaustive;
    }
  }
}

/** `╰─ seg │ seg ───╯` across `width` cells, each segment coloured by its role. */
export function powerlineChunks(
  powerline: Partial<PowerlineState>,
  width: number,
  theme: CliTheme,
  border: string,
): Chunk[] {
  const frame = Math.max(0, Math.floor(width));

  if (frame === 0) return [];

  if (frame === 1) return [{ fg: border, text: GLYPHS.rule }];

  if (frame < 6)
    return [
      {
        fg: border,
        text: `${GLYPHS.frameBottomLeft}${GLYPHS.rule.repeat(frame - 2)}${GLYPHS.frameBottomRight}`,
      },
    ];

  const caption = frame - 5;
  const chunks: Chunk[] = [{ fg: border, text: `${GLYPHS.frameBottomLeft}${GLYPHS.rule}` }];
  let used = 0;

  for (const [index, segment] of fitPowerlineSegments(
    powerlineSegments(powerline),
    caption,
  ).entries()) {
    const separator = truncateDisplay(index === 0 ? " " : ` ${GLYPHS.separator} `, caption - used);

    if (separator === "") break;
    chunks.push({ fg: border, text: separator });
    used += displayWidth(separator);
    const text = truncateDisplay(segment.text, caption - used);

    if (text === "") break;
    chunks.push({ fg: segmentColor(theme, segment), text });
    used += displayWidth(text);
  }

  chunks.push({
    fg: border,
    text: ` ${GLYPHS.rule.repeat(Math.max(1, frame - used - 4))}${GLYPHS.frameBottomRight}`,
  });

  return chunks;
}

export function Footer(props: { readonly focused: boolean }): JSX.Element {
  const app = useApp();
  const dimensions = useTerminalDimensions();

  return (
    <text
      id="powerline"
      height={1}
      flexShrink={0}
      wrapMode="none"
      selectable={false}
      marginLeft={1}
      marginRight={1}
    >
      <Spans
        chunks={powerlineChunks(
          app.screen().footer.powerline,
          dimensions().width - 2,
          app.kit.theme(),
          props.focused ? app.kit.theme().promptBorderFocused : app.kit.theme().promptBorder,
        )}
      />
    </text>
  );
}
