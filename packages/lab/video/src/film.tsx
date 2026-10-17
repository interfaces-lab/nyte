import { Audio } from "@remotion/media";
import { AbsoluteFill, staticFile, useCurrentFrame } from "remotion";
import { Avatar } from "./avatars";
import { Extensions, Hosts, Interfaces, Parts } from "./composition-scenes";
import { Branches, Execution, Objects, Recovery } from "./execution-scenes";
import { Chip, colour, Label, Mark, Panel, reveal, Step, Wire } from "./graphics";
import { fps, scenes, soundtrack } from "./introduction";
import type { Scene } from "./introduction";

function Title({ frame }: { readonly frame: number }) {
  return (
    <g>
      <Mark x={145} y={225} size={104} />
      <Label x={287} y={315} size={132} weight={550}>
        Nyte Core
      </Label>
      <Label x={145} y={414} size={48} tone={colour.blue}>
        A durable runtime for agents.
      </Label>
      <g opacity={reveal(frame, 50, 30)}>
        <Chip x={185} y={625} text="model" width={220} />
        <Panel x={540} y={545} width={840} height={280} title="agent runtime" tone={colour.blue}>
          <Wire path="M650 670 H1265" tone={colour.blue} progress={reveal(frame, 80, 55)} />
          <Step x={650} y={670} title="session" subtitle="history" />
          <Step x={960} y={670} title="execution" subtitle="runs and steps" active />
          <Step x={1265} y={670} title="state" subtitle="durable records" />
        </Panel>
        <Chip x={1515} y={625} text="tools" width={220} />
        <Wire path="M405 649 H540" tone={colour.blue} progress={reveal(frame, 85, 30)} />
        <Wire path="M1380 649 H1515" tone={colour.blue} progress={reveal(frame, 125, 30)} />
      </g>
      <Label x={960} y={927} anchor="middle" size={31} tone={colour.muted}>
        Your model. Your environment. Your interface.
      </Label>
    </g>
  );
}

function End({ frame }: { readonly frame: number }) {
  return (
    <g opacity={reveal(frame, 0, 16)}>
      <Mark x={894} y={235} size={132} />
      <Label x={960} y={500} anchor="middle" size={112} weight={550}>
        Nyte Core
      </Label>
      <Label x={960} y={603} anchor="middle" size={48} tone={colour.blue}>
        Build agents that can continue.
      </Label>
      <Label x={960} y={741} anchor="middle" size={29} mono tone={colour.muted}>
        nyte.sh/docs/build/composition
      </Label>
    </g>
  );
}

function Diagram({ scene, frame }: { readonly scene: Scene; readonly frame: number }) {
  switch (scene.kind) {
    case "title":
      return <Title frame={frame} />;
    case "execution":
      return <Execution frame={frame} />;
    case "objects":
      return <Objects frame={frame} />;
    case "recovery":
      return <Recovery frame={frame} />;
    case "branches":
      return <Branches frame={frame} />;
    case "parts":
      return <Parts frame={frame} />;
    case "extensions":
      return <Extensions frame={frame} />;
    case "interfaces":
      return <Interfaces frame={frame} />;
    case "hosts":
      return <Hosts frame={frame} />;
    case "end":
      return <End frame={frame} />;
  }

  const unreachable: never = scene;

  return unreachable;
}

function Presenters({
  scene,
  frame,
  globalFrame,
}: {
  readonly scene: Scene;
  readonly frame: number;
  readonly globalFrame: number;
}) {
  const answering = scene.kind === "parts";
  const researcherX = answering ? 215 : 93;

  const researcherTargets = {
    title: { x: 650, y: 670 },
    execution:
      frame < 70 ? { x: 315, y: 325 } : frame < 150 ? { x: 720, y: 595 } : { x: 650, y: 903 },
    objects: frame < 115 ? { x: 380, y: 695 } : { x: 620, y: 854 },
    recovery: { x: 400, y: 713 },
    branches: frame < 105 ? { x: 730, y: 565 } : { x: 970, y: 730 },
    parts: { x: 522, y: 688 },
    extensions: frame < 105 ? { x: 350, y: 345 } : { x: 350, y: 745 },
    interfaces: { x: 500, y: 590 },
    hosts: { x: 400, y: 650 },
    end: { x: 960, y: 500 },
  };

  const workerTargets = {
    title: { x: 1265, y: 670 },
    execution: frame < 150 ? { x: 1140, y: 595 } : { x: 1595, y: 320 },
    objects: { x: 1520, y: 693 },
    recovery: { x: 1350, y: 335 },
    branches: { x: 1440, y: 730 },
    parts: { x: 1490, y: 678 },
    extensions: frame < 160 ? { x: 1510, y: 345 } : { x: 1510, y: 745 },
    interfaces: frame < 105 ? { x: 1450, y: 386 } : { x: 1450, y: 766 },
    hosts: { x: 1520, y: 650 },
    end: { x: 960, y: 500 },
  };

  const visible = scene.kind === "end" ? 1 - reveal(frame, 0, 18) : 1;

  const reach = answering
    ? reveal(frame, 82, 28) * (1 - reveal(frame, 155, 25))
    : reveal(frame, 8, 25);

  const answer = reveal(frame, 110, 25);
  const answerVisible = answering && frame >= 110 && frame < 135;
  const acknowledged = answering ? Math.sin(Math.PI * reveal(frame, 140, 32)) : 0;

  return (
    <g opacity={visible}>
      <Avatar
        x={researcherX}
        y={975}
        scale={answering ? 0.95 : 1.02}
        kind="researcher"
        pose={
          answering
            ? "answer"
            : scene.kind === "recovery" ||
                scene.kind === "extensions" ||
                scene.kind === "interfaces"
              ? "carry"
              : "point"
        }
        target={researcherTargets[scene.kind]}
        gesture={reach}
        nod={acknowledged}
        frame={globalFrame}
      />
      <Label x={researcherX} y={1034} anchor="middle" size={22} tone={colour.muted}>
        you
      </Label>
      {answerVisible && (
        <circle
          cx={363 + (522 - 363) * answer}
          cy={786 + (688 - 786) * answer - Math.sin(answer * Math.PI) * 20}
          r={9}
          fill={colour.green}
        />
      )}
      {answering && frame >= 128 && frame < 153 && (
        <rect
          x={365 - reveal(frame, 128, 25) * 10}
          y={653 - reveal(frame, 128, 25) * 10}
          width={315 + reveal(frame, 128, 25) * 20}
          height={70 + reveal(frame, 128, 25) * 20}
          rx={13}
          fill="none"
          stroke={colour.green}
          strokeWidth={3}
          opacity={1 - reveal(frame, 133, 20)}
        />
      )}
      {scene.kind === "recovery" ? (
        <g>
          <Avatar
            x={260}
            y={392}
            scale={0.64}
            kind="worker"
            pose="point"
            target={{ x: 570, y: 335 }}
            gesture={reveal(frame, 0, 22)}
            frame={globalFrame}
            badge="A"
            opacity={1 - reveal(frame, 40, 24)}
          />
          <Avatar
            x={1660}
            y={392}
            scale={0.64}
            kind="worker"
            pose="point"
            target={{ x: 1350, y: 335 }}
            gesture={reveal(frame, 185, 28)}
            frame={globalFrame + 53}
            badge="B"
            opacity={reveal(frame, 185, 24)}
          />
        </g>
      ) : (
        <g>
          <Avatar
            x={1825}
            y={975}
            scale={1.02}
            kind="worker"
            pose={
              (answering && frame < 135) || (scene.kind === "extensions" && frame >= 160)
                ? "wait"
                : "point"
            }
            target={workerTargets[scene.kind]}
            gesture={answering ? reveal(frame, 135, 25) : reveal(frame, 20, 25)}
            nod={acknowledged}
            frame={globalFrame}
          />
          <Label x={1825} y={1034} anchor="middle" size={22} tone={colour.muted}>
            host process
          </Label>
        </g>
      )}
    </g>
  );
}

export function Film() {
  const frame = useCurrentFrame();
  const scene = scenes.findLast((scene) => frame >= scene.from * fps) ?? scenes[0];
  const local = frame - scene.from * fps;

  return (
    <AbsoluteFill
      style={{
        background: colour.background,
        color: colour.text,
        fontFamily: "'Inter Variable', Inter, system-ui, sans-serif",
        fontOpticalSizing: "auto",
      }}
    >
      <svg
        width={1920}
        height={1080}
        viewBox="0 0 1920 1080"
        role="img"
        aria-label="An illustrated explanation of Nyte Core"
      >
        <Mark x={80} y={46} size={32} />
        <Label x={128} y={73} size={25} weight={550}>
          Nyte Core
        </Label>
        <Label x={1840} y={73} size={22} anchor="end" mono tone={colour.muted}>
          @nyte-ai/core
        </Label>
        {scene.kind !== "title" && scene.kind !== "end" && (
          <g opacity={reveal(local, 0, 12)}>
            <Label x={140} y={160} size={54} weight={500}>
              {scene.title}
            </Label>
            <Label x={960} y={1008} anchor="middle" size={25} tone={colour.muted}>
              {scene.detail}
            </Label>
          </g>
        )}
        <Diagram scene={scene} frame={local} />
        <Presenters scene={scene} frame={local} globalFrame={frame} />
      </svg>
      <Audio src={staticFile(soundtrack)} volume={1} />
    </AbsoluteFill>
  );
}
