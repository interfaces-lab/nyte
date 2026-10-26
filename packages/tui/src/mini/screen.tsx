import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { createMemo, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { formatWholeDuration } from "@nyte-ai/plugin/client/presentation";
import { useApp } from "../app/context.tsx";
import { GLYPHS, keycap, SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "../lib/constants.ts";
import { powerlineSegments } from "../lib/format.ts";
import type { CliTheme } from "../lib/theme.ts";
import type { HeadingChunk } from "../lib/tool-card.ts";
import { displayWidth, truncateDisplay } from "../lib/width.ts";
import type { CompletionModel } from "../model/completion.ts";
import type { FooterModel } from "../model/footer.ts";
import type { PreviewModel } from "../model/screen.ts";
import type { TurnStatus } from "../model/transcript.ts";
import { NoticeLine } from "../ui/chrome/notice.tsx";
import { Spans } from "../ui/chrome/spans.tsx";
import type { Chunk } from "../ui/chrome/spans.tsx";
import { TasksLine } from "../ui/chrome/tasks-line.tsx";
import { CompletionMenu } from "../ui/composer/completion.tsx";
import { Composer } from "../ui/composer/composer.tsx";
import { AttachmentPreview } from "../ui/composer/preview.tsx";
import { QueueRows } from "../ui/composer/queue.tsx";
import { DialogHost } from "../ui/dialogs/dialog-host.tsx";
import { Transcript } from "../ui/transcript/transcript.tsx";
import { statusLine } from "../ui/transcript/turn-status.tsx";
import { projectMiniTranscript, withoutMark } from "./transcript.ts";

const CLOCK_INTERVAL_MS = 1_000;

/** Ends of the rule that always stay dashes, so a label never reads as running into the edge. */
const RULE_END = GLYPHS.rule.repeat(2);

/**
 * The footer of the minimal mode, under the terminal's own scrollback, where the transcript
 * streams. It is two rows at rest:
 *
 *   ── ⠸ read src/app.ts 4s · esc stop ─────────── model · effort · context ──
 *   draft
 */
export function MiniScreen(): JSX.Element {
  const app = useApp();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const screen = app.screen;
  const plan = createMemo(() => projectMiniTranscript(screen().transcript, screen().tasks));

  const terminalHeight = () => {
    dimensions();

    return renderer.terminalHeight;
  };

  const limit = () => Math.max(2, Math.floor((terminalHeight() * 2) / 3));

  const activity = createMemo((): Activity | null => {
    const status = plan().status;
    const running = plan().held[0];
    const turn = status?.kind === "settled" || status?.kind === "unanswered" ? null : status;

    if (running?.kind === "tool" && (turn === null || turn.kind === "working"))
      return {
        kind: "tool",
        chunks: withoutMark(running.chunks),
        startedAt: turn === null ? null : turn.startedAt,
      };

    return turn === null ? null : { kind: "turn", status: turn };
  });

  return (
    <box
      id="mini"
      width="100%"
      flexDirection="column"
      flexShrink={0}
      maxHeight={limit()}
      overflow="hidden"
      backgroundColor={app.kit.theme().backdrop}
      onSizeChange={function () {
        const height = Math.max(2, Math.min(limit(), Math.ceil(this.getComputedLayout().height)));

        if (renderer.footerHeight !== height) renderer.footerHeight = height;
      }}
    >
      <Show when={screen().dialog === null && screen().transcript.toolOutput === "expanded"}>
        <text fg={app.kit.theme().dim} marginLeft={2} height={1} flexShrink={0}>
          {`Tool output · ${keycap("chat.tools.toggle")} close`}
        </text>
        <box height={Math.max(3, Math.floor(terminalHeight() / 3))} minHeight={1} flexShrink={1}>
          <Transcript
            model={() => screen().transcript}
            tasks={() => screen().tasks}
            attach={(port) => app.kit.attach.scroll(port)}
            onScrolled={(atBottom) => app.dispatch({ kind: "scrolled", atBottom })}
            onRevealEarlier={() => app.dispatch({ kind: "reveal-earlier" })}
            onRevealLater={() => app.dispatch({ kind: "reveal-later" })}
          />
        </box>
      </Show>
      <box flexDirection="column" flexShrink={0} visible={screen().dialog === null}>
        <Show when={activity()} fallback={<Rule label={null} />}>
          {(current: Accessor<Activity>) => <ActiveRule activity={current()} />}
        </Show>
        <QueueRows />
        <TasksLine />
        <Show when={screen().preview}>
          {(preview: Accessor<PreviewModel>) => (
            <AttachmentPreview marker={preview().marker} part={preview().part} />
          )}
        </Show>
        <Composer compact markers={screen().markers} />
        <Show when={screen().completion}>
          {(completion: Accessor<CompletionModel>) => <CompletionMenu model={completion()} />}
        </Show>
      </box>
      <Show when={screen().dialog !== null}>
        <DialogHost />
      </Show>
      <NoticeLine />
    </box>
  );
}

/**
 * What the rule shows while something runs. A running tool names itself in place of the turn's
 * generic "Working"; a question or a retry keeps the turn's own words.
 */
type Activity =
  | {
      readonly kind: "tool";
      readonly chunks: readonly HeadingChunk[];
      readonly startedAt: number | null;
    }
  | { readonly kind: "turn"; readonly status: TurnStatus };

/** What the rule shows while something runs; it ticks only while mounted. */
interface ActiveLabel {
  readonly spinner: Chunk | null;
  readonly text: readonly Chunk[];
  readonly elapsed: number | null;
}

function ActiveRule(props: { readonly activity: Activity }): JSX.Element {
  const app = useApp();
  const spin = app.kit.ticker(SPINNER_INTERVAL_MS);
  const clock = app.kit.ticker(CLOCK_INTERVAL_MS);

  const label = (): ActiveLabel => {
    clock();
    const now = app.kit.now();
    const theme = app.kit.theme();
    const activity = props.activity;
    const frame = SPINNER_FRAMES[spin() % SPINNER_FRAMES.length] ?? "";

    if (activity.kind === "tool")
      return {
        spinner: { fg: theme.running, text: frame },
        text: activity.chunks.map((chunk) => ({ fg: theme[chunk.role], text: chunk.text })),
        elapsed: activity.startedAt === null ? null : now - activity.startedAt,
      };

    const status = activity.status;
    const line = statusLine(status, theme, now);

    return {
      spinner: line.spinner === null ? null : { fg: line.spinner, text: frame },
      text: [{ fg: line.color, text: line.text.trimStart() }],
      elapsed:
        status.kind === "working" || status.kind === "thinking" ? now - status.startedAt : null,
    };
  };

  return <Rule label={label()} />;
}

/** One group of the rule; it is dropped as a whole when it does not fit. */
interface Group {
  readonly side: "left" | "right";
  readonly order: number;
  readonly lead: string;
  readonly chunks: readonly Chunk[];
}

/**
 * The rule over the composer: `── status ───── model · effort · context ──`. Groups join in
 * priority order and the first one that does not fit stops the rest, so a narrower terminal
 * loses the least important groups and a resize never swaps one group for another.
 */
function Rule(props: { readonly label: ActiveLabel | null }): JSX.Element {
  const app = useApp();
  const dimensions = useTerminalDimensions();

  const chunks = () => {
    const theme = app.kit.theme();
    const screen = app.screen();
    const width = dimensions().width - 2;
    const label = props.label;
    const stop = screen.hints.find((hint) => hint.command === "chat.interrupt");
    const session = sessionGroups(screen.footer, screen.opening, theme);

    const stopGroup: Group | null =
      label === null || stop === undefined
        ? null
        : {
            side: "left",
            order: 2,
            lead: " · ",
            chunks: [
              { fg: theme.user, text: stop.keycap },
              { fg: theme.dim, text: ` ${stop.label}` },
            ],
          };

    const required = label === null ? [] : fitLabel(label, stopGroup, width, theme);

    const optional: Group[] = [
      session.model,
      ...(session.context === null ? [] : [session.context]),
      ...(label === null || label.elapsed === null || label.elapsed < CLOCK_INTERVAL_MS
        ? []
        : [
            {
              side: "left",
              order: 1,
              lead: " ",
              chunks: [{ fg: theme.dim, text: formatWholeDuration(label.elapsed) }],
            } satisfies Group,
          ]),
      ...(session.effort === null ? [] : [session.effort]),
    ];

    return ruleChunks(
      fitGroups(required, optional, width, theme),
      width,
      theme.promptBorderFocused,
      theme.muted,
    );
  };

  return (
    <text
      id="mini-rule"
      height={1}
      flexShrink={0}
      wrapMode="none"
      selectable={false}
      marginLeft={1}
      marginRight={1}
    >
      <Spans chunks={chunks()} />
    </text>
  );
}

/** The session's model, effort and context, each its own group on the right of the rule. */
interface SessionGroups {
  readonly model: Group;
  readonly effort: Group | null;
  readonly context: Group | null;
}

function sessionGroups(footer: FooterModel, opening: boolean, theme: CliTheme): SessionGroups {
  const powerline = footer.powerline;
  const model = opening ? "Opening…" : (powerline.model ?? "Select a model with /model");

  if (opening || powerline.model === undefined)
    return { model: rightGroup(3, theme.dim, model), effort: null, context: null };

  const usage = powerlineSegments({
    tokens: powerline.tokens,
    window: powerline.window,
    pct: powerline.pct,
  }).find((segment) => segment.tone === "usage");

  const windowed = (powerline.window ?? 0) > 0;
  const pct = powerline.pct ?? 0;

  return {
    model: rightGroup(3, theme.dim, model),
    effort: powerline.effort === undefined ? null : rightGroup(4, theme.dim, powerline.effort),
    context:
      usage === undefined || (windowed && pct === 0)
        ? null
        : rightGroup(
            5,
            usage.level === "ok" ? theme.dim : theme[usage.level],
            windowed ? `${String(pct)}% context` : usage.text,
          ),
  };
}

function rightGroup(order: number, fg: string, text: string): Group {
  return { side: "right", order, lead: " · ", chunks: [{ fg, text }] };
}

/**
 * The label and the key that stops the run, which always show: the label gives up its end for
 * the key, since a control matters more than the rest of a description.
 */
function fitLabel(label: ActiveLabel, stop: Group | null, width: number, theme: CliTheme): Group[] {
  const chunks = [
    ...(label.spinner === null ? [] : [label.spinner, { fg: theme.running, text: " " }]),
    ...label.text,
  ];

  const whole: Group = { side: "left", order: 0, lead: "", chunks };
  const groups = stop === null ? [whole] : [whole, stop];
  const overflow = chunksWidth(ruleChunks(groups, width, "", theme.muted)) - width;

  if (overflow <= 0) return groups;

  const shortened = {
    ...whole,
    chunks: fitChunks(chunks, Math.max(1, chunksWidth(chunks) - overflow)),
  };

  return stop === null ? [shortened] : [shortened, stop];
}

function fitGroups(
  required: readonly Group[],
  optional: readonly Group[],
  width: number,
  theme: CliTheme,
): Group[] {
  const chosen = [...required];

  for (const group of optional) {
    const next = [...chosen, group];

    if (chunksWidth(ruleChunks(next, width, "", theme.muted)) > width) break;
    chosen.push(group);
  }

  return chosen;
}

/** The rule across `width` columns, with at least two dashes at each end and between sides. */
function ruleChunks(
  groups: readonly Group[],
  width: number,
  color: string,
  separator: string,
): Chunk[] {
  const side = (which: Group["side"]): Chunk[] =>
    groups
      .filter((group) => group.side === which)
      .toSorted((left, right) => left.order - right.order)
      .flatMap((group, index) => [
        ...(index === 0 || group.lead === "" ? [] : [{ fg: separator, text: group.lead }]),
        ...group.chunks,
      ]);

  const left = side("left");
  const right = side("right");

  const head =
    left.length === 0
      ? []
      : [{ fg: color, text: `${RULE_END} ` }, ...left, { fg: color, text: " " }];

  const tail =
    right.length === 0
      ? []
      : [{ fg: color, text: " " }, ...right, { fg: color, text: ` ${RULE_END}` }];

  const fill = width - chunksWidth(head) - chunksWidth(tail);

  return [
    ...head,
    { fg: color, text: GLYPHS.rule.repeat(Math.max(RULE_END.length, fill)) },
    ...tail,
  ];
}

function chunksWidth(chunks: readonly Chunk[]): number {
  return chunks.reduce((sum, chunk) => sum + displayWidth(chunk.text), 0);
}

function fitChunks(chunks: readonly Chunk[], width: number): Chunk[] {
  const fitted: Chunk[] = [];
  let used = 0;

  for (const chunk of chunks) {
    const text = truncateDisplay(chunk.text, width - used, GLYPHS.ellipsis);

    if (text === "") break;
    fitted.push({ fg: chunk.fg, text });
    used += displayWidth(text);
  }

  return fitted;
}
