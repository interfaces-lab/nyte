import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame } from "remotion";
import { findLine, findWord, fps } from "./cut";
import type { Line } from "./cut";
import { Frame, whole } from "./frame";
import type { Region } from "./frame";
import { app, clip, photos } from "./media";
import type { Media } from "./media";
import { progress } from "./type";

/** The largest box of the region's shape that fits in `width` by `height`. */
function fit(region: Region, width: number, height: number) {
  const scale = Math.min(width / region.width, height / region.height);
  return { width: Math.round(region.width * scale), height: Math.round(region.height * scale) };
}

/** A slow push in over a shot, the way the camera creeps toward a photograph: 5% over its length. */
const creep = (frame: number, duration: number) => 1 + 0.05 * interpolate(frame, [0, duration], [0, 1], { extrapolateRight: "clamp" });

/* ───────────────────────────── the clip ───────────────────────────── */

/** Each shot cuts in on a word and plays from `at` seconds into the clip: logs laid, a wall stacked, dirt dug out, the finished front. */
function clipShots() {
  const stacked = findLine("stacked");
  return [
    { from: 0, at: 47.8 },
    { from: stacked.from, at: 66 },
    { from: findWord(stacked, "took").at - 2, at: 25 },
    { from: findLine("world").from, at: 108.2 },
  ];
}

/** The gameplay above its hotbar, hearts and item names, so the HUD sits out of frame and clear of the captions. */
const aboveHud: Region = { x: 0, y: 0, width: 1920, height: 870 };

/** The gameplay runs muted under "We all started with blocks…", cut shot to shot on the words, until "Every block". */
export function Clip() {
  const until = findLine("beneath").from;
  const shots = clipShots();
  return (
    <>
      {shots.map((shot, index) => (
        <Sequence key={shot.at} from={shot.from} durationInFrames={(shots[index + 1]?.from ?? until) - shot.from}>
          <Frame media={clip} width={1920} height={1080} region={aboveHud} start={Math.round(shot.at * fps)} />
        </Sequence>
      ))}
    </>
  );
}

/* ───────────────────────────── the photographs ───────────────────────────── */

/**
 * How a photograph sits on the black, the way Notion's film places its
 * archive: filling the frame, alone in the middle, or as one of two side by
 * side, the second arriving a phrase after the first.
 */
type Layout = "full" | "card" | "left" | "right";

const layouts: Record<Layout, { readonly x: number; readonly y: number; readonly width: number; readonly height: number }> = {
  full: { x: 960, y: 540, width: 1920, height: 1080 },
  card: { x: 960, y: 500, width: 1180, height: 700 },
  left: { x: 505, y: 500, width: 850, height: 600 },
  right: { x: 1415, y: 500, width: 850, height: 600 },
};

interface Placed {
  readonly media: Media;
  readonly layout: Layout;
  /** The frame it arrives on, when that is after the group cuts in. */
  readonly from?: number;
}

/** Photographs that cut in together on one phrase. */
interface Group {
  readonly from: number;
  readonly pictures: readonly Placed[];
}

/** The photographs, each group from the phrase it cuts in on until the next; black after the last, under "We think". */
function photoGroups(): { readonly until: number; readonly groups: readonly Group[] } {
  const harness = findLine("harness");
  const factory = findLine("factory");
  const phrase = (line: Line, word: string) => findWord(line, word).at - 2;
  return {
    until: findLine("wrong").from,
    groups: [
      { from: harness.from, pictures: [{ media: photos.ai, layout: "card" }] },
      { from: phrase(harness, "everyone"), pictures: [{ media: photos.build, layout: "full" }] },
      { from: phrase(harness, "their"), pictures: [{ media: photos.harness, layout: "card" }] },
      { from: factory.from, pictures: [{ media: photos.companies, layout: "full" }] },
      { from: phrase(factory, "with"), pictures: [{ media: photos.teams, layout: "full" }] },
      {
        from: phrase(factory, "trying"),
        pictures: [
          { media: photos.computers, layout: "left" },
          { media: photos.factory, layout: "right", from: phrase(factory, "a") },
        ],
      },
      { from: findLine("foundation").from, pictures: [{ media: photos.foundation, layout: "card" }] },
      { from: findLine("consistency").from, pictures: [{ media: photos.consistency, layout: "full" }] },
      { from: findLine("rewrite").from, pictures: [{ media: photos.rewrite, layout: "full" }] },
    ],
  };
}

function Photo({ placed, duration }: { readonly placed: Placed; readonly duration: number }) {
  const frame = useCurrentFrame();
  const slot = layouts[placed.layout];
  const box = placed.layout === "full" ? slot : fit(whole(placed.media), slot.width, slot.height);
  return (
    <div style={{ position: "absolute", left: slot.x - box.width / 2, top: slot.y - box.height / 2 }}>
      <Frame media={placed.media} width={box.width} height={box.height} zoom={creep(frame, duration)} />
    </div>
  );
}

/** The photographs under the problem, cut hard on the phrases, like Notion's archive under its own. */
export function Photographs() {
  const { until, groups } = photoGroups();
  return (
    <>
      {groups.map((group, index) => {
        const end = groups[index + 1]?.from ?? until;
        return (
          <Sequence key={group.from} from={group.from} durationInFrames={end - group.from}>
            {group.pictures.map((placed) => {
              const from = placed.from ?? group.from;
              return (
                <Sequence key={placed.layout} from={from - group.from} layout="none">
                  <Photo placed={placed} duration={end - from} />
                </Sequence>
              );
            })}
          </Sequence>
        );
      })}
    </>
  );
}

/* ───────────────────────────── the product ───────────────────────────── */

interface Screen {
  readonly from: number;
  readonly media: Media;
  readonly region?: Region;
  /** Where a take starts playing, in seconds. */
  readonly at?: number;
}

/** A 2:1 region of a take or still, `width` wide from its top-left corner. */
const detail = (x: number, y: number, width: number): Region => ({ x, y, width, height: width / 2 });
/** The window without the account bar along its foot. */
const windowed: Region = { x: 0, y: 0, width: 3024, height: 1830 };

/** What the product shows under each headline: the window, then each part as it is named, then the harnesses, the machine and the source. */
function screens(): readonly Screen[] {
  const parts = findLine("parts");
  const top = findLine("top");
  /** "Your ☑ …" is halfway through rolling to a part as its word is said, so the product cuts to it there. */
  const named = (word: string) => findWord(parts, word).at - 2;
  return [
    { from: findLine("nyte").from, media: app.desktop, region: windowed },
    { from: parts.from, media: app.restaurant, at: 5.4, region: detail(650, 110, 1100) },
    { from: named("subagents"), media: app.agents, at: 2.3, region: detail(650, 120, 1300) },
    { from: named("mcp"), media: app.restaurant, at: 14.2, region: detail(650, 200, 1100) },
    { from: named("canvases"), media: app.restaurant, at: 8.3, region: detail(650, 330, 1720) },
    { from: named("models"), media: app.tuiSettings, region: detail(40, 280, 1000) },
    { from: top.from, media: app.tuiChat, region: detail(0, 0, 1536) },
    { from: findWord(top, "on").at - 2, media: app.canvas, region: windowed },
    { from: findLine("machine").from, media: app.composer, region: detail(860, 700, 1300) },
    { from: findLine("open").from, media: app.github, region: detail(260, 360, 1900) },
  ];
}

/** Where the product sits under the headline. */
const stage = { top: 290, width: 1500, height: 750 } as const;

/**
 * One screen, as a product shot: the real app on a plane tilted back in
 * perspective, flattening toward the viewer over the whole section, the picture
 * inside it creeping in. The plane rises into place on "Nyte".
 */
function ScreenShot({ screen, until, section }: { readonly screen: Screen; readonly until: number; readonly section: { readonly from: number; readonly until: number } }) {
  const local = useCurrentFrame();
  const frame = local + screen.from;
  const region = screen.region ?? whole(screen.media);
  const box = fit(region, stage.width, stage.height);
  const rise = progress(frame, section.from, 26);
  const tilt = interpolate(frame, [section.from, section.until], [12, 3], { easing: Easing.out(Easing.quad) });
  return (
    <AbsoluteFill style={{ perspective: 2200, perspectiveOrigin: "50% 0%" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 60% 55% at 50% 62%, rgb(74 90 242 / 0.22), transparent 70%)", opacity: rise }} />
      <div
        style={{
          position: "absolute",
          left: (1920 - box.width) / 2,
          top: stage.top + (stage.height - box.height) / 2,
          width: box.width,
          height: box.height,
          borderRadius: 18,
          overflow: "hidden",
          transformOrigin: "50% 100%",
          transform: `translateY(${(1 - rise) * 520}px) rotateX(${tilt}deg)`,
          boxShadow: "0 0 0 1px rgb(255 255 255 / 0.16), 0 50px 140px rgb(0 0 0 / 0.75)",
        }}
      >
        <Frame media={screen.media} width={box.width} height={box.height} region={region} start={Math.round((screen.at ?? 0) * fps)} zoom={creep(local, until - screen.from)} />
      </div>
    </AbsoluteFill>
  );
}

/** The product, from "Nyte is the foundation." until "Build your own.": hard cuts on the words, one continuous tilt. */
export function Product() {
  const shots = screens();
  const section = { from: findLine("nyte").from, until: findLine("own").from };
  return (
    <>
      {shots.map((screen, index) => {
        const until = shots[index + 1]?.from ?? section.until;
        return (
          <Sequence key={screen.from} from={screen.from} durationInFrames={until - screen.from}>
            <ScreenShot screen={screen} until={until} section={section} />
          </Sequence>
        );
      })}
    </>
  );
}

