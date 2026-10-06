/**
 * How one core serves the review lab's agent requests: the path each request
 * takes from the page to core (Mermaid), and the heads it lands on (React
 * Flow). Facts mirror `src/review/api.ts`, `server/review.ts` and
 * `server/reviewer.ts`.
 */
import "@xyflow/react/dist/style.css";
import { create, props } from "@stylexjs/stylex";
import {
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { useState, type ReactElement } from "react";
import { MermaidDiagram } from "@nyte-ai/app/conversation/mermaid-diagram.tsx";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { role, type } from "@nyte-ai/ui/vars.stylex";

const ORDER = ["chat", "guide", "side", "change"] as const;

type RequestId = (typeof ORDER)[number];

type SessionId = "review" | "author";

/** Every request's path: the app, the lab's API, the lab server, core, and the same read back. */
const sequence = (app: string, steps: readonly string[]): string =>
  [
    "sequenceDiagram",
    `  participant App as ${app}`,
    "  participant Page as api.ts",
    "  participant Lab as review.ts",
    "  participant Core",
    ...steps.map((step) => `  ${step}`),
    "  Core-->>Page: snapshot + watch via /core/nyte",
  ].join("\n");

const REQUESTS: Readonly<
  Record<
    RequestId,
    {
      readonly label: string;
      readonly session: SessionId;
      readonly path: string;
      readonly head: string;
      readonly from: string;
      readonly tools: string;
      readonly saved: string;
    }
  >
> = {
  chat: {
    label: "Chat",
    session: "author",
    path: sequence("New Chat", [
      "App->>Page: task",
      "Page->>Lab: POST /core/review/tasks",
      "Lab->>Lab: branch + worktree",
      "Lab->>Core: sessions.create(cwd: worktree)",
      "Lab->>Core: messages.send(task)",
    ]),
    head: "main",
    from: "Empty",
    tools: "Edit, shell",
    saved: "Yes",
  },
  guide: {
    label: "Guide",
    session: "review",
    path: sequence("Write Guide", [
      "App->>Page: click",
      "Page->>Lab: POST /core/review/reviews/:id/guide",
      "Lab->>Lab: pick an earlier brief to cut from",
      "Lab->>Core: heads.create(brief-sha, from)",
      "Lab->>Core: messages.send(patch or interdiff)",
    ]),
    head: "brief-<sha>",
    from: "main + patch, or an earlier brief + interdiff",
    tools: "Read-only, publish_guide",
    saved: "No",
  },
  side: {
    label: "Side chat",
    session: "review",
    path: sequence("Side chat", [
      "App->>Page: question",
      "Page->>Lab: POST /core/review/reviews/:id/ask",
      "Lab->>Lab: refuse until the guide exists",
      "Lab->>Core: heads.create(side-sha-thread, from: brief-sha)",
      "Lab->>Core: messages.send(question)",
    ]),
    head: "side-<sha>-<thread>",
    from: "brief-<sha>",
    tools: "Read-only",
    saved: "No",
  },
  change: {
    label: "Change",
    session: "author",
    path: sequence("Side chat", [
      "App->>Page: change",
      "Page->>Lab: POST /core/review/reviews/:id/change",
      "Lab->>Core: messages.send(change) on main",
    ]),
    head: "main",
    from: "Nyte's chat so far",
    tools: "Edit, shell",
    saved: "Yes",
  },
};

const SESSIONS: Readonly<Record<SessionId, { readonly name: string; readonly table: string }>> = {
  review: { name: "review <id> · reviewer <version>", table: "Review" },
  author: { name: "author <id>", table: "Nyte" },
};

/** Heads in each session, placed inside its box; `from` is the head it forks. */
const HEADS: readonly {
  readonly id: string;
  readonly session: SessionId;
  readonly name: string;
  readonly sent: string;
  readonly from?: string;
  readonly by: readonly RequestId[];
  readonly x: number;
  readonly y: number;
}[] = [
  { id: "review-main", session: "review", name: "main", sent: "empty", by: [], x: 20, y: 48 },
  {
    id: "brief-a",
    session: "review",
    name: "brief-3f9c21ab07de",
    sent: "patch",
    from: "review-main",
    by: ["guide"],
    x: 250,
    y: 48,
  },
  {
    id: "brief-b",
    session: "review",
    name: "brief-8e4d55c1a2b0",
    sent: "interdiff",
    from: "brief-a",
    by: ["guide"],
    x: 480,
    y: 48,
  },
  {
    id: "side-b",
    session: "review",
    name: "side-8e4d55c1a2b0-p2q7",
    sent: "question",
    from: "brief-b",
    by: ["side"],
    x: 710,
    y: 48,
  },
  {
    id: "side-a",
    session: "review",
    name: "side-3f9c21ab07de-k3x9",
    sent: "question",
    from: "brief-a",
    by: ["side"],
    x: 480,
    y: 140,
  },
  {
    id: "author-main",
    session: "author",
    name: "main",
    sent: "task, then changes",
    by: ["chat", "change"],
    x: 20,
    y: 48,
  },
];

const BOXES: Readonly<
  Record<
    SessionId,
    { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  >
> = {
  review: { x: 200, y: 0, w: 940, h: 216 },
  author: { x: 200, y: 256, w: 250, h: 124 },
};

const REQUEST_Y: Readonly<Record<RequestId, number>> = {
  guide: 40,
  side: 128,
  chat: 270,
  change: 334,
};

type RequestNode = Node<{ label: string; lit: boolean }, "request">;

type SessionNode = Node<{ name: string }, "session">;

type HeadNode = Node<{ name: string; sent: string; lit: boolean }, "head">;

function RequestCard({ data }: NodeProps<RequestNode>): ReactElement {
  return (
    <div {...props(styles.request, data.lit && styles.lit)}>
      {data.label}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        {...props(styles.handle)}
      />
    </div>
  );
}

function SessionBox({ data }: NodeProps<SessionNode>): ReactElement {
  return (
    <div {...props(styles.session)}>
      <code {...props(styles.sessionName)}>{data.name}</code>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        {...props(styles.handle)}
      />
    </div>
  );
}

function HeadCard({ data }: NodeProps<HeadNode>): ReactElement {
  return (
    <div {...props(styles.head, data.lit && styles.lit)}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        {...props(styles.handle)}
      />
      <code {...props(styles.headName)}>{data.name}</code>
      <span {...props(styles.sent)}>{data.sent}</span>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        {...props(styles.handle)}
      />
    </div>
  );
}

const NODE_TYPES = {
  request: RequestCard,
  session: SessionBox,
  head: HeadCard,
} satisfies NodeTypes;

function graphOf(selected: RequestId) {
  const lit = { stroke: role.contentPrimary, strokeWidth: 1.5 };
  const quiet = { stroke: role.borderPrimaryTranslucent };

  const requests = ORDER.map((id): RequestNode => ({
    id,
    type: "request",
    position: { x: 0, y: REQUEST_Y[id] },
    data: { label: REQUESTS[id].label, lit: id === selected },
  }));

  const sessions = (["review", "author"] as const).map((id): SessionNode => ({
    id,
    type: "session",
    position: { x: BOXES[id].x, y: BOXES[id].y },
    style: { width: BOXES[id].w, height: BOXES[id].h },
    data: { name: SESSIONS[id].name },
  }));

  const heads = HEADS.map((head): HeadNode => ({
    id: head.id,
    type: "head",
    parentId: head.session,
    extent: "parent",
    position: { x: head.x, y: head.y },
    data: { name: head.name, sent: head.sent, lit: head.by.includes(selected) },
  }));

  const uses = ORDER.map((id): Edge => ({
    id: `${id}-uses`,
    source: id,
    target: REQUESTS[id].session,
    animated: id === selected,
    style: id === selected ? lit : quiet,
  }));

  const forks = HEADS.flatMap((head): Edge[] =>
    head.from === undefined
      ? []
      : [
          {
            id: `${head.from}-${head.id}`,
            source: head.from,
            target: head.id,
            style: head.by.includes(selected) ? lit : quiet,
          },
        ],
  );

  return { nodes: [...requests, ...sessions, ...heads], edges: [...uses, ...forks] };
}

export function RequestsPage(): ReactElement {
  const [selected, setSelected] = useState<RequestId>("chat");
  const request = REQUESTS[selected];
  const { nodes, edges } = graphOf(selected);

  const select = (value: string | undefined): void => {
    const next = ORDER.find((id) => id === value);

    if (next !== undefined) setSelected(next);
  };

  return (
    <main {...props(styles.page)}>
      <div {...props(styles.column)}>
        <header {...props(styles.header)}>
          <h1 {...props(styles.title)}>One core, four requests</h1>
          <ToggleGroup
            aria-label="Request"
            value={[selected]}
            onValueChange={(values) => select(values.at(-1))}
          >
            {ORDER.map((id) => (
              <Toggle key={id} value={id}>
                {REQUESTS[id].label}
              </Toggle>
            ))}
          </ToggleGroup>
        </header>
        <section aria-label="Heads" {...props(styles.flow)}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            colorMode="system"
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            onNodeClick={(_, node) => select(node.id)}
          />
        </section>
        <section aria-label="Path" {...props(styles.path)}>
          <MermaidDiagram key={selected} source={request.path} />
        </section>
        <div {...props(styles.tableScroll)}>
          <table {...props(styles.table)}>
            <thead>
              <tr>
                {["", "Session", "Head", "Starts from", "Tools", "Saved as a chat"].map((label) => (
                  <th key={label} scope="col" {...props(styles.th)}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ORDER.map((id) => (
                <tr key={id} {...props(id === selected && styles.rowLit)}>
                  <th scope="row" {...props(styles.td, styles.rowHeader)}>
                    {REQUESTS[id].label}
                  </th>
                  <td {...props(styles.td)}>{SESSIONS[REQUESTS[id].session].table}</td>
                  <td {...props(styles.td)}>
                    <code {...props(styles.mono)}>{REQUESTS[id].head}</code>
                  </td>
                  <td {...props(styles.td)}>{REQUESTS[id].from}</td>
                  <td {...props(styles.td)}>{REQUESTS[id].tools}</td>
                  <td {...props(styles.td)}>{REQUESTS[id].saved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

const styles = create({
  page: {
    height: "100%",
    overflowY: "auto",
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: 1120,
    marginInline: "auto",
    padding: "48px 32px 96px",
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  title: { margin: 0, fontSize: type.font2xl, fontWeight: 600, letterSpacing: type.letterLg },
  flow: {
    height: 400,
    borderRadius: radius.card,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    overflow: "hidden",
  },
  path: { minHeight: 280 },
  request: {
    width: 140,
    paddingBlock: 10,
    paddingInline: 12,
    borderRadius: radius.control,
    backgroundColor: role.bgMutedTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    fontWeight: 500,
    cursor: "pointer",
  },
  session: {
    width: "100%",
    height: "100%",
    padding: 12,
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: role.borderPrimaryTranslucent,
  },
  sessionName: { color: role.contentSecondary, fontFamily: type.fontMono, fontSize: type.fontXs },
  head: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    width: 200,
    paddingBlock: 8,
    paddingInline: 10,
    borderRadius: radius.control,
    backgroundColor: role.bgBase,
    boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentSecondary,
  },
  lit: {
    backgroundColor: role.bgInteractivePrimaryTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderPrimaryTranslucent}`,
    color: role.contentPrimary,
  },
  headName: { fontFamily: type.fontMono, fontSize: type.fontXs, fontWeight: 500 },
  sent: { fontSize: type.fontXs },
  // Edges need a handle to attach to; nothing here connects, so none shows.
  handle: { opacity: 0 },
  mono: { fontFamily: type.fontMono, fontSize: "0.92em" },
  tableScroll: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: type.fontSm },
  th: {
    paddingBlock: 8,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    color: role.contentSecondary,
    fontWeight: 500,
    textAlign: "start",
    whiteSpace: "nowrap",
  },
  td: {
    paddingBlock: 8,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    lineHeight: type.leadingSm,
    textAlign: "start",
    verticalAlign: "top",
  },
  rowHeader: { fontWeight: 500, whiteSpace: "nowrap" },
  rowLit: { backgroundColor: role.bgInteractivePrimaryTranslucent },
});
