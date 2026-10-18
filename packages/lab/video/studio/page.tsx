import { Player, type PlayerRef } from "@remotion/player";
import { create, props } from "@stylexjs/stylex";
import { useEffect, useRef, useState, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { Button } from "@nyte-ai/ui/button";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import {
  compositions,
  fonts,
  footage,
  sources,
  type Composition,
  type Layer,
} from "../src/project";
import { Chat } from "./chat";

/** Remotion's staticFile() reads the film's footage from the lab's /video/ route. */
window.remotion_staticBase = "/video";

type Selection =
  | { readonly kind: "composition"; readonly id: string }
  | { readonly kind: "footage"; readonly file: string }
  | { readonly kind: "font"; readonly name: string }
  | { readonly kind: "source"; readonly file: string };

/** After Effects' label colours, one per kind of layer. */
const LABEL: Readonly<Record<Layer["kind"] | "composition" | "font" | "source", string>> = {
  text: "#d8b75a",
  ui: "#8f9be0",
  shape: "#62aba2",
  precomp: "#c48ad8",
  audio: "#82b56a",
  composition: "#c48ad8",
  font: "#d68a6a",
  source: "#9a9aa6",
};

function findComposition(id: string): Composition {
  const found = compositions.find((composition) => composition.id === id) ?? compositions[0];

  if (found === undefined) throw new Error("The film's project has no compositions");

  return found;
}

const timecode = (frame: number, fps: number) => {
  const seconds = Math.floor(frame / fps);

  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}:${String(frame % fps).padStart(2, "0")}`;
};

const span = (frames: number, fps: number) =>
  `${(frames / fps).toFixed(frames % fps === 0 ? 0 : 1)} s`;

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest("input, textarea, [contenteditable]") !== null);

function Label({ kind }: { readonly kind: keyof typeof LABEL }): ReactElement {
  return <span {...props(styles.label)} style={{ backgroundColor: LABEL[kind] }} />;
}

function Item({
  kind,
  name,
  detail,
  selected,
  onSelect,
  onOpen,
}: {
  readonly kind: keyof typeof LABEL;
  readonly name: string;
  readonly detail: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onOpen?: () => void;
}): ReactElement {
  return (
    <li>
      <button
        type="button"
        {...props(styles.item, selected && styles.itemSelected)}
        onClick={onSelect}
        onDoubleClick={onOpen}
      >
        <Label kind={kind} />
        <span {...props(styles.itemName)}>{name}</span>
        <span {...props(styles.dim)}>{detail}</span>
      </button>
    </li>
  );
}

function Folder({ name, count, children }: { readonly name: string; readonly count: number; readonly children: ReactNode }): ReactElement {
  return (
    <section>
      <h3 {...props(styles.folder)}>
        <span>{name}</span>
        <span {...props(styles.dim)}>{count}</span>
      </h3>
      <ul {...props(styles.items)}>{children}</ul>
    </section>
  );
}

/** What After Effects shows at the top of its Project panel: the selected item, up close. */
function Preview({ selection }: { readonly selection: Selection }): ReactElement {
  switch (selection.kind) {
    case "composition": {
      const composition = findComposition(selection.id);

      return (
        <div {...props(styles.preview)}>
          <strong>{composition.name}</strong>
          <span {...props(styles.dim)}>
            {composition.width} × {composition.height} · {composition.fps} fps ·{" "}
            {span(composition.durationInFrames, composition.fps)} · {composition.layers.length} layers
          </span>
          {composition.offset !== undefined && (
            <span {...props(styles.dim)}>
              in {composition.offset.composition} from frame {composition.offset.at}
            </span>
          )}
        </div>
      );
    }
    case "footage": {
      const item = footage.find((entry) => entry.file === selection.file);

      return (
        <div {...props(styles.preview)}>
          <strong>{item?.name}</strong>
          <span {...props(styles.dim)}>{item?.use}</span>
          <audio controls preload="metadata" src={`/video/${selection.file}`} {...props(styles.audio)} />
        </div>
      );
    }
    case "font": {
      const item = fonts.find((entry) => entry.name === selection.name);

      return (
        <div {...props(styles.preview)}>
          <span {...props(styles.specimen)} style={{ fontFamily: item?.family }}>
            Nyte 0123
          </span>
          <span {...props(styles.dim)}>{item?.use}</span>
        </div>
      );
    }
    case "source": {
      const item = sources.find((entry) => entry.file === selection.file);

      return (
        <div {...props(styles.preview)}>
          <strong {...props(styles.mono)}>{selection.file.split("/").at(-1)}</strong>
          <span {...props(styles.dim)}>{item?.holds}</span>
          <span {...props(styles.dim)}>The director edits it; the viewer reloads on save.</span>
        </div>
      );
    }
  }
}

function Project({
  selection,
  onSelect,
  onOpen,
}: {
  readonly selection: Selection;
  readonly onSelect: (selection: Selection) => void;
  readonly onOpen: (id: string) => void;
}): ReactElement {
  return (
    <aside aria-label="Project" {...props(styles.project)}>
      <header {...props(styles.panelHeader)}>
        <span {...props(styles.panelTitle)}>Project</span>
        <span {...props(styles.dim)}>video/src/project.ts</span>
      </header>
      <Preview selection={selection} />
      <div {...props(styles.tree)}>
        <Folder name="Compositions" count={compositions.length}>
          {compositions.map((composition) => (
            <Item
              key={composition.id}
              kind="composition"
              name={composition.name}
              detail={span(composition.durationInFrames, composition.fps)}
              selected={selection.kind === "composition" && selection.id === composition.id}
              onSelect={() => onSelect({ kind: "composition", id: composition.id })}
              onOpen={() => onOpen(composition.id)}
            />
          ))}
        </Folder>
        <Folder name="Footage" count={footage.length}>
          {footage.map((item) => (
            <Item
              key={item.file}
              kind="audio"
              name={item.name}
              detail={item.file.split("/")[0] ?? ""}
              selected={selection.kind === "footage" && selection.file === item.file}
              onSelect={() => onSelect({ kind: "footage", file: item.file })}
            />
          ))}
        </Folder>
        <Folder name="Fonts" count={fonts.length}>
          {fonts.map((item) => (
            <Item
              key={item.name}
              kind="font"
              name={item.name}
              detail=""
              selected={selection.kind === "font" && selection.name === item.name}
              onSelect={() => onSelect({ kind: "font", name: item.name })}
            />
          ))}
        </Folder>
        <Folder name="Sources" count={sources.length}>
          {sources.map((item) => (
            <Item
              key={item.file}
              kind="source"
              name={item.file.split("/").at(-1) ?? item.file}
              detail=""
              selected={selection.kind === "source" && selection.file === item.file}
              onSelect={() => onSelect({ kind: "source", file: item.file })}
            />
          ))}
        </Folder>
      </div>
    </aside>
  );
}

const NAMES = 220;

/** A marker keeps its label when the last labelled one is far enough behind it; the rest show theirs on hover. */
function labelled(composition: Composition, index: number): boolean {
  const gap = composition.durationInFrames * 0.045;
  let last = -Infinity;

  for (const [position, marker] of composition.markers.entries()) {
    const shown = marker.at - last >= gap;

    if (position === index) return shown;
    if (shown) last = marker.at;
  }

  return false;
}

function Timeline({
  composition,
  frame,
  selected,
  onSeek,
  onSelect,
  onOpen,
}: {
  readonly composition: Composition;
  readonly frame: number;
  readonly selected: string | undefined;
  readonly onSeek: (frame: number) => void;
  readonly onSelect: (layer: Layer) => void;
  readonly onOpen: (id: string) => void;
}): ReactElement {
  const track = useRef<HTMLDivElement>(null);
  const total = composition.durationInFrames;
  const at = (value: number) => `${(value / total) * 100}%`;
  const second = composition.fps;
  const label = total / second > 20 ? 5 : 1;

  const seek = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();

    if (box === undefined) return;
    onSeek(Math.round(Math.min(Math.max((clientX - box.left) / box.width, 0), 1) * (total - 1)));
  };

  const scrub = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      seek(event.clientX);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (event.buttons === 1) seek(event.clientX);
    },
  };

  return (
    <section aria-label="Timeline" {...props(styles.timeline)}>
      <header {...props(styles.timelineHeader)}>
        <span {...props(styles.panelTitle)}>{composition.name}</span>
        <span {...props(styles.timecode)}>{timecode(frame, composition.fps)}</span>
        <span {...props(styles.dim)}>
          frame {frame} of {total} · space plays · ← → step a frame · double-click a precomp to open it
        </span>
      </header>
      <div {...props(styles.grid)}>
        <div {...props(styles.names)}>
          <div {...props(styles.rulerSpacer)}>
            <span {...props(styles.dim)}>#</span>
            <span {...props(styles.dim)}>Layer name</span>
          </div>
          {composition.layers.map((layer, index) => (
            <button
              key={`${layer.name}-${index}`}
              type="button"
              {...props(styles.nameRow, selected === layer.name && styles.rowSelected)}
              onClick={() => onSelect(layer)}
              onDoubleClick={() => layer.composition !== undefined && onOpen(layer.composition)}
            >
              <Label kind={layer.kind} />
              <span {...props(styles.index)}>{index + 1}</span>
              <span {...props(styles.layerName)}>{layer.name}</span>
            </button>
          ))}
        </div>
        <div ref={track} {...props(styles.tracks)} {...scrub}>
          <div {...props(styles.ruler)}>
            {Array.from({ length: Math.floor(total / second) + 1 }, (_, index) => (
              <span key={index} {...props(styles.tick, index % label !== 0 && styles.tickMinor)} style={{ left: at(index * second) }}>
                {index % label === 0 ? `${index}s` : ""}
              </span>
            ))}
            {composition.markers.map((marker, index) => (
              <span key={marker.name} {...props(styles.marker)} style={{ left: at(marker.at) }} title={`${marker.name} · frame ${marker.at}`}>
                {labelled(composition, index) ? marker.name : ""}
              </span>
            ))}
          </div>
          {composition.layers.map((layer, index) => {
            const live = frame >= layer.from && frame < layer.until;

            return (
              <div key={`${layer.name}-${index}`} {...props(styles.trackRow, selected === layer.name && styles.rowSelected)}>
                <div
                  {...props(styles.bar)}
                  style={{
                    left: at(layer.from),
                    width: at(Math.max(1, layer.until - layer.from)),
                    backgroundColor: LABEL[layer.kind],
                    opacity: live ? 0.9 : 0.45,
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onSelect(layer);
                  }}
                  onDoubleClick={() => layer.composition !== undefined && onOpen(layer.composition)}
                >
                  <span {...props(styles.barName)}>{layer.name}</span>
                </div>
              </div>
            );
          })}
          <div {...props(styles.playhead)} style={{ left: at(frame) }} />
        </div>
      </div>
    </section>
  );
}

export function StudioPage(): ReactElement {
  const player = useRef<PlayerRef>(null);
  const [openId, setOpenId] = useState("nyte");
  const [selection, setSelection] = useState<Selection>({ kind: "composition", id: "nyte" });
  const [layer, setLayer] = useState<string | undefined>(undefined);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const composition = findComposition(openId);
  const parent = composition.offset;

  useEffect(() => {
    const current = player.current;

    if (current === null) return;

    const onFrame = (event: { readonly detail: { readonly frame: number } }) => setFrame(event.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    current.addEventListener("frameupdate", onFrame);
    current.addEventListener("play", onPlay);
    current.addEventListener("pause", onPause);

    return () => {
      current.removeEventListener("frameupdate", onFrame);
      current.removeEventListener("play", onPlay);
      current.removeEventListener("pause", onPause);
    };
  }, [openId]);

  const seek = (next: number) => {
    const clamped = Math.min(Math.max(next, 0), composition.durationInFrames - 1);

    player.current?.pause();
    player.current?.seekTo(clamped);
    setFrame(clamped);
  };

  const open = (id: string, at = 0) => {
    setOpenId(id);
    setSelection({ kind: "composition", id });
    setLayer(undefined);
    setFrame(at);
  };

  const enter = (id: string) => {
    const target = findComposition(id);
    const offset = target.offset?.composition === openId ? target.offset.at : 0;

    open(id, Math.min(Math.max(frame - offset, 0), target.durationInFrames - 1));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editable(event.target) || event.metaKey || event.ctrlKey) return;

      if (event.key === " ") {
        event.preventDefault();
        player.current?.toggle();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = (event.shiftKey ? 10 : 1) * (event.key === "ArrowLeft" ? -1 : 1);
        const current = player.current?.getCurrentFrame() ?? 0;

        player.current?.pause();
        player.current?.seekTo(Math.min(Math.max(current + step, 0), composition.durationInFrames - 1));
      } else if (event.key === "Home") {
        player.current?.seekTo(0);
      } else if (event.key === "End") {
        player.current?.seekTo(composition.durationInFrames - 1);
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [composition.durationInFrames]);

  const seconds = (frame / composition.fps).toFixed(2);
  const filmFrame = parent === undefined ? "" : ` · film frame ${parent.at + frame}`;
  const context = `${composition.id} · frame ${frame} · ${seconds} s${filmFrame}${layer === undefined ? "" : ` · layer "${layer}"`}`;

  return (
    <div {...props(styles.page)}>
      <header {...props(styles.top)}>
        <span {...props(styles.crumb)}>
          nyte <span {...props(styles.dim)}>/</span> studio <span {...props(styles.dim)}>/</span>{" "}
          {parent !== undefined && (
            <>
              <button type="button" {...props(styles.crumbLink)} onClick={() => open(parent.composition, parent.at + frame)}>
                {findComposition(parent.composition).name}
              </button>{" "}
              <span {...props(styles.dim)}>›</span>{" "}
            </>
          )}
          {composition.name}
        </span>
        <Button size="sm" variant="solid" onClick={() => player.current?.toggle()}>
          {playing ? "Pause" : "Play"}
        </Button>
        <span {...props(styles.timecode)}>{timecode(frame, composition.fps)}</span>
        <span {...props(styles.dim, styles.mono)}>
          {composition.layers.filter((entry) => frame >= entry.from && frame < entry.until).map((entry) => entry.name).join(" · ") || "—"}
        </span>
      </header>
      <Project
        selection={selection}
        onSelect={(next) => {
          setSelection(next);
          if (next.kind === "composition" && next.id !== openId) open(next.id);
        }}
        onOpen={enter}
      />
      <main {...props(styles.viewer)}>
        <div {...props(styles.canvas)} style={{ aspectRatio: `${composition.width} / ${composition.height}` }}>
          <Player
            key={composition.id}
            ref={player}
            component={composition.component}
            durationInFrames={composition.durationInFrames}
            compositionWidth={composition.width}
            compositionHeight={composition.height}
            fps={composition.fps}
            initialFrame={frame}
            loop
            acknowledgeRemotionLicense
            style={{ width: "100%", height: "100%" }}
            errorFallback={({ error }) => <pre {...props(styles.crash)}>{error.message}</pre>}
          />
        </div>
        <span {...props(styles.dim, styles.mono)}>
          {composition.width} × {composition.height} · {composition.fps} fps · {span(composition.durationInFrames, composition.fps)}
        </span>
      </main>
      <aside {...props(styles.director)}>
        <Chat context={context} frame={frame} />
      </aside>
      <div {...props(styles.bottom)}>
        <Timeline
          composition={composition}
          frame={frame}
          selected={layer}
          onSeek={seek}
          onSelect={(next) => {
            setLayer(next.name);
            seek(next.from);
          }}
          onOpen={enter}
        />
      </div>
    </div>
  );
}

const line = { borderStyle: "solid", borderColor: role.borderSecondary, borderWidth: 0 } as const;

const styles = create({
  page: {
    display: "grid",
    gridTemplateColumns: "260px minmax(0, 1fr) 400px",
    gridTemplateRows: "44px minmax(0, 1fr) 300px",
    gridTemplateAreas: '"top top top" "project viewer director" "bottom bottom director"',
    height: "100vh",
    overflow: "hidden",
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: type.fontSm,
  },
  top: { ...line, gridArea: "top", display: "flex", alignItems: "center", gap: 16, paddingInline: 16, borderBottomWidth: 1, minWidth: 0 },
  crumb: { fontFamily: type.fontMono, whiteSpace: "nowrap" },
  crumbLink: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: role.contentSecondary, ":hover": role.contentPrimary },
    fontFamily: type.fontMono,
    fontSize: "inherit",
    cursor: "pointer",
    textDecoration: "underline",
  },
  timecode: { fontFamily: type.fontMono, fontVariantNumeric: "tabular-nums", color: "#8fa4ff" },
  mono: { fontFamily: type.fontMono, fontSize: type.fontXs, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  dim: { color: role.contentTertiary },
  project: { ...line, gridArea: "project", display: "flex", flexDirection: "column", minHeight: 0, borderRightWidth: 1 },
  panelHeader: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, paddingBlock: 10, paddingInline: 12, fontFamily: type.fontMono, fontSize: type.fontXs },
  panelTitle: { fontFamily: type.fontMono, fontSize: type.fontXs, color: role.contentPrimary },
  preview: {
    ...line,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginInline: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: type.fontXs,
    lineHeight: type.leadingSm,
  },
  specimen: { fontSize: 34, lineHeight: 1.1, color: role.contentPrimary },
  audio: { width: "100%", height: 32, marginTop: 4 },
  tree: { flex: 1, minHeight: 0, overflowY: "auto", paddingBlock: 8 },
  folder: {
    display: "flex",
    justifyContent: "space-between",
    margin: 0,
    paddingBlock: 6,
    paddingInline: 12,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    fontWeight: 500,
    color: role.contentSecondary,
  },
  items: { listStyle: "none", margin: 0, paddingInline: 6, paddingBottom: 6 },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    paddingBlock: 4,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: 5,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    textAlign: "start",
    cursor: "pointer",
  },
  itemSelected: { backgroundColor: "rgb(120 140 255 / 0.22)", color: role.contentPrimary },
  itemName: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  label: { width: 8, height: 8, borderRadius: 2, flexShrink: 0 },
  viewer: {
    gridArea: "viewer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 20,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: "#0b0b0d",
  },
  canvas: {
    width: "100%",
    maxWidth: "calc((100vh - 400px) * 16 / 9)",
    overflow: "hidden",
    boxShadow: "0 0 0 1px rgb(255 255 255 / 0.1), 0 24px 60px -20px rgb(0 0 0 / 0.6)",
  },
  crash: { margin: 0, padding: 20, color: "#ff9b9b", fontFamily: type.fontMono, fontSize: type.fontXs, whiteSpace: "pre-wrap" },
  director: { ...line, gridArea: "director", minHeight: 0, borderLeftWidth: 1 },
  bottom: { ...line, gridArea: "bottom", minHeight: 0, borderTopWidth: 1 },
  timeline: { display: "flex", flexDirection: "column", height: "100%" },
  timelineHeader: { display: "flex", alignItems: "baseline", gap: 14, paddingBlock: 8, paddingInline: 12, fontFamily: type.fontMono, fontSize: type.fontXs },
  /** Room below the last layer for the lab's page switcher. */
  grid: { flex: 1, minHeight: 0, display: "flex", alignItems: "flex-start", overflowY: "auto", paddingBottom: 56 },
  names: { ...line, width: NAMES, flexShrink: 0, borderRightWidth: 1 },
  rulerSpacer: { display: "flex", gap: 18, alignItems: "center", height: 26, paddingInline: 30, fontFamily: type.fontMono, fontSize: 10 },
  nameRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    height: 22,
    paddingInline: 10,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: type.fontXs,
    textAlign: "start",
    cursor: "pointer",
  },
  rowSelected: { backgroundColor: "rgb(120 140 255 / 0.16)" },
  index: { width: 16, color: role.contentTertiary, textAlign: "end" },
  layerName: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  tracks: { position: "relative", flex: 1, minWidth: 0, marginInline: 12, userSelect: "none", cursor: "ew-resize" },
  ruler: { position: "relative", height: 26, color: role.contentTertiary, fontFamily: type.fontMono, fontSize: 10 },
  tick: { position: "absolute", top: 0, height: 10, paddingInlineStart: 3, borderInlineStartWidth: 1, borderInlineStartStyle: "solid", borderInlineStartColor: role.borderSecondary, lineHeight: "10px" },
  tickMinor: { height: 5 },
  marker: {
    position: "absolute",
    top: 12,
    transform: "translateX(-4px)",
    paddingInlineStart: 8,
    color: "#e0c070",
    fontSize: 9,
    whiteSpace: "nowrap",
    "::before": {
      content: "''",
      position: "absolute",
      left: 0,
      top: 2,
      borderInlineWidth: 4,
      borderInlineStyle: "solid",
      borderInlineColor: "transparent",
      borderTopWidth: 6,
      borderTopStyle: "solid",
      borderTopColor: "#e0c070",
    },
  },
  trackRow: { position: "relative", height: 22 },
  bar: { position: "absolute", top: 3, bottom: 3, minWidth: 2, borderRadius: 3, overflow: "hidden", cursor: "pointer" },
  barName: { paddingInline: 6, color: "#0e0e14", fontFamily: type.fontMono, fontSize: 10, lineHeight: "16px", whiteSpace: "nowrap" },
  playhead: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "#8fa4ff",
    pointerEvents: "none",
    boxShadow: "0 0 0 0.5px rgb(143 164 255 / 0.5)",
  },
});
