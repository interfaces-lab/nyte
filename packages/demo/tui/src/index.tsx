/**
 * The smallest Nyte chat in a terminal: one new session in this folder, its
 * messages above, an input below. Enter sends, Esc stops the run, Ctrl+C quits.
 * Sign in first with `nyte login`; this demo reuses that login. Run it with
 * `pnpm --dir packages/demo/tui start` (Bun reads the Solid preload from this
 * package's bunfig.toml).
 */
import { isPart, text, tool } from "@nyte-ai/plugin/client";
import { sdk } from "@nyte-ai/sdk";
import type { Message, SessionView } from "@nyte-ai/sdk";
import { createCliRenderer } from "@opentui/core";
import type { ThemeMode } from "@opentui/core";
import { render, useKeyboard } from "@opentui/solid";
import { createSignal, Index, Show } from "solid-js";
import type { Accessor } from "solid-js";

/** OpenTUI paints unset text white, so every color is set from the terminal's own scheme. */
const PALETTES = {
  dark: { foreground: "#fafafa", dim: "#737373", accent: "#009fff", error: "#ff2e3f" },
  light: { foreground: "#0a0a0a", dim: "#737373", accent: "#1a85d4", error: "#d52c36" },
} as const;

const renderer = await createCliRenderer({ exitOnCtrlC: false });

const [themeMode, setThemeMode] = createSignal<ThemeMode>(
  (await renderer.waitForThemeMode()) ?? "dark",
);

renderer.on("theme_mode", (mode: ThemeMode) => setThemeMode(mode));

const palette = () => PALETTES[themeMode()];

const host = await sdk.open({});

const session = await host.sessions.create({});

const [view, setView] = createSignal<SessionView | null>(null);

const [error, setError] = createSignal<string | null>(null);

void (async () => {
  for await (const next of session.watch()) setView(next);
})();

interface Line {
  readonly mark: string;
  readonly text: string;
  readonly tone: "foreground" | "dim";
}

/** What one message shows: the user's text, the model's prose, a tool's name; nothing else. */
function lineOf(message: Message): Line | null {
  if (message.kind === "user") {
    const { content } = message;

    return {
      mark: "› ",
      text:
        typeof content === "string"
          ? content
          : content.flatMap((part) => (part.kind === "text" ? [part.text] : [])).join(""),
      tone: "foreground",
    };
  }

  if (isPart(message, text)) return { mark: "", text: message.state.markdown, tone: "foreground" };

  if (isPart(message, tool)) return { mark: "", text: `· ${message.state.name}`, tone: "dim" };

  return null;
}

function App() {
  const [draft, setDraft] = createSignal("");
  const execution = () => view()?.execution;
  const busy = () => (execution()?.kind ?? "idle") !== "idle";

  const failure = () => {
    const current = execution();
    const end = current?.kind === "idle" ? current.lastRun?.end : undefined;

    return error() ?? (end?.kind === "failed" ? end.failure.message : null);
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") void host.close().finally(() => renderer.destroy());

    if (key.name === "escape" && busy()) void session.stop();
  });

  return (
    <box flexDirection="column" height="100%" padding={1}>
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
        <box flexDirection="column" gap={1}>
          <Index each={(view()?.messages ?? []).flatMap((message) => lineOf(message) ?? [])}>
            {(line) => (
              <text wrapMode="word" fg={palette()[line().tone]}>
                <span style={{ fg: palette().accent }}>{line().mark}</span>
                {line().text}
              </text>
            )}
          </Index>
        </box>
      </scrollbox>
      <Show when={busy()}>
        <text fg={palette().dim}>Working… esc to stop</text>
      </Show>
      <Show when={failure()}>
        {(message: Accessor<string>) => <text fg={palette().error}>{message()}</text>}
      </Show>
      <box
        border
        borderStyle="rounded"
        borderColor={palette().dim}
        height={3}
        flexShrink={0}
        paddingLeft={1}
      >
        <input
          focused
          textColor={palette().foreground}
          focusedTextColor={palette().foreground}
          placeholderColor={palette().dim}
          cursorColor={palette().accent}
          value={draft()}
          placeholder="Message Nyte"
          onInput={setDraft}
          onSubmit={() => {
            const value = draft();

            if (value.trim() === "") return;
            setDraft("");
            setError(null);
            session.send(value).catch((cause: unknown) => setError(String(cause)));
          }}
        />
      </box>
    </box>
  );
}

await render(() => <App />, renderer);
