import type { ReactElement } from "react";
import { props } from "@stylexjs/stylex";
import { LiveTurn, liveTurnStyles } from "@nyte-ai/app/conversation/live-turn.tsx";
import { StatusMarker } from "@nyte-ai/app/conversation/row-surfaces.tsx";
import { SubagentReportLine } from "@nyte-ai/app/conversation/subagent-call.tsx";
import { SubagentSessionsProvider } from "@nyte-ai/app/conversation/subagent-sessions.ts";
import type { TranscriptRow } from "@nyte-ai/app/conversation/transcript-rows.ts";
import { TurnItemView, UserMessageView } from "@nyte-ai/app/conversation/turn-view.tsx";
import type { BranchModelPicker } from "@nyte-ai/app/conversation/turn-view.tsx";
import type { ToolCallDensity } from "@nyte-ai/app/preferences/index.ts";
import { labModel, modelCatalog } from "../../../src/shell/fixtures";
import { CWD, SUBAGENTS } from "../../../src/messages/build";
import type { Staged } from "./staging";

export const branchModel: BranchModelPicker = { catalog: modelCatalog, model: labModel, thinkingLevel: "high", fast: false };
const subagents = { children: SUBAGENTS, open: () => {} };

/** One transcript row, drawn the way the app's Timeline draws it. */
export function Row({ row, stage, density = "balanced" }: { readonly row: TranscriptRow; readonly stage: Staged; readonly density?: ToolCallDensity }): ReactElement | null {
  switch (row.kind) {
    case "part":
    case "step":
    case "agents":
    case "response":
    case "failure":
    case "changes":
      return (
        <TurnItemView
          row={row}
          running={(row.kind === "step" || row.kind === "changes") && row.trailing && stage.working}
          density={density}
          cwd={CWD}
          onEditUser={async () => {}}
          branchModel={branchModel}
          onOpenChanges={() => {}}
        />
      );
    case "landing": {
      const { source } = row.message;
      if (source.kind === "child" || source.kind === "job")
        return (
          <div {...props(liveTurnStyles.root)}>
            <SubagentReportLine source={source} content={row.message.content} held={row.held} />
          </div>
        );
      return (
        <div {...props(liveTurnStyles.root, row.pending && liveTurnStyles.pending)}>
          <UserMessageView content={source.kind === "action" ? source.label : row.message.content} />
        </div>
      );
    }
    case "retry":
      return (
        <StatusMarker role="status" variant="retrying" title={row.message}>
          Retrying…
        </StatusMarker>
      );
    case "live":
      return <LiveTurn working={stage.working} settledWork={stage.settledWork} density={density} cwd={CWD} />;
    default:
      return null;
  }
}

/** A real transcript: the app's own rows for a staged scene. */
export function Transcript({ stage, density = "balanced" }: { readonly stage: Staged; readonly density?: ToolCallDensity }) {
  return (
    <SubagentSessionsProvider value={subagents}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {stage.rows.map((row) => (
          <Row key={row.messageId} row={row} stage={stage} density={density} />
        ))}
      </div>
    </SubagentSessionsProvider>
  );
}
