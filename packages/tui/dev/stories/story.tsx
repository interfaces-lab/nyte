import { asId } from "@nyte-ai/schema";
import { CliRenderEvents } from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import { commandBindings } from "@opentui/keymap/extras";
import { useRenderer } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { AppProvider, useApp } from "../../src/app/context.tsx";
import { createKeymap } from "../../src/app/keyboard.ts";
import type { AppKeymap } from "../../src/app/keyboard.ts";
import { installKeymap } from "../../src/app/keymap.ts";
import { createKit } from "../../src/app/kit.ts";
import { installSinks } from "../../src/app/sinks.ts";
import { createStore } from "../../src/app/store.ts";
import type { Store } from "../../src/app/store.ts";
import { createTickers } from "../../src/app/ticker.ts";
import { createReporter } from "../../src/effects/crash.ts";
import type { Ports } from "../../src/effects/ports.ts";
import { createRunner } from "../../src/effects/runner.ts";
import type { Runner } from "../../src/effects/runner.ts";
import type { Effect } from "../../src/model/effect.ts";
import type { Msg } from "../../src/model/msg.ts";
import type { State, TerminalFacts } from "../../src/model/state.ts";
import { Spans } from "../../src/ui/chrome/spans.tsx";
import type { Chunk } from "../../src/ui/chrome/spans.tsx";
import { fakeHost, fakePorts } from "../../test/fixture/ports.ts";

/** Every story key, by command name. Function keys stay clear of the app's own bindings. */
export const STORY_KEYBINDS = {
  "story.reset": "f9",
  "composer.story.run": "f1",
  "composer.story.queue": "f2",
  "composer.story.follow-up": "f3",
  "composer.story.chat": "f4",
  "composer.story.tasks": "f5",
} as const satisfies Readonly<Record<string, string>>;

export type StoryCommand = Exclude<keyof typeof STORY_KEYBINDS, "story.reset">;

/** One state dimension: a key cycles it and the story footer shows its value. */
export interface Control<D> {
  readonly command: StoryCommand;
  readonly label: string;
  cycle(dimensions: D): D;
  shown(dimensions: D): string;
}

export interface StorySpec<D> {
  readonly id: string;
  readonly title: string;
  readonly initial: D;
  readonly controls: readonly Control<D>[];
  /** The fixture state a mount and a reset start from. */
  fixture(): State;
  /** The facts that put the store in these dimensions; dispatched through the real reducer on every change. */
  facts(dimensions: D, state: State, now: number): readonly Msg[];
  /** The production component under test. */
  view(): JSX.Element;
}

export interface Story {
  readonly id: string;
  readonly title: string;
  readonly Root: (props: { readonly onExit: (code: number) => void }) => JSX.Element;
}

export function defineStory<D>(spec: StorySpec<D>): Story {
  return {
    id: spec.id,
    title: spec.title,
    Root: (props) => <StoryApp spec={spec} onExit={props.onExit} />,
  };
}

/**
 * Effects whose handlers reach past the ports: self-update downloads a binary, and
 * refresh-workspace reads git in the fixture's made-up folder. A story counts them and runs nothing.
 */
const SKIPPED: ReadonlySet<Effect["kind"]> = new Set(["self-update", "refresh-workspace"]);

/** Effects the composer and transcript run on themselves; everything else is a side effect the footer counts. */
const INTERNAL: ReadonlySet<Effect["kind"]> = new Set(["composer", "scroll"]);

/**
 * Runs effects over the fake ports. A send is acknowledged at once instead: the fake host
 * follows no chat, so the real handler would refuse it.
 */
function keepLocal(
  runner: Runner,
  dispatch: (msg: Msg) => void,
  record: (kind: Effect["kind"]) => void,
): Runner {
  return {
    ...runner,
    run(effect) {
      if (!INTERNAL.has(effect.kind)) record(effect.kind);

      if (effect.kind === "send")
        dispatch({
          kind: "sent",
          submission: effect.submission.id,
          message: asId(`story-${effect.submission.id}`),
        });
      else if (!SKIPPED.has(effect.kind)) runner.run(effect);
    },
  };
}

function StoryApp<D>(props: {
  readonly spec: StorySpec<D>;
  readonly onExit: (code: number) => void;
}): JSX.Element {
  const renderer = useRenderer();
  const keymap = createKeymap(renderer);
  const [dimensions, setDimensions] = createSignal(props.spec.initial);
  const [generation, setGeneration] = createSignal(1);

  const bindings: Readonly<Record<string, string>> = Object.fromEntries([
    ["story.reset", STORY_KEYBINDS["story.reset"]],
    ...props.spec.controls.map((control) => [control.command, STORY_KEYBINDS[control.command]]),
  ]);

  onCleanup(
    keymap.registerLayer({
      priority: 150,
      commands: [
        {
          name: "story.reset",
          run() {
            setDimensions(() => props.spec.initial);
            setGeneration((count) => count + 1);
          },
        },
        ...props.spec.controls.map((control) => ({
          name: control.command,
          run() {
            setDimensions((current) => control.cycle(current));
          },
        })),
      ],
      bindings: commandBindings(bindings),
    }),
  );

  return (
    <Show when={generation()} keyed>
      <Fixture spec={props.spec} keymap={keymap} dimensions={dimensions} onExit={props.onExit} />
    </Show>
  );
}

/** One store's lifetime: the real reducer, runner, kit and keymap over fake ports, so nothing leaves the process. */
function Fixture<D>(props: {
  readonly spec: StorySpec<D>;
  readonly keymap: AppKeymap;
  readonly dimensions: Accessor<D>;
  readonly onExit: (code: number) => void;
}): JSX.Element {
  const renderer = useRenderer();
  const { spec } = props;
  const fakes = fakePorts(fakeHost());
  const ports: Ports = { ...fakes, clock: renderer.clock };
  const controller = new AbortController();
  const [kept, setKept] = createSignal<readonly Effect["kind"][]>([]);

  const report = createReporter(ports.log, (failure) =>
    store.dispatch({ kind: "failure", failure }),
  );

  const store: Store = createStore({
    initial: spec.fixture(),
    now: () => renderer.clock.now(),
    report,
    runner: (context) =>
      keepLocal(
        createRunner({
          ports,
          read: context.read,
          dispatch: context.dispatch,
          signal: controller.signal,
          opened: Promise.resolve(),
        }),
        context.dispatch,
        (effect) => setKept((list) => [...list, effect]),
      ),
  });

  const sinks = installSinks(store, ports.terminal);
  const tickers = createTickers(renderer.clock);

  const kit = createKit({
    renderer,
    theme: sinks.theme,
    tickers,
    blob: (id) => ports.host.blob(id),
    drawPart: () => null,
    attach: {
      composer: (port) => ports.composer.attach(port),
      scroll: (port) => ports.scroll.attach(port),
    },
    report,
  });

  const uninstallKeymap = installKeymap({
    renderer,
    keymap: props.keymap,
    store,
    fallen: () => null,
    quit: () => props.onExit(0),
  });

  const syncTerminal = (): void => {
    store.dispatch({ kind: "terminal", terminal: readTerminal(renderer) });
  };

  syncTerminal();
  renderer.on(CliRenderEvents.RESIZE, syncTerminal);
  void store.runner.exited.then(({ code }) => props.onExit(code));

  createEffect(
    on(props.dimensions, (dimensions) => {
      for (const msg of spec.facts(dimensions, store.state(), renderer.clock.now()))
        store.dispatch(msg);
    }),
  );

  onCleanup(() => {
    renderer.off(CliRenderEvents.RESIZE, syncTerminal);
    uninstallKeymap();
    controller.abort();
    void store.runner.dispose();
    sinks.dispose();
    tickers.dispose();
    kit.dispose();
    store.dispose();
  });

  return (
    <AppProvider app={{ screen: store.screen, dispatch: store.dispatch, kit }}>
      <box id="story" width="100%" height="100%" flexDirection="column">
        <box flexGrow={1} minHeight={0}>
          {spec.view()}
        </box>
        <StoryFooter spec={spec} dimensions={props.dimensions} kept={kept} />
      </box>
    </AppProvider>
  );
}

function keycap(command: keyof typeof STORY_KEYBINDS): string {
  return STORY_KEYBINDS[command].toUpperCase();
}

/** The story's own footer: each key with the dimension it cycles and its value, the reset key, and the side effects kept local. */
function StoryFooter<D>(props: {
  readonly spec: StorySpec<D>;
  readonly dimensions: Accessor<D>;
  readonly kept: Accessor<readonly Effect["kind"][]>;
}): JSX.Element {
  const app = useApp();

  const chunks = (): Chunk[] => {
    const { user: key, dim: label, foreground: value } = app.kit.theme();
    const effects = props.kept();
    const last = effects.at(-1);

    return [
      { fg: value, text: `story ${props.spec.id}  ` },
      ...props.spec.controls.flatMap((control) => [
        { fg: key, text: keycap(control.command) },
        { fg: label, text: ` ${control.label} ` },
        { fg: value, text: control.shown(props.dimensions()) },
        { fg: label, text: "  " },
      ]),
      { fg: key, text: keycap("story.reset") },
      { fg: label, text: " reset  " },
      {
        fg: label,
        text:
          last === undefined
            ? "no side effects yet"
            : `kept local: ${String(effects.length)} (last ${last})`,
      },
    ];
  };

  return (
    <text
      id="story-footer"
      flexShrink={0}
      wrapMode="word"
      selectable={false}
      marginLeft={1}
      marginRight={1}
    >
      <Spans chunks={chunks()} />
    </text>
  );
}

function readTerminal(renderer: CliRenderer): TerminalFacts {
  return {
    width: renderer.terminalWidth,
    height: renderer.terminalHeight,
    theme: renderer.themeMode,
    selection: renderer.hasSelection,
    dragging: renderer.getSelection()?.isDragging ?? false,
    hyperlinks: renderer.capabilities?.hyperlinks === true,
  };
}
