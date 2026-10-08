"use client";

import type { Client } from "../hero-2/use-session";
import { useSceneClock, type SceneStep } from "./scene-clock";
import { SceneFrame } from "./scene-frame";
import {
  GUTTER,
  LaneLabel,
  Mark,
  Playhead,
  Rise,
  Segment,
  Wait,
  appear,
  percent,
} from "./timeline";

const DURATION = 9.6;

const MAIN_TOP = 22;
const MAIN_HEIGHT = 28;
const MAIN_BOTTOM = MAIN_TOP + MAIN_HEIGHT;
const CHIP_HEIGHT = 26;

const SEGMENTS = [
  { from: 0, to: 2.2, tone: "run", label: "respond" },
  { from: 2.2, to: 3.4, tone: "tool", label: "tools" },
  { from: 3.4, to: 5.2, tone: "run", label: "respond" },
  { from: 5.2, to: 6.4, tone: "tool", label: "tools" },
  { from: 6.4, to: 7.6, tone: "run", label: "respond" },
  { from: 7.9, to: DURATION, tone: "run", label: "new run" },
] as const;

const MARKS = [
  { at: 3.4, label: "boundary" },
  { at: 6.4, label: "boundary" },
  { at: 7.6, label: "idle" },
] as const;

const MESSAGES = [
  { client: "mobile", text: "Cover 0.0.7 too", top: 70, sent: 0.8, lands: 3.4, offset: 0 },
  { client: "terminal", text: "Update the changelog", top: 150, sent: 1.7, lands: 7.6, offset: 0 },
  { client: "desktop", text: "Keep the fixture", top: 70, sent: 3.9, lands: 6.4, offset: 0 },
  { client: "terminal", text: "Name it by version", top: 102, sent: 3.9, lands: 6.4, offset: 7 },
] as const satisfies readonly {
  client: Client;
  text: string;
  top: number;
  sent: number;
  lands: number;
  offset: number;
}[];

const STEPS = [
  { at: 0, text: "The agent is responding on main." },
  { at: 0.8, text: "Mobile sends a steer message mid-stream. It waits for the next boundary." },
  { at: 1.7, text: "Terminal sends a next message. It waits until the run is idle." },
  { at: 3.4, text: "At the boundary, the steer message lands in the run." },
  { at: 3.9, text: "Desktop and Terminal send at the same moment. Both queue, in order." },
  { at: 6.4, text: "Both land at the next boundary." },
  { at: 7.6, text: "The run ends. The next message lands and starts a new run." },
] as const satisfies readonly SceneStep[];

/* Clients steer a live run and queue for after it; each message lands at a boundary. */
export function InboxScene() {
  const { clock, target } = useSceneClock(DURATION);
  const { time } = clock;

  return (
    <SceneFrame
      label="Messages from three clients queue while a run streams and land at its boundaries"
      clock={clock}
      target={target}
      steps={STEPS}
      follow={0.13 + 0.84 * (time / DURATION)}
    >
      <div className={`relative h-[184px] ${GUTTER}`}>
        <LaneLabel top={MAIN_TOP + 6} name="main" />
        <LaneLabel top={74} name="steer" note="at a boundary" />
        <LaneLabel top={154} name="next" note="when idle" />

        <div className="relative h-full">
          <div
            style={{ top: MAIN_TOP, height: MAIN_HEIGHT }}
            className="absolute inset-x-0 rounded-[7px] bg-foreground/[0.04]"
          />
          <div className="absolute inset-x-0 top-[140px] h-px bg-foreground/[0.07]" />

          {MARKS.map((mark) => (
            <Mark key={mark.at} at={mark.at} label={mark.label} time={time} duration={DURATION} />
          ))}

          {SEGMENTS.map((segment) => (
            <Segment
              key={segment.from}
              from={segment.from}
              to={segment.to}
              time={time}
              duration={DURATION}
              top={MAIN_TOP}
              height={MAIN_HEIGHT}
              tone={segment.tone}
            >
              {segment.label}
            </Segment>
          ))}

          {MESSAGES.map((message) => (
            <Wait
              key={message.text}
              from={message.sent}
              to={message.lands}
              top={message.top + CHIP_HEIGHT / 2}
              time={time}
              duration={DURATION}
            />
          ))}

          {MESSAGES.map((message) =>
            time >= message.sent ? (
              <div
                key={message.text}
                style={{
                  left: `${percent(message.sent, DURATION)}%`,
                  top: message.top,
                  height: CHIP_HEIGHT,
                  ...appear(time, message.sent),
                }}
                className="absolute z-10 flex items-center gap-1.5 rounded-full bg-background pr-2.5 pl-2 text-[12px] whitespace-nowrap shadow-[0_1px_2px_rgb(0_0_0/0.06)] ring-1 ring-border-subtle"
              >
                <span className="font-mono text-[10px] text-tertiary-foreground">
                  {message.client}
                </span>
                <span
                  className={`transition-colors duration-300 ${time >= message.lands ? "text-muted-foreground" : "text-foreground"}`}
                >
                  {message.text}
                </span>
              </div>
            ) : null,
          )}

          {MESSAGES.map((message) => (
            <Rise
              key={message.text}
              at={message.lands}
              from={message.top + CHIP_HEIGHT / 2}
              to={MAIN_BOTTOM}
              offset={message.offset}
              time={time}
              duration={DURATION}
            />
          ))}

          <Playhead time={time} duration={DURATION} />
        </div>
      </div>
    </SceneFrame>
  );
}
