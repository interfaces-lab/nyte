import { interpolate } from "remotion";
import evidence from "../core-proof.json";
import {
  Chip,
  clamp,
  colour,
  Code,
  Label,
  Panel,
  reveal,
  SessionShell,
  Step,
  Wire,
} from "./graphics";

export function Execution({ frame }: { readonly frame: number }) {
  const landed = frame >= 60;

  return (
    <g>
      <Panel
        x={140}
        y={245}
        width={350}
        height={110}
        title="your application"
        opacity={reveal(frame, 0)}
      >
        <Label x={165} y={325} size={27} mono tone={colour.blue}>
          session.send(input)
        </Label>
      </Panel>
      <Panel x={610} y={245} width={290} height={110} title="model" opacity={reveal(frame, 55)}>
        <Label x={635} y={325}>
          provider
        </Label>
      </Panel>
      <Panel x={1010} y={245} width={290} height={110} title="tool" opacity={reveal(frame, 100)}>
        <Label x={1035} y={325}>
          your function
        </Label>
      </Panel>
      <Panel
        x={1410}
        y={235}
        width={370}
        height={130}
        title="child session"
        opacity={reveal(frame, 160)}
      >
        <Wire path="M1450 320 H1730" tone={colour.blue} progress={reveal(frame, 180, 35)} />
        {[1460, 1550, 1640, 1730].map((x) => (
          <circle key={x} cx={x} cy={320} r={7} fill={colour.blue} />
        ))}
      </Panel>
      <Wire path="M315 355 V420" progress={reveal(frame, 28)} tone={colour.blue} />
      <Wire path="M755 355 V420" progress={reveal(frame, 75)} tone={colour.blue} />
      <Wire path="M1155 355 V420" progress={reveal(frame, 120)} tone={colour.blue} />
      <Wire path="M1595 365 V420" progress={reveal(frame, 180)} tone={colour.blue} />
      <SessionShell session={evidence.ids.session}>
        <Wire path="M300 595 H1600" progress={reveal(frame, 30, 155)} tone={colour.blue} />
        <Step
          x={300}
          y={595}
          title="message"
          subtitle={evidence.ids.message.slice(0, 8)}
          opacity={reveal(frame, 30)}
        />
        <Step
          x={720}
          y={595}
          title="run"
          subtitle={evidence.ids.run.slice(0, 8)}
          opacity={reveal(frame, 75)}
        />
        <Step
          x={1140}
          y={595}
          title="tool call"
          subtitle="recorded intent"
          active={frame >= 105}
          opacity={reveal(frame, 110)}
        />
        <Step
          x={1600}
          y={595}
          title="wait"
          subtitle="durable part"
          tone={colour.amber}
          opacity={reveal(frame, 160)}
        />
      </SessionShell>
      <g opacity={reveal(frame, 15)}>
        <Chip x={220} y={880} text={`receipt / ${evidence.ids.receipt.slice(0, 8)}`} width={405} />
        <Chip
          x={650}
          y={880}
          text={landed ? "landed" : "pending"}
          tone={landed ? colour.green : colour.amber}
          width={180}
        />
        <Label x={870} y={912} size={25} tone={colour.muted}>
          Admission and completion are separate.
        </Label>
      </g>
    </g>
  );
}

export function Objects({ frame }: { readonly frame: number }) {
  const publish = frame >= 125;
  const positions = [380, 760, 1140, 1520];
  const hashes = evidence.objects.map((object) => object.id);

  return (
    <g>
      <Panel
        x={140}
        y={245}
        width={1640}
        height={280}
        title={`session / ${evidence.ids.session.slice(0, 8)}`}
      >
        <Wire path="M380 385 H1520" tone={colour.blue} />
        {positions.map((x, index) => (
          <Step
            key={x}
            x={x}
            y={385}
            title={evidence.objects[index]?.kind ?? "state"}
            subtitle="structured state"
          />
        ))}
      </Panel>
      {positions.map((x, index) => (
        <g key={x} opacity={reveal(frame, 20 + index * 15)}>
          <Wire
            path={`M${x} 525 V650`}
            tone={colour.line}
            progress={reveal(frame, 20 + index * 15, 30)}
          />
          <rect
            x={x - 108}
            y={650}
            width={216}
            height={100}
            rx={10}
            fill={colour.raised}
            stroke={colour.blue}
            strokeWidth={2}
          />
          <Label x={x} y={693} anchor="middle" size={25} mono>
            {hashes[index]?.slice(0, 10)}
          </Label>
          <Label x={x} y={725} anchor="middle" size={21} tone={colour.muted}>
            immutable object
          </Label>
        </g>
      ))}
      <g opacity={reveal(frame, 105)}>
        <Panel
          x={260}
          y={805}
          width={1400}
          height={105}
          title="one atomic ref batch"
          tone={publish ? colour.green : colour.line}
        >
          <Chip
            x={620}
            y={831}
            text={`runs/${evidence.ids.run.slice(0, 8)}`}
            width={335}
            tone={publish ? colour.green : colour.muted}
          />
          <Chip
            x={985}
            y={831}
            text="inbox/main"
            width={230}
            tone={publish ? colour.green : colour.muted}
          />
          <Chip
            x={1245}
            y={831}
            text="heads/main"
            width={310}
            tone={publish ? colour.green : colour.muted}
          />
        </Panel>
        <Label x={1550} y={790} anchor="end" size={24} tone={publish ? colour.green : colour.muted}>
          {publish ? "published together" : "ready to publish"}
        </Label>
      </g>
    </g>
  );
}

export function Recovery({ frame }: { readonly frame: number }) {
  const first = 1 - reveal(frame, 40, 24);
  const second = reveal(frame, 185, 24);
  const leaseGone = frame >= 145;

  return (
    <g>
      <Panel x={335} y={250} width={470} height={120} title="execution process A" opacity={first}>
        <Label x={360} y={335} mono size={27} tone={colour.blue}>
          executing a durable step
        </Label>
      </Panel>
      <Panel x={1115} y={250} width={470} height={120} title="execution process B" opacity={second}>
        <Label x={1140} y={335} mono tone={colour.green}>
          reads the recorded call
        </Label>
      </Panel>
      <Wire path="M570 370 V420" tone={colour.blue} progress={first} />
      <Wire path="M1350 370 V420" tone={colour.green} progress={second} />
      <SessionShell session={evidence.ids.session}>
        <Chip x={205} y={515} text={`run / ${evidence.ids.run.slice(0, 8)}`} width={380} />
        <Chip x={625} y={515} text="unfinished tool call" width={330} tone={colour.amber} />
        <Chip x={995} y={515} text="replay: safe" width={270} tone={colour.muted} />
        <Panel x={205} y={610} width={1510} height={150} title="durable store">
          <Label x={240} y={713} size={37}>
            {frame < 65
              ? "The process stops."
              : frame < 185
                ? "The recorded session stays."
                : "The next instance recovers the step."}
          </Label>
        </Panel>
      </SessionShell>
      <g opacity={reveal(frame, 65)}>
        <Label x={300} y={915} size={27} tone={colour.muted}>
          execution lease
        </Label>
        <rect x={535} y={891} width={690} height={25} rx={12} fill={colour.raised} />
        <rect
          x={535}
          y={891}
          width={690 * (1 - interpolate(frame, [65, 145], [0, 1], clamp))}
          height={25}
          rx={12}
          fill={colour.amber}
        />
        <Label x={1280} y={915} size={26} tone={leaseGone ? colour.green : colour.amber}>
          {frame >= 185 ? "new owner" : leaseGone ? "expired" : "held by A"}
        </Label>
      </g>
    </g>
  );
}

export function Branches({ frame }: { readonly frame: number }) {
  const fork = reveal(frame, 35, 65);
  const mainTip = evidence.commits.find((commit) => commit.id === evidence.heads.main.tip);

  return (
    <g>
      <SessionShell session={evidence.ids.session}>
        <Wire path="M260 565 H1580" tone={colour.blue} />
        <Wire path="M730 565 C840 565 845 730 970 730 H1440" progress={fork} tone={colour.green} />
        <Step x={260} y={565} title="input" subtitle="shared history" />
        <Step x={495} y={565} title="tool result" subtitle="shared history" />
        <Step x={730} y={565} title="answer" subtitle="fork point" />
        <Step
          x={1130}
          y={565}
          title="input"
          subtitle={mainTip?.parent?.slice(0, 8) ?? "main input"}
          opacity={reveal(frame, 100)}
        />
        <Step
          x={1580}
          y={565}
          title="main"
          subtitle={evidence.heads.main.tip.slice(0, 8)}
          opacity={reveal(frame, 120)}
        />
        <g opacity={fork}>
          <circle
            cx={970}
            cy={730}
            r={12}
            fill={colour.background}
            stroke={colour.green}
            strokeWidth={3}
          />
          <circle
            cx={1205}
            cy={730}
            r={12}
            fill={colour.background}
            stroke={colour.green}
            strokeWidth={3}
          />
          <Chip x={1270} y={706} text={evidence.ids.branch} width={235} tone={colour.green} />
        </g>
      </SessionShell>
      <g opacity={reveal(frame, 145)}>
        <Code
          x={220}
          y={880}
          lines={[
            'const headName = asId<"head">("alternative");',
            "await session.heads.create(headName, { from: tree.tip });",
          ]}
          size={29}
        />
      </g>
    </g>
  );
}
