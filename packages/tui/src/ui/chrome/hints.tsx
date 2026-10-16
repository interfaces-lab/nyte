import { useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { useApp } from "../../app/context.tsx";
import type { CliTheme } from "../../lib/theme.ts";
import { displayWidth } from "../../lib/width.ts";
import type { Hint } from "../../model/footer.ts";
import { Spans } from "./spans.tsx";
import type { Chunk } from "./spans.tsx";

export function hintChunks(hints: readonly Hint[], theme: CliTheme, width: number): Chunk[] {
  const chunks: Chunk[] = [];
  let used = 0;

  for (const hint of hints) {
    const separator = chunks.length === 0 ? "  " : " · ";
    const label = hint.label === "" ? "" : ` ${hint.label}`;
    const size = displayWidth(`${separator}${hint.keycap}${label}`);

    if (used + size > width) break;
    chunks.push({ fg: theme.muted, text: separator }, { fg: theme.user, text: hint.keycap });

    if (label !== "") chunks.push({ fg: theme.dim, text: label });
    used += size;
  }

  return chunks;
}

export function Hints(): JSX.Element {
  const app = useApp();
  const dimensions = useTerminalDimensions();

  return (
    <text
      id="hints"
      height={1}
      flexShrink={0}
      wrapMode="none"
      selectable={false}
      marginLeft={1}
      marginRight={1}
    >
      <Spans chunks={hintChunks(app.screen().hints, app.kit.theme(), dimensions().width - 2)} />
    </text>
  );
}
