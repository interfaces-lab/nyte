"use client";

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

const DURATION = 9.4;

const MAIN_TOP = 22;
const MAIN_HEIGHT = 28;
const MAIN_BOTTOM = MAIN_TOP + MAIN_HEIGHT;
const ROW_HEIGHT = 22;

const START = 1.8;
const SETTLED = 6.6;
const BOUNDARY = 6.8;

const CHILDREN = [
  { title: "0.0.7 fixtures", top: 66, end: 3.6 },
  { title: "0.0.8 fixtures", top: 94, end: 5.0 },
  { title: "Sidebar filter", top: 122, end: 6.4 },
] as const;

const JOB = { title: "pnpm --dir packages/core test", top: 160, end: 4.4 } as const;

const STEPS = [
  { at: 0, text: "Main starts three child agents and a background test run." },
  { at: START, text: "The children run at once. Main waits for all three." },
  { at: 3.6, text: "A child finishes and reports back." },
  { at: JOB.end, text: "The tests finish. The result waits for the next boundary." },
  { at: 6.4, text: "The last child reports and the wait ends." },
  { at: BOUNDARY, text: "Main responds with the reports and the test result." },
] as const satisfies readonly SceneStep[];

function Done({ at, top, time }: { at: number; top: number; time: number }) {
  if (time < at) return null;
  return (
    <span
      style={{
        left: `calc(${percent(at, DURATION)}% + 6px)`,
        top,
        height: ROW_HEIGHT,
        ...appear(time, at),
      }}
      className="absolute flex items-center font-mono text-[10px] text-(--scene-ok)"
    >
      done
    </span>
  );
}

/* A parent waits on three child sessions and a background job, all running at once. */
export function DelegationScene() {
  const { clock, target } = useSceneClock(DURATION);
  const { time } = clock;
  const reported = CHILDREN.filter((child) => time >= child.end + 0.3).length;

  return (
    <SceneFrame
      label="A parent agent waits on three child agents and a background job running in parallel"
      clock={clock}
      target={target}
      steps={STEPS}
      follow={0.13 + 0.84 * (time / DURATION)}
    >
      <div className={`relative h-[190px] ${GUTTER}`}>
        <LaneLabel top={MAIN_TOP + 6} name="main" />
        {CHILDREN.map((child, index) => (
          <LaneLabel key={child.title} top={child.top + 3} name={`child ${index + 1}`} />
        ))}
        <LaneLabel top={JOB.top - 3} name="job" note="background" />

        <div className="relative h-full">
          <div
            style={{ top: MAIN_TOP, height: MAIN_HEIGHT }}
            className="absolute inset-x-0 rounded-[7px] bg-foreground/[0.04]"
          />

          <Mark at={BOUNDARY} label="boundary" time={time} duration={DURATION} />

          <Segment
            from={0}
            to={1.2}
            time={time}
            duration={DURATION}
            top={MAIN_TOP}
            height={MAIN_HEIGHT}
            tone="run"
          >
            respond
          </Segment>
          <Segment
            from={1.2}
            to={START}
            time={time}
            duration={DURATION}
            top={MAIN_TOP}
            height={MAIN_HEIGHT}
            tone="tool"
          >
            tools
          </Segment>
          <Segment
            from={START}
            to={SETTLED}
            time={time}
            duration={DURATION}
            top={MAIN_TOP}
            height={MAIN_HEIGHT}
            tone="wait"
          >
            await all · {reported}/3
          </Segment>
          <Segment
            from={BOUNDARY}
            to={DURATION}
            time={time}
            duration={DURATION}
            top={MAIN_TOP}
            height={MAIN_HEIGHT}
            tone="run"
          >
            respond
          </Segment>

          {CHILDREN.map((child) => (
            <Segment
              key={child.title}
              from={START}
              to={child.end}
              time={time}
              duration={DURATION}
              top={child.top}
              height={ROW_HEIGHT}
              tone="child"
            >
              {child.title}
            </Segment>
          ))}
          {CHILDREN.map((child) => (
            <Done key={child.title} at={child.end} top={child.top} time={time} />
          ))}

          <Segment
            from={START}
            to={JOB.end}
            time={time}
            duration={DURATION}
            top={JOB.top}
            height={ROW_HEIGHT}
            tone="tool"
          >
            {JOB.title}
          </Segment>
          <Wait
            from={JOB.end}
            to={BOUNDARY}
            top={JOB.top + ROW_HEIGHT / 2}
            time={time}
            duration={DURATION}
          />

          {CHILDREN.map((child) => (
            <Rise
              key={child.title}
              at={child.end}
              from={child.top + ROW_HEIGHT / 2}
              to={MAIN_BOTTOM}
              time={time}
              duration={DURATION}
            />
          ))}
          <Rise
            at={BOUNDARY}
            from={JOB.top + ROW_HEIGHT / 2}
            to={MAIN_BOTTOM}
            time={time}
            duration={DURATION}
          />

          <Playhead time={time} duration={DURATION} />
        </div>
      </div>
    </SceneFrame>
  );
}
