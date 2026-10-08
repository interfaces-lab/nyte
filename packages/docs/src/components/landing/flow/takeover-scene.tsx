"use client";

import { IconServer, IconStorage } from "central-icons";
import { ease, lerp, progress, useSceneClock, type SceneStep } from "./scene-clock";
import { SceneFrame } from "./scene-frame";
import { appear } from "./timeline";

const DURATION = 9.6;
const TTL = 2.4;
const OFFLINE = 4.4;
const BACK = 8.3;
const EXPIRES = 6.0;
const TAKEN = 6.2;
const REFUSED = 8.8;

type Host = "a" | "b";

const NAMES = { a: "Host A", b: "Host B" } as const satisfies Record<Host, string>;

const HEADS = [
  { at: 0, value: "4f1a02" },
  { at: 2.0, value: "7c19e4" },
  { at: 3.4, value: "b2e801" },
  { at: 8.0, value: "e04d77" },
] as const;

const RUNS = [
  { at: 0, value: "respond" },
  { at: 2.0, value: "tools" },
  { at: 3.4, value: "respond" },
  { at: 8.0, value: "done" },
] as const;

const RENEWALS = {
  a: [0, 1.2, 2.4, 3.6],
  b: [TAKEN, 7.4, 8.6],
} as const satisfies Record<Host, readonly number[]>;

const PACKETS = [
  { host: "a", toStore: false, start: 0.3, kind: "read" },
  { host: "a", toStore: true, start: 1.6, kind: "publish" },
  { host: "a", toStore: false, start: 2.2, kind: "read" },
  { host: "a", toStore: true, start: 3.0, kind: "publish" },
  { host: "a", toStore: false, start: 3.6, kind: "read" },
  { host: "b", toStore: false, start: 6.4, kind: "read" },
  { host: "b", toStore: true, start: 7.6, kind: "publish" },
  { host: "a", toStore: true, start: 8.4, kind: "publish" },
  { host: "a", toStore: false, start: REFUSED, kind: "refused" },
] as const satisfies readonly { host: Host; toStore: boolean; start: number; kind: string }[];

const WORK = {
  a: [
    { label: "step 1 · respond", start: 0.3, end: 2.0 },
    { label: "step 2 · tools", start: 2.2, end: 3.4 },
    { label: "step 3 · respond", start: 3.6, end: Number.POSITIVE_INFINITY },
  ],
  b: [{ label: "step 3 · respond", start: 6.4, end: 8.0 }],
} as const satisfies Record<Host, readonly { label: string; start: number; end: number }[]>;

const PACKET_TONES = {
  read: "bg-foreground/45",
  publish: "bg-(--scene-run)",
  refused: "bg-(--scene-bad)",
} as const;

const STEPS = [
  { at: 0, text: "Host A holds the lease and runs the steps." },
  { at: 2.0, text: "Each publish moves the head by compare-and-swap." },
  { at: OFFLINE, text: "Host A drops out mid-step. Its lease stops renewing." },
  { at: EXPIRES, text: "The lease expires and Host B takes it." },
  { at: 7.6, text: "Host B redoes the step from the refs and publishes." },
  { at: 8.4, text: "Host A comes back. Its late write is refused." },
] as const satisfies readonly SceneStep[];

/* How much of the holder's lease is left, from 0 to 1. */
function leaseLeft(host: Host, time: number): number {
  if (host === "a" && time >= EXPIRES) return 0;
  if (host === "b" && time < TAKEN) return 0;
  const renewals: readonly number[] = RENEWALS[host];
  const renewed = renewals.findLast((at) => at <= time && (host === "b" || at < OFFLINE)) ?? 0;
  return Math.max(0, 1 - (time - renewed) / TTL);
}

function stepState(host: Host, work: { start: number; end: number }, time: number) {
  if (time >= work.end) return { text: "done", tone: "text-(--scene-ok)" };
  if (host === "a" && time >= REFUSED + 0.4) return { text: "fenced", tone: "text-(--scene-bad)" };
  if (host === "a" && time >= OFFLINE) return { text: "stalled", tone: "text-tertiary-foreground" };
  return { text: "running", tone: "text-(--scene-run)" };
}

function HostCard({ host, time }: { host: Host; time: number }) {
  const offline = host === "a" && time >= OFFLINE && time < BACK;
  const left = leaseLeft(host, time);
  const waiting = host === "b" && time < TAKEN;
  const status = offline ? "offline" : waiting ? "standing by" : "online";

  return (
    <div
      className={`flex h-full flex-col rounded-[14px] bg-background p-3 ring-1 ring-border-subtle transition-opacity duration-300 ${offline ? "opacity-45" : ""}`}
    >
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <IconServer size={16} className="text-muted-foreground" />
        {NAMES[host]}
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] font-normal text-muted-foreground">
          <span
            className={`size-1.5 rounded-full ${status === "online" ? "bg-(--scene-ok)" : "bg-foreground/30"}`}
          />
          {status}
        </span>
      </div>

      <div className="mt-2.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
        <span className="w-9 shrink-0">lease</span>
        <span className="h-1.5 flex-1 overflow-clip rounded-full bg-foreground/[0.07]">
          <span
            style={{ width: `${left * 100}%` }}
            className="block h-full rounded-full bg-(--scene-run)"
          />
        </span>
      </div>

      <div className="mt-2.5 flex flex-col gap-1 border-t border-border-subtle pt-2.5 font-mono text-[11px]">
        {WORK[host].map((work) => {
          if (time < work.start) return null;
          const state = stepState(host, work, time);
          return (
            <div
              key={work.label}
              style={appear(time, work.start)}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate text-foreground">{work.label}</span>
              <span className={state.tone}>{state.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StoreRow({
  name,
  value,
  changed,
  time,
}: {
  name: string;
  value: string;
  changed: number;
  time: number;
}) {
  const fresh = 1 - progress(time, changed, 0.9);
  return (
    <div className="flex items-center justify-between gap-3 rounded-[6px] px-1.5 py-0.5">
      <span className="text-muted-foreground">{name}</span>
      <span
        style={{
          backgroundColor: `color-mix(in oklab, var(--scene-run) ${fresh * 18}%, transparent)`,
        }}
        className="rounded-[4px] px-1 text-foreground tabular-nums"
      >
        {value}
      </span>
    </div>
  );
}

/* One head, two hosts on one store: the lease moves, and the old runner's late write fails. */
export function TakeoverScene() {
  const { clock, target } = useSceneClock(DURATION);
  const { time } = clock;
  const head = HEADS.findLast((entry) => entry.at <= time) ?? HEADS[0];
  const run = RUNS.findLast((entry) => entry.at <= time) ?? RUNS[0];
  const holder = time < EXPIRES ? "host a" : time < TAKEN ? "none" : "host b";
  const holderChanged = time < EXPIRES ? 0 : time < TAKEN ? EXPIRES : TAKEN;

  return (
    <SceneFrame
      label="Two hosts share one store; when the first stops, the second takes the lease and the first one's late write is refused"
      clock={clock}
      target={target}
      steps={STEPS}
      follow={time < OFFLINE ? 0.16 : time < EXPIRES ? 0.5 : time < BACK ? 0.86 : 0.36}
    >
      <div className="relative h-[156px]">
        <div className="absolute inset-y-0 left-0 w-[27%]">
          <HostCard host="a" time={time} />
        </div>
        <div className="absolute inset-y-0 right-0 w-[27%]">
          <HostCard host="b" time={time} />
        </div>

        <div className="absolute top-[22px] left-[27%] h-px w-[9%] bg-foreground/15" />
        <div className="absolute top-[22px] right-[27%] h-px w-[9%] bg-foreground/15" />

        {PACKETS.map((packet) => {
          const travel = progress(time, packet.start, 0.4);
          if (travel <= 0 || travel >= 1) return null;
          const along = ease(packet.toStore ? travel : 1 - travel);
          const left = packet.host === "a" ? lerp(27, 36, along) : lerp(73, 64, along);
          return (
            <span
              key={`${packet.host}-${packet.start}`}
              style={{ left: `${left}%` }}
              className="absolute top-[22px] flex -translate-1/2 flex-col items-center"
            >
              <span className="absolute bottom-3 font-mono text-[10px] whitespace-nowrap text-muted-foreground">
                {packet.kind}
              </span>
              <span className={`size-2.5 rounded-full ${PACKET_TONES[packet.kind]}`} />
            </span>
          );
        })}

        <div className="absolute inset-y-0 left-[36%] w-[28%]">
          <div className="flex h-full flex-col rounded-[14px] bg-background p-3 ring-1 ring-border-subtle">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <IconStorage size={16} className="text-muted-foreground" />
              Store
              <span className="ml-auto font-mono text-[10px] font-normal text-muted-foreground">
                Postgres
              </span>
            </div>
            <div className="mt-1.5 flex flex-col font-mono text-[11px]">
              <StoreRow name="heads/main" value={head.value} changed={head.at} time={time} />
              <StoreRow name="runs/main" value={run.value} changed={run.at} time={time} />
              <StoreRow name="lease" value={holder} changed={holderChanged} time={time} />
            </div>
            {time >= REFUSED ? (
              <p
                style={appear(time, REFUSED)}
                className="mt-auto rounded-[6px] bg-(--scene-bad)/10 px-2 py-1 font-mono text-[11px]/4 text-(--scene-bad)"
              >
                write from host a refused
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </SceneFrame>
  );
}
