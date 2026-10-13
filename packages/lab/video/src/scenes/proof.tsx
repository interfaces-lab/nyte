import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Brackets, clamp, colour, font, Night, Picture, Spoken } from "../look";
import { at, bar, type Cue } from "../timeline";

const Counter = ({ value, from, label }: { value: number; from: number; label: string }) => {
  const frame = useCurrentFrame();

  const shown = Math.round(
    interpolate(frame, [from, from + 24], [0, value], {
      ...clamp,
      easing: Easing.out((t) => Easing.cubic(t)),
    }),
  );

  return (
    <div style={{ opacity: interpolate(frame, [from - 2, from + 4], [0, 1], clamp) }}>
      <Brackets tone={colour.moon} gap={32} style={{ minWidth: 300, textAlign: "center" }}>
        <div
          style={{
            fontFamily: font.sans,
            fontSize: 120,
            fontWeight: 600,
            letterSpacing: -4,
            color: "#fff",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {shown}
        </div>
        <div style={{ fontFamily: font.sans, fontSize: 36, fontWeight: 500, color: colour.moon }}>
          {label}
        </div>
      </Brackets>
    </div>
  );
};

export const Numbers = ({ cue, commits }: { cue: Cue; commits: readonly string[] }) => {
  const frame = useCurrentFrame();

  return (
    <Night>
      <AbsoluteFill
        style={{
          padding: "0 80px",
          fontFamily: font.mono,
          fontSize: 17,
          lineHeight: "30px",
          color: colour.moon,
          opacity: 0.08,
          transform: `translateY(${-frame * 1.5}px)`,
          columnCount: 3,
          columnGap: 64,
          whiteSpace: "nowrap",
        }}
      >
        {commits.slice(0, 120).map((subject, index) => (
          <div key={index}>{subject}</div>
        ))}
      </AbsoluteFill>
      <AbsoluteFill
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 96 }}
      >
        <Counter value={467} from={at(cue, "four")} label="commits" />
        <Counter value={58} from={at(cue, "fifty")} label="in the core" />
      </AbsoluteFill>
    </Night>
  );
};

const node = 22;

const spacing = 64;

const Step = ({ x, y, born, glow }: { x: number; y: number; born: number; glow: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const grow = spring({ frame: frame - born, fps, config: { damping: 16 } });

  return (
    <span
      style={{
        position: "absolute",
        left: x - node / 2,
        top: y - node / 2,
        width: node,
        height: node,
        background: colour.moon,
        transform: `scale(${grow})`,
        boxShadow: `0 0 ${glow * 28}px ${colour.moon}`,
      }}
    />
  );
};

/** A session drawn as commits: a main line, and one idea branched off it. */
export const Git = ({ cue }: { cue: Cue }) => {
  const frame = useCurrentFrame();
  const closing = at(cue, "close");
  // The commits arrive while the first sentence is said; the last lands just before the window closes.
  const every = Math.floor((closing - 8) / 14);
  const branchAt = 5;

  const main = Array.from({ length: 14 }, (_, index) => ({
    x: index * spacing,
    y: 120,
    born: index * every,
  }));

  const branch = Array.from({ length: 5 }, (_, index) => ({
    x: (branchAt + 1 + index) * spacing,
    y: 0,
    born: (branchAt + 1 + index) * every + every / 2,
  }));

  const steps = [...main, ...branch];
  const windowFade = interpolate(frame, [closing, closing + 14], [1, 0], clamp);
  const nothing = at(cue, "nothing");
  const pulse = interpolate(frame, [nothing, nothing + 8, nothing + 30], [0, 1, 0.25], clamp);
  const width = 13 * spacing;

  const line = (from: { x: number; y: number }, to: { x: number; y: number }, born: number) => (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={colour.dim}
        strokeWidth={2}
        opacity={interpolate(frame, [born - 2, born + 4], [0, 1], clamp)}
      />
    </svg>
  );

  return (
    <Night>
      <Picture>
        <div
          style={{
            position: "absolute",
            width: width + 240,
            height: 460,
            borderRadius: 20,
            border: `1px solid ${colour.dim}`,
            background: "rgba(255,255,255,0.02)",
            opacity: windowFade,
            transform: `scale(${0.96 + windowFade * 0.04})`,
          }}
        >
          <div style={{ display: "flex", gap: 8, padding: 18 }}>
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                style={{ width: 12, height: 12, borderRadius: 6, background: colour.dim }}
              />
            ))}
          </div>
        </div>
        <div style={{ position: "relative", width, height: 120, transform: "translateY(-30px)" }}>
          {main.slice(1).map((step, index) => line(main[index] ?? step, step, step.born))}
          {branch.map((step, index) =>
            line(
              index === 0 ? (main[branchAt] ?? step) : (branch[index - 1] ?? step),
              step,
              step.born,
            ),
          )}
          {steps.map((step, index) => (
            <Step key={index} {...step} glow={pulse} />
          ))}
          <div
            style={{
              position: "absolute",
              left: -100,
              top: 108,
              fontFamily: font.mono,
              fontSize: 24,
              color: colour.label,
            }}
          >
            main
          </div>
          <div
            style={{
              position: "absolute",
              left: (branchAt + 1) * spacing - 100,
              top: -14,
              fontFamily: font.mono,
              fontSize: 24,
              color: colour.label,
              opacity: interpolate(
                frame,
                [branch[0]?.born ?? 0, (branch[0]?.born ?? 0) + 6],
                [0, 1],
                clamp,
              ),
            }}
          >
            idea
          </div>
        </div>
      </Picture>
      <Spoken cue={cue} tone="#fff" />
    </Night>
  );
};

const work = [
  "Read packages/core/src/kernel/store.ts",
  "Wrote a failing test for a torn write",
  "Moved the ref update behind the lease",
  "Ran the store tests",
];

const Steps = ({ scale, first }: { scale: number; first: number }) => {
  const frame = useCurrentFrame();
  const each = bar / 2;

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 14 * scale, fontSize: 20 * scale }}
    >
      {work.map((text, index) => {
        const start = first + index * each;
        const done = frame > start + each;

        return (
          <div
            key={text}
            style={{
              display: "flex",
              gap: 12 * scale,
              alignItems: "center",
              color: done ? colour.moon : "#fff",
              opacity: interpolate(frame, [start, start + 6], [0, 1], clamp),
            }}
          >
            <span
              style={{
                width: 10 * scale,
                height: 10 * scale,
                flexShrink: 0,
                background: done ? colour.moon : "transparent",
                border: `${1.5 * scale}px solid ${colour.moon}`,
              }}
            />
            <span style={{ fontFamily: font.mono }}>{text}</span>
          </div>
        );
      })}
    </div>
  );
};

const Conversation = ({ scale, first }: { scale: number; first: number }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 28 * scale, fontFamily: font.sans }}>
    <div
      style={{
        alignSelf: "flex-end",
        maxWidth: "80%",
        background: colour.plate,
        color: "#fff",
        borderRadius: 18 * scale,
        padding: `${14 * scale}px ${18 * scale}px`,
        fontSize: 22 * scale,
      }}
    >
      Make the session store survive a crash mid-write.
    </div>
    <Steps scale={scale} first={first} />
  </div>
);

export const Phone = ({ cue }: { cue: Cue }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tomorrow = at(cue, "tomorrow");
  const phone = at(cue, "phone");
  const slide = spring({ frame: frame - phone + 6, fps, config: { damping: 18 } });
  const time = frame < tomorrow ? "23:48" : "07:12";

  return (
    <Night>
      <Picture>
        <div
          style={{
            width: 1040,
            height: 640,
            borderRadius: 20,
            border: `1px solid ${colour.dim}`,
            background: colour.night,
            padding: "24px 56px",
            transform: `translateX(${-slide * 180}px)`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 56 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  style={{ width: 12, height: 12, borderRadius: 6, background: colour.dim }}
                />
              ))}
            </div>
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 44,
                color: "#fff",
                opacity: interpolate(
                  frame,
                  [tomorrow - 4, tomorrow, tomorrow + 4],
                  [1, 0.2, 1],
                  clamp,
                ),
              }}
            >
              {time}
            </span>
          </div>
          <Conversation scale={1} first={0} />
        </div>
        <div
          style={{
            position: "absolute",
            width: 330,
            height: 680,
            borderRadius: 48,
            border: `10px solid #05070f`,
            background: colour.night,
            boxShadow: "0 40px 80px rgba(0,0,0,0.5)",
            padding: "64px 22px",
            transform: `translate(${560 - slide * 40}px, ${(1 - slide) * 900}px)`,
          }}
        >
          <Conversation scale={0.62} first={0} />
        </div>
      </Picture>
      <Spoken cue={cue} tone="#fff" />
    </Night>
  );
};
