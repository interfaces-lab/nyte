import evidence from "../core-proof.json";
import { Chip, colour, Code, Label, Panel, reveal, Wire } from "./graphics";

export function Parts({ frame }: { readonly frame: number }) {
  const answered = frame >= 135;

  return (
    <g>
      <Panel
        x={140}
        y={245}
        width={1640}
        height={135}
        title={`stored part / ${evidence.ids.question.slice(0, 8)}`}
        tone={colour.amber}
      >
        <Label x={175} y={340} mono size={30}>
          kind: film/direction
        </Label>
        <Chip
          x={1240}
          y={290}
          text={answered ? "answer recorded" : "waiting for answer"}
          width={470}
          tone={answered ? colour.green : colour.amber}
        />
      </Panel>
      <Wire path="M735 380 V440" tone={colour.amber} progress={reveal(frame, 10)} />
      <Wire path="M1480 380 V450" tone={colour.amber} progress={reveal(frame, 35)} />
      <Panel
        x={325}
        y={440}
        width={790}
        height={330}
        title="your renderer"
        opacity={reveal(frame, 20)}
      >
        <Label x={365} y={553} size={38}>
          Which direction should
        </Label>
        <Label x={365} y={603} size={38}>
          we explore?
        </Label>
        <g>
          <rect
            x={365}
            y={653}
            width={315}
            height={70}
            rx={13}
            fill={answered ? colour.green : colour.raised}
            stroke={answered ? colour.green : colour.line}
            strokeWidth={2}
          />
          <Label
            x={522}
            y={698}
            anchor="middle"
            size={29}
            tone={answered ? colour.background : colour.text}
          >
            Outline first
          </Label>
          <rect
            x={710}
            y={653}
            width={355}
            height={70}
            rx={13}
            fill={colour.raised}
            stroke={colour.line}
            strokeWidth={2}
          />
          <Label x={887} y={698} anchor="middle" size={28} tone={colour.muted}>
            Another direction
          </Label>
        </g>
      </Panel>
      <Panel
        x={1330}
        y={450}
        width={330}
        height={320}
        title="another SDK client"
        opacity={reveal(frame, 45)}
      >
        <Label x={1360} y={550} size={25}>
          same part
        </Label>
        <Label x={1360} y={605} size={27} tone={colour.amber}>
          same question
        </Label>
        <Chip
          x={1360}
          y={655}
          text={answered ? "answered" : "waiting"}
          width={250}
          tone={answered ? colour.green : colour.amber}
        />
      </Panel>
      <Wire
        path="M1330 655 C1220 655 1230 335 1120 335"
        tone={colour.green}
        progress={reveal(frame, 100, 35)}
      />
      <g opacity={reveal(frame, 145)}>
        <Chip x={330} y={820} text='act("answer")' width={330} tone={colour.green} />
        <Chip x={700} y={820} text="resume the step" width={330} tone={colour.green} />
        <Chip x={1070} y={820} text="run: completed" width={500} tone={colour.green} />
      </g>
      <Label x={960} y={932} size={27} tone={colour.muted} anchor="middle">
        One state and action contract. Different presentations.
      </Label>
    </g>
  );
}

export function Extensions({ frame }: { readonly frame: number }) {
  return (
    <g>
      <Panel x={650} y={425} width={620} height={270} title="Nyte Core" tone={colour.blue}>
        <Chip x={690} y={515} text="session" width={240} />
        <Chip x={970} y={515} text="execution" width={260} />
        <Label x={960} y={635} anchor="middle" size={31}>
          state stays in the runtime
        </Label>
      </Panel>
      <Wire
        path="M600 350 C650 350 650 425 740 425"
        tone={colour.blue}
        progress={reveal(frame, 5)}
      />
      <Wire
        path="M1320 350 C1270 350 1270 425 1180 425"
        tone={colour.blue}
        progress={reveal(frame, 55)}
      />
      <Wire
        path="M600 730 C650 730 650 695 740 695"
        tone={colour.green}
        progress={reveal(frame, 110)}
      />
      <Wire
        path="M1320 730 C1270 730 1270 695 1180 695"
        tone={colour.amber}
        progress={reveal(frame, 165)}
      />
      <Panel
        x={140}
        y={245}
        width={460}
        height={180}
        title="model providers"
        opacity={reveal(frame, 0)}
      >
        <Label x={170} y={345} size={30}>
          choose the model
        </Label>
        <Label x={170} y={389} size={24} mono tone={colour.muted}>
          @nyte-ai/ai
        </Label>
      </Panel>
      <Panel
        x={1320}
        y={245}
        width={460}
        height={180}
        title="core plugins"
        opacity={reveal(frame, 50)}
      >
        <Label x={1350} y={345} size={30}>
          tools · agents · hooks
        </Label>
        <Label x={1350} y={389} size={24} tone={colour.muted}>
          schemas and replay policies
        </Label>
      </Panel>
      <Panel
        x={140}
        y={645}
        width={460}
        height={190}
        title="execution environment"
        opacity={reveal(frame, 105)}
      >
        <Label x={170} y={745} size={29}>
          files · processes · git
        </Label>
        <Label x={170} y={791} size={24} tone={colour.muted}>
          capabilities supplied by the host
        </Label>
      </Panel>
      <Panel
        x={1320}
        y={645}
        width={460}
        height={190}
        title="parts and renderers"
        opacity={reveal(frame, 160)}
      >
        <Label x={1350} y={745} size={29}>
          text · questions · canvases
        </Label>
        <Label x={1350} y={791} size={24} tone={colour.muted}>
          render the kinds your client supports
        </Label>
      </Panel>
      <g opacity={reveal(frame, 195)}>
        <Chip x={650} y={875} text="MCP" width={150} tone={colour.muted} />
        <Chip x={830} y={875} text="skills" width={185} tone={colour.muted} />
        <Chip x={1045} y={875} text="settings" width={220} tone={colour.muted} />
      </g>
    </g>
  );
}

const example = [
  "const host = await sdk.open({",
  "  store, models, plugins, workspace",
  "});",
  "const session = await host.sessions.create();",
  "await session.send(input);",
  "",
  "for await (const view of session.watch()) {",
  "  render(view);",
  "}",
];

export function Interfaces({ frame }: { readonly frame: number }) {
  const active = Math.min(8, Math.floor(frame / 25));
  const answered = frame >= 160;

  return (
    <g>
      <Panel x={140} y={245} width={860} height={600} title="@nyte-ai/sdk" tone={colour.blue}>
        <Code x={175} y={355} lines={example} size={25} active={active} width={790} />
        <Label x={175} y={806} size={24} tone={colour.muted}>
          render(view) is your application code.
        </Label>
      </Panel>
      <Wire path="M1000 545 H1080" progress={reveal(frame, 30)} tone={colour.blue} />
      <Wire path="M1080 370 V725" progress={reveal(frame, 55)} tone={colour.blue} />
      <Wire path="M1080 370 H1130" progress={reveal(frame, 55)} tone={colour.blue} />
      <Wire path="M1080 545 H1130" progress={reveal(frame, 80)} tone={colour.blue} />
      <Wire path="M1080 725 H1130" progress={reveal(frame, 105)} tone={colour.blue} />
      <Panel
        x={1130}
        y={285}
        width={650}
        height={165}
        title="terminal renderer"
        opacity={reveal(frame, 45)}
      >
        <Label x={1160} y={386} size={28} mono tone={colour.amber}>
          ? Which direction?
        </Label>
        <Label x={1160} y={424} size={25} mono tone={colour.green}>
          {answered ? "> Outline first" : "> waiting for input"}
        </Label>
      </Panel>
      <Panel
        x={1130}
        y={475}
        width={650}
        height={165}
        title="web renderer"
        opacity={reveal(frame, 75)}
      >
        <Label x={1160} y={573} size={29}>
          Which direction should we explore?
        </Label>
        <Chip
          x={1160}
          y={589}
          text={answered ? "Outline first" : "choose a direction"}
          width={470}
          tone={answered ? colour.green : colour.amber}
        />
      </Panel>
      <Panel
        x={1130}
        y={665}
        width={650}
        height={165}
        title="mobile renderer"
        opacity={reveal(frame, 105)}
      >
        <Label x={1160} y={766} size={29}>
          same question, connected host
        </Label>
        <Label x={1160} y={808} size={26} tone={answered ? colour.green : colour.amber}>
          {answered ? "answer recorded" : "waiting for answer"}
        </Label>
      </Panel>
      <g opacity={reveal(frame, 135)}>
        <Chip
          x={450}
          y={885}
          text={`same session / ${evidence.ids.session.slice(0, 8)}`}
          width={650}
        />
        <Chip x={1130} y={885} text="sdk.open / sdk.connect" width={500} tone={colour.muted} />
      </g>
    </g>
  );
}

export function Hosts({ frame }: { readonly frame: number }) {
  return (
    <g>
      <Panel
        x={715}
        y={260}
        width={490}
        height={150}
        title="same Core contracts"
        tone={colour.blue}
      >
        <Label x={960} y={365} anchor="middle" size={42}>
          compose your host
        </Label>
      </Panel>
      <Wire path="M960 410 V480 H400 V535" tone={colour.blue} progress={reveal(frame, 5, 30)} />
      <Wire path="M960 410 V535" tone={colour.blue} progress={reveal(frame, 30, 30)} />
      <Wire path="M960 480 H1520 V535" tone={colour.blue} progress={reveal(frame, 55, 30)} />
      <Panel
        x={180}
        y={535}
        width={440}
        height={265}
        title="local host"
        opacity={reveal(frame, 10)}
      >
        <Label x={400} y={650} anchor="middle" size={39}>
          SQLite
        </Label>
        <Label x={400} y={716} anchor="middle" size={27} tone={colour.muted}>
          local environment
        </Label>
        <Chip x={285} y={740} text="Node" width={230} tone={colour.muted} />
      </Panel>
      <Panel
        x={740}
        y={535}
        width={440}
        height={265}
        title="server host"
        opacity={reveal(frame, 35)}
      >
        <Label x={960} y={650} anchor="middle" size={39}>
          PostgreSQL
        </Label>
        <Label x={960} y={716} anchor="middle" size={27} tone={colour.muted}>
          your environment
        </Label>
        <Chip x={805} y={740} text="driver adapters" width={310} tone={colour.muted} />
      </Panel>
      <Panel
        x={1300}
        y={535}
        width={440}
        height={265}
        title="edge adapter"
        opacity={reveal(frame, 60)}
      >
        <Label x={1520} y={650} anchor="middle" size={36}>
          Durable Object
        </Label>
        <Label x={1520} y={716} anchor="middle" size={26} tone={colour.muted}>
          example: chat-only
        </Label>
        <Chip x={1400} y={740} text="alarm driver" width={250} tone={colour.muted} />
      </Panel>
      <Label x={960} y={900} anchor="middle" size={27} tone={colour.muted}>
        Choose a model provider and capabilities for each environment.
      </Label>
    </g>
  );
}
