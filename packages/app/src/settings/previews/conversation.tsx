import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { asId } from "@nyte-ai/schema";
import type { PatchEntry, ToolClass } from "@nyte-ai/schema";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Prose } from "../../chat/markdown/prose.tsx";
import { StepGroupView } from "../../chat/transcript/step-group.tsx";
import { preferences, useSetting } from "../../preferences/index.ts";
import { conversation } from "../../theme/schema.stylex.ts";

const CWD = "/Users/ada/nyte";

const FILE = "src/density.ts";

const STARTED = Date.UTC(2026, 0, 12, 9, 30);

const PATCH = `diff --git a/${FILE} b/${FILE}
--- a/${FILE}
+++ b/${FILE}
@@ -1,2 +1,2 @@
-export type Density = "compact" | "detailed";
+export type Density = "compact" | "balanced" | "detailed";
 export const DEFAULT_DENSITY: Density = "compact";
`;

const FINISHED: readonly ToolMessage[] = [
  settledTool("read", { kind: "read", path: `${CWD}/${FILE}` }, 0),
  settledTool("search", { kind: "shell", command: 'rg -n "Density" src' }, 1_400, {
    text: `${FILE}:1:export type Density = "compact" | "detailed";`,
  }),
  settledTool("edit", { kind: "edit", path: `${CWD}/${FILE}` }, 3_100, {
    patch: {
      kind: "text",
      path: FILE,
      status: "modified",
      digest: "preview",
      added: 1,
      removed: 1,
      patch: PATCH,
    },
  }),
];

const RUNNING: readonly ToolMessage[] = [
  {
    ...message("test", STARTED + 5_000),
    state: {
      call: asId<"call">("test"),
      name: "shell",
      args: null,
      class: { kind: "shell", command: "pnpm test" },
      phase: "running",
      progress: null,
    },
    status: { kind: "live", run: asId<"run">("preview") },
  },
];

const REPLY = `Added \`balanced\` between the two densities:

\`\`\`ts
export type Density = "compact" | "balanced" | "detailed"; // Compact previews the running step, Detailed keeps finished steps open
\`\`\`

Running the tests now.`;

export function ConversationPreview(): ReactElement {
  const density = useSetting(preferences.toolCalls);

  return (
    <div {...props(styles.turn)}>
      <StepGroupView
        messages={FINISHED}
        cwd={CWD}
        added={1}
        removed={1}
        running={false}
        density={density}
      />
      <Prose markdown={REPLY} />
      <StepGroupView messages={RUNNING} cwd={CWD} added={0} removed={0} running density={density} />
    </div>
  );
}

function message(id: string, at: number) {
  return {
    id: asId<"message">(id),
    turn: asId<"turn">("preview"),
    at,
    kind: "part",
    part: asId<"part">(id),
    partKind: "tool",
    role: "step",
    version: 1,
  } as const;
}

function settledTool(
  id: string,
  toolClass: ToolClass,
  offset: number,
  result: { readonly text?: string; readonly patch?: PatchEntry } = {},
): ToolMessage {
  return {
    ...message(id, STARTED + offset),
    state: {
      call: asId<"call">(id),
      name: toolClass.kind,
      args: null,
      class: toolClass,
      phase: "settled",
      outcome: {
        kind: "ok",
        content: result.text === undefined ? [] : [{ kind: "text", text: result.text }],
        output: result.patch ?? null,
        parts: [],
      },
      changes: null,
    },
    status: { kind: "settled", commit: asId<"commit">(id), endedAt: STARTED + offset + 900 },
  };
}

const styles = create({
  turn: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.rowGap,
    minWidth: 0,
    paddingBlock: space.s3,
    paddingInline: space.s4,
  },
});
