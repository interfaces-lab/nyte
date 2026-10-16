import { useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { createMemo, For, Show } from "solid-js";
import { useApp } from "../../app/context.tsx";
import { MOON_FRAMES, MOON_RAMP } from "../../lib/moon.ts";
import { displayWidth } from "../../lib/width.ts";
import { Spans } from "./spans.tsx";
import { Spinner } from "./spinner.tsx";
import type { Chunk } from "./spans.tsx";

const MOON_FRAME_MS = 250;

const MOON_MIN_WIDTH = 80;

const MOON_MIN_HEIGHT = 30;

const HINTS = [
  { text: "@", key: true },
  { text: " for files · ", key: false },
  { text: "!", key: true },
  { text: " for shell", key: false },
] as const;

const HINTS_WIDTH = displayWidth(HINTS.map((hint) => hint.text).join(""));

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

function Moon(): JSX.Element {
  const app = useApp();
  const tick = app.kit.ticker(MOON_FRAME_MS);

  const shades = createMemo(() =>
    Array.from({ length: MOON_RAMP.length }, (_, level) =>
      mix(app.kit.theme().muted, app.kit.theme().moon, (level / (MOON_RAMP.length - 1)) ** 0.7),
    ),
  );

  const rows = createMemo(() =>
    (MOON_FRAMES[tick() % MOON_FRAMES.length] ?? "").split("\n").map((line) => {
      const chunks: Chunk[] = [];

      for (const character of line) {
        const fg = shades()[MOON_RAMP.indexOf(character)] ?? app.kit.theme().muted;
        const last = chunks.at(-1);

        if (last?.fg === fg) chunks[chunks.length - 1] = { fg, text: last.text + character };
        else chunks.push({ fg, text: character });
      }

      return chunks;
    }),
  );

  return (
    <box flexDirection="column" flexShrink={0}>
      <For each={rows()}>
        {(chunks) => (
          <text height={1} wrapMode="none" selectable={false}>
            <Spans chunks={chunks} />
          </text>
        )}
      </For>
    </box>
  );
}

export function Welcome(props: { readonly opening: boolean }): JSX.Element {
  const app = useApp();
  const dimensions = useTerminalDimensions();
  const theme = () => app.kit.theme();

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
    >
      <Show when={dimensions().width >= MOON_MIN_WIDTH && dimensions().height >= MOON_MIN_HEIGHT}>
        <Moon />
      </Show>
      <box flexDirection="column" flexShrink={0} minWidth={HINTS_WIDTH}>
        <text fg={theme().moon}>Welcome to Nyte</text>
        <Show when={!props.opening} fallback={<Spinner color={theme().dim} />}>
          <text wrapMode="none">
            <For each={HINTS}>
              {(hint) => (
                <span style={{ fg: hint.key ? theme().foreground : theme().dim }}>{hint.text}</span>
              )}
            </For>
          </text>
        </Show>
      </box>
    </box>
  );
}
