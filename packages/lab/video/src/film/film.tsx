import { Audio } from "@remotion/media";
import type { ReactNode } from "react";
import { AbsoluteFill, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { asId } from "@nyte-ai/schema";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { ComposerFrame } from "@nyte-ai/app/conversation/composer-frame.tsx";
import { ModelPicker } from "@nyte-ai/app/conversation/model-picker.tsx";
import { StatusMarker } from "@nyte-ai/app/conversation/row-surfaces.tsx";
import type { QuestionDock } from "@nyte-ai/app/conversation/tray/questions-state.ts";
import { Kbd } from "@nyte-ai/ui/kbd";
import {
  INTERRUPTED,
  NEEDS_INPUT,
  RUNNING,
  WORKING,
  call,
  custom,
  ok,
  part,
  shell,
  touched,
  turn,
  user,
} from "../../../src/messages/build";
import { labModel, modelCatalog } from "../../../src/shell/fixtures";
import { App } from "../app/setup";
import { staged } from "../app/staging";
import { Row } from "../app/transcript";
import { edited, markAt, prompt, sessionAt } from "./chat";
import { Ending, length, night } from "./ending";
import { Field, Moon, ditherStyle, palette, rgb } from "./dither";
import { beat, beats, durationInFrames } from "./timeline";
import { Wheel, Words, ease, font, progress, rolled, sentence } from "./type";
import { Window, size } from "./window";
import type { Layer } from "./layer";

const noop = () => {};
const submitNothing = () => false;
const gpt = modelCatalog.models.find((option) => option.name.startsWith("GPT")) ?? labModel;

/* ───────────────────────────── the opening strip ───────────────────────────── */

const noSuggestions = { status: "ready", data: { commands: [], skills: [] } } as const;
const noFiles = { status: "ready", data: [] } as const;

const rowOf = (scene: Parameters<typeof staged>[0]) => {
  const stage = staged(scene);
  const row = stage.rows.find((item) => item.kind !== "live" && !(item.kind === "part" && item.message.kind === "user"));
  return row ? <Row row={row} stage={stage} /> : null;
};

const running = rowOf({ turns: [turn([user("x"), call(shell("pnpm test"), RUNNING, 1)], WORKING)], execution: { kind: "live", run: { id: asId<"run">("lab-run") } as never, phase: "executing", stopping: false } });
const interrupted = rowOf({ turns: [turn([user("x"), call(shell("pnpm test"), INTERRUPTED, 1)], WORKING)] });
const needs = rowOf({ turns: [turn([user("x"), call(custom("Ask user"), NEEDS_INPUT, 1)], WORKING)] });
const summary = rowOf({ turns: [turn([part("branchSummary", "note", { markdown: "x" }, 0)])] });
const changes = (() => {
  const stage = staged({ turns: [turn([user("x"), call(touched("packages/core/src/store/migrations.ts"), ok(), 1), call(touched("packages/core/src/contract/records.ts"), ok(), 2)])] });
  const row = stage.rows.find((item) => item.kind === "changes");
  return row ? <Row row={row} stage={stage} /> : null;
})();

interface Item {
  readonly node: ReactNode;
  readonly zoom: number;
  /** Where in the item the camera centres, from its top left. */
  readonly focus: readonly [number, number];
  readonly width: number;
}

const items: readonly Item[] = [
  { node: <StatusDot mark="working" />, zoom: 22, focus: [8, 8], width: 16 },
  {
    node: (
      <ComposerFrame surface="follow-up" document={{ text: "", selectionStart: 0, selectionEnd: 0 }} onDocumentChange={noop} onSubmit={submitNothing} placeholder="Add a follow-up" suggestionCatalog={noSuggestions} mentionFiles={noFiles} />
    ),
    zoom: 7,
    focus: [580, 20],
    width: 600,
  },
  { node: running, zoom: 5.6, focus: [100, 12], width: 600 },
  { node: interrupted, zoom: 5.6, focus: [110, 12], width: 600 },
  { node: <StatusMarker role="status" variant="retrying">Retrying…</StatusMarker>, zoom: 6.4, focus: [60, 12], width: 600 },
  { node: needs, zoom: 5.6, focus: [90, 12], width: 600 },
  { node: summary, zoom: 6, focus: [70, 12], width: 600 },
  { node: <ModelPicker catalog={modelCatalog} current={labModel} thinkingLevel="high" fast={false} onChange={noop} />, zoom: 5.4, focus: [80, 14], width: 300 },
  { node: changes, zoom: 3.2, focus: [300, 40], width: 600 },
];

const pitch = 1200;
const stripAt = items.map((_, index) => (index === 0 ? 0 : 15 + index * beat));

function Strip() {
  const frame = useCurrentFrame();
  if (frame >= beats.composer + 4) return null;

  const position = stripAt.reduce((sum, at, index) => (index === 0 ? 0 : sum + (frame >= at ? 1 : 0)), 0);
  const zoom = interpolate(position, items.map((_, index) => index), items.map((item) => item.zoom));
  const x = interpolate(position, items.map((_, index) => index), items.map((item, index) => index * pitch + item.focus[0]));
  const y = interpolate(position, items.map((_, index) => index), items.map((item) => item.focus[1]));
  const intro = progress(frame, 0, 18);
  const leave = progress(frame, beats.composer - 6, 8);
  const blur = 0;

  return (
    <AbsoluteFill style={{ background: "#1c1c1e", ...ditherStyle(intro * (1 - leave), 3) }}>
      <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", filter: `blur(${blur}px)`, transform: `translate(960px, 540px) scale(${zoom}) translate(${-x}px, ${-y}px)` }}>
        {items.map((item, index) => (
          <div key={index} style={{ position: "absolute", left: index * pitch, top: 0, width: item.width }}>
            {item.node}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

/* ───────────────────────────── the window and its camera ───────────────────────────── */

/** The window sits at the frame's centre when the camera is at rest. */
const origin = { x: 960 - size.width / 2, y: 540 - size.height / 2 } as const;

/** Points of interest, in frame coordinates at rest. */
const at = {
  composer: { x: 1092, y: 948 },
  send: { x: 1440, y: 948 },
  transcript: { x: 1092, y: 330 },
  prompt: { x: 1092, y: 210 },
  sidebarRow: { x: 360, y: 292 },
  tray: { x: 1092, y: 790 },
  whole: { x: 960, y: 540 },
};

/** The window at rest on the right, leaving the left of the frame to a caption. */
const aside = { x: 960 - (1230 - 960) / 0.7, y: 540, zoom: 0.7 };

interface Key {
  readonly at: number;
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

const key = (frame: number, point: { x: number; y: number }, zoom: number): Key => ({ at: frame, x: point.x, y: point.y, zoom });

const camera: readonly Key[] = [
  key(beats.composer, at.composer, 2.0),
  key(beats.send - 14, at.composer, 2.1),
  key(beats.send + 2, at.send, 3.1),
  key(beats.send + 42, { x: 1092, y: 300 }, 1.65),
  key(beats.hand - 10, { x: 1092, y: 330 }, 1.55),
  key(beats.hand + 22, aside, aside.zoom),
  key(beats.reopen + 20, aside, aside.zoom),
  key(beats.reopen + 50, at.transcript, 2.7),
  key(beats.reopen + 95, { x: 1092, y: 330 }, 2.1),
  key(beats.reopen + 135, { x: 1092, y: 300 }, 1.6),
  key(beats.branchFocus + 30, at.prompt, 2.6),
  key(beats.branchSend, { x: 1092, y: 240 }, 2.4),
  key(beats.branchSend + 40, { x: 1092, y: 300 }, 1.7),
  key(beats.branch + 50, aside, aside.zoom),
  key(beats.ask + 50, aside, aside.zoom),
  key(beats.ask + 68, at.tray, 2.2),
  key(beats.ask + 84, at.sidebarRow, 3.0),
  key(beats.select - 22, at.sidebarRow, 3.0),
  key(beats.select - 4, at.tray, 2.4),
  key(beats.answer + 22, at.tray, 2.1),
  key(beats.answer + 62, { x: 1092, y: 320 }, 1.7),
  key(beats.pull + 20, { x: 1040, y: 520 }, 1.1),
  key(beats.pull + 70, { x: 960, y: 470 }, 0.56),
  key(beats.end, { x: 960, y: 470 }, 0.48),
];

function look(frame: number, pick: (key: Key) => number) {
  return interpolate(frame, camera.map((entry) => entry.at), camera.map(pick), { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

function question(selected: boolean, pending: boolean): QuestionDock {
  const field = {
    header: "Run format",
    question: "Keep the old run format readable?",
    options: [
      { label: "Keep both", description: "Read old runs, write the new format." },
      { label: "Migrate all", description: "Rewrite every stored run once." },
    ],
  };
  return {
    request: { part: asId<"part">("film-question"), questions: [field] },
    field,
    origin: "Migrate stored runs",
    current: 0,
    total: 1,
    last: true,
    document: { text: "", selectionStart: 0, selectionEnd: 0 },
    pending,
    settled: false,
    error: undefined,
    answered: [selected],
    isSelected: (label: string) => selected && label === "Keep both",
    select: noop,
    changeDocument: noop,
    jump: noop,
    advance: async () => {},
    dismiss: async () => {},
  } as unknown as QuestionDock;
}

function Desktop() {
  const frame = useCurrentFrame();
  if (frame < beats.composer - 2 || frame >= beats.end + 10) return null;

  const x = look(frame, (entry) => entry.x);
  const y = look(frame, (entry) => entry.y);
  const zoom = look(frame, (entry) => entry.zoom);
  const previous = look(frame - 1, (entry) => entry.zoom);
  const blur = Math.min(2.5, Math.abs(Math.log(zoom / previous)) * 90);

  const typed = frame < beats.send ? prompt.slice(0, Math.max(0, Math.floor((frame - beats.typing) / 3))) : "";
  const mark = markAt(frame);
  const editing = frame >= beats.editStart && frame < beats.branchSend;
  const extra = " Keep the old format readable.";
  const editText = prompt + extra.slice(0, Math.max(0, Math.floor((frame - beats.editStart - 10) / 2)));
  const asking = frame >= beats.ask && frame < beats.answer + 12;
  const waited = Math.round(interpolate(frame, [beats.ask + 90, beats.select - 26], [1, 2880], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }));

  const away = progress(frame, beats.away, 24) - progress(frame, beats.reopen - 10, 26);
  const enter = progress(frame, beats.composer - 2, 6);
  const leave = progress(frame, beats.end - 70, 50);

  return (
    <div style={{ position: "absolute", inset: 0, filter: `blur(${blur}px)`, ...ditherStyle(enter * (1 - away) * (1 - leave), 3) }}>
      <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: `translate(960px, 540px) scale(${zoom * (1 - away * 0.06)}) translate(${-x}px, ${-y}px)` }}>
        <div style={{ position: "absolute", left: origin.x, top: origin.y }}>
          <Window
            stage={sessionAt(frame)}
            mark={mark}
            waited={waited}
            composer={{ text: typed, busy: mark === "working" && frame >= beats.send }}
            model={frame >= beats.branchSend ? gpt : labModel}
            edit={editing ? { text: editText, model: frame >= beats.pick ? gpt : labModel } : undefined}
            dock={asking ? question(frame >= beats.select, frame >= beats.answer) : undefined}
          />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── captions, sky, the key, the name ───────────────────────────── */

function Caption({ from, until, lines }: { readonly from: number; readonly until: number; readonly lines: readonly string[] }) {
  const frame = useCurrentFrame();
  if (frame < from - 2 || frame > until + 14) return null;
  const words = lines.flatMap((line, index) =>
    line.split(" ").map((text, position) => ({ text, from: from + index * 18 + position * 4, breaks: index > 0 && position === 0 })),
  );
  return (
    <div style={{ position: "absolute", left: 110, top: 0, bottom: 0, width: 600, display: "flex", alignItems: "center" }}>
      <Words size={96} leading={1.08} exit={until} words={words} />
    </div>
  );
}

const sky = [palette.ink, palette.dusk, palette.top, palette.blue, palette.lift, palette.haze].map(rgb);

/** The sky and its moon until dawn, where the ending takes over. */
function Night() {
  const frame = useCurrentFrame();
  if (frame >= beats.dawn) return null;
  const phase = interpolate(frame, [0, beats.dawn], [2.1, 0.1], { extrapolateRight: "clamp" });
  return (
    <>
      <Field width={1920} height={1080} cell={8} stops={sky} gap={0.18} value={night} />
      <div style={{ position: "absolute", left: 1690 - 198, top: 150 - 198, transform: "scale(0.3)", filter: "drop-shadow(0 0 16px rgb(190 205 255 / 0.35))" }}>
        <Moon cells={44} pixel={9} phase={phase} earthshine={0.26} gap={false} />
      </div>
    </>
  );
}

function Quit() {
  const frame = useCurrentFrame();
  if (frame < beats.quitKey - 20 || frame > beats.away + 20) return null;
  const visible = progress(frame, beats.quitKey - 20, 10) - progress(frame, beats.away + 6, 12);
  const held = frame >= beats.quitKey && frame < beats.quitKey + 10;
  return (
    <div style={{ position: "absolute", left: 1230, top: 540, transform: `translate(-50%, -50%) scale(${10 * (held ? 0.94 : 1)})`, ...ditherStyle(visible, 1) }}>
      <Kbd keys={["⌘", "Q"]} keycap held={held} />
    </div>
  );
}

function System() {
  const frame = useCurrentFrame();
  const from = beats.pull + 72;
  if (frame < from - 2 || frame > beats.end) return null;
  const visible = progress(frame, from, 12) - progress(frame, beats.dawn - 6, 14);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 812, display: "flex", justifyContent: "center", fontFamily: font.pixel, fontSize: 96, color: palette.white, ...ditherStyle(visible, 3) }}>
      <Wheel items={["One session.", "Any process.", "Any host."]} position={rolled(frame, [from + 36, from + 72], 10)} height={110} align="center" />
    </div>
  );
}

/** Every caption, in order. Each line breaks onto its own row. */
export const captions = [
  { from: beats.hand + 10, until: beats.quitKey - 24, lines: ["Hand it the work."] },
  { from: beats.quitKey - 18, until: beats.reopen - 28, lines: ["Quit the app."] },
  { from: beats.reopen - 20, until: beats.reopen + 26, lines: ["It kept", "its place."] },
  { from: beats.branch + 52, until: beats.ask - 8, lines: ["Change course.", "Keep the history."] },
  { from: beats.ask + 6, until: beats.ask + 46, lines: ["It waits", "without a process."] },
] as const;

export const effects = [
  { file: "sfx/pixel.mp3", from: 0, volume: 0.7 },
  ...stripAt.slice(1).map((from) => ({ file: "sfx/tick.mp3", from, volume: 0.35 })),
  { file: "sfx/tap.mp3", from: beats.send, volume: 0.7 },
  { file: "sfx/tap.mp3", from: beats.quitKey, volume: 0.7 },
  { file: "sfx/tap.mp3", from: beats.branchSend, volume: 0.6 },
  { file: "sfx/tap.mp3", from: beats.select, volume: 0.5 },
  { file: "sfx/tap.mp3", from: beats.answer, volume: 0.6 },
];

export function Film() {
  return (
    <App>
      <AbsoluteFill style={{ background: palette.ink, overflow: "hidden" }}>
        <Night />
        <Sequence from={beats.dawn}>
          <Ending />
        </Sequence>
        <Desktop />
        <Strip />
        <Quit />
        {captions.map((caption) => (
          <Caption key={caption.from} from={caption.from} until={caption.until} lines={caption.lines} />
        ))}
        <System />
        <Audio src={staticFile(score.file)} volume={(frame) => score.volume * interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" })} />
        {effects.map((effect, index) => (
          <Sequence key={index} from={effect.from}>
            <Audio src={staticFile(effect.file)} volume={effect.volume} />
          </Sequence>
        ))}
      </AbsoluteFill>
    </App>
  );
}

export const score = { file: "music/score.mp3", from: 0, volume: 0.8 } as const;

/**
 * The film's layers, front to back, for the studio's timeline. Keep each span
 * true to when the layer draws.
 */
export const layers: readonly Layer[] = [
  { name: "System wheel", kind: "text", from: beats.pull + 70, until: beats.dawn + 8 },
  ...captions.map((caption) => ({ name: caption.lines.join(" "), kind: "text" as const, from: caption.from - 2, until: caption.until + 14 })),
  { name: "⌘Q keycap", kind: "ui", from: beats.quitKey - 20, until: beats.away + 20 },
  { name: "Parts up close", kind: "ui", from: 0, until: beats.composer + 4 },
  { name: "Window", kind: "ui", from: beats.composer - 2, until: beats.end + 10 },
  { name: "Ending", kind: "precomp", from: beats.dawn, until: durationInFrames, composition: "ending" },
  { name: "Night", kind: "shape", from: 0, until: beats.dawn },
  { name: "score.mp3", kind: "audio", from: score.from, until: durationInFrames, file: score.file },
  ...effects.map((effect) => ({ name: effect.file.replace("sfx/", ""), kind: "audio" as const, from: effect.from, until: effect.from + 15, file: effect.file })),
];

export { durationInFrames };

if (beats.dawn + length !== durationInFrames) throw new Error("The ending must run from dawn to the last frame");
