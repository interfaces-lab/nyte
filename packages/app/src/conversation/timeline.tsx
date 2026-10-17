import { props } from "@stylexjs/stylex";
import type { SessionId, SessionView, UserContent } from "@nyte-ai/sdk";
import { useCallback } from "react";
import type { ReactElement, ReactNode } from "react";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { preferences, useSetting } from "../preferences/index.ts";
import { Button } from "@nyte-ai/ui/button";
import { TranscriptSkeleton } from "../screens/transcript-skeleton.tsx";
import { LiveTurn, liveTurnStyles } from "./live-turn.tsx";
import { SubagentReportLine } from "./subagent-call.tsx";
import { TranscriptContent } from "./transcript.tsx";
import { StatusMarker } from "./row-surfaces.tsx";
import { TurnView, UserMessageView } from "./turn-view.tsx";
import type { BranchModelChoice, BranchModelPicker, TurnChangesTarget } from "./turn-view.tsx";
import { estimateRowSize } from "./transcript-rows.ts";
import type { TranscriptRow } from "./transcript-rows.ts";

type EditUserMessage = (
  message: UserMessage,
  content: UserContent,
  choice: BranchModelChoice,
) => Promise<void>;

/** The session's rows mapped onto the scroller's items and the row surfaces. */
export function Timeline({
  ready,
  rows,
  working,
  settledWork,
  cwd,
  changes,
  branchModel,
  onEditUser,
  onOpenChanges,
  onRetry,
}: {
  readonly sessionId: SessionId;
  readonly changes: SessionView["changes"];
  readonly ready: boolean;
  readonly rows: readonly TranscriptRow[];
  readonly working: boolean;
  readonly settledWork: boolean;
  readonly cwd: string | undefined;
  readonly branchModel: BranchModelPicker;
  readonly onEditUser: EditUserMessage;
  readonly onOpenChanges: (target: TurnChangesTarget) => void;
  readonly onRetry: () => void;
}): ReactElement {
  const density = useSetting(preferences.toolCalls);
  const uiFontSize = useSetting(preferences.uiFontSize);

  const estimateSize = useCallback(
    (index: number) => estimateRowSize(rows[index], density, uiFontSize),
    [density, rows, uiFontSize],
  );

  const renderItem = useCallback(
    (index: number): ReactNode => {
      const row = rows[index];

      if (row === undefined) return null;

      switch (row.kind) {
        case "skeleton":
          return <TranscriptSkeleton />;
        case "error":
          return (
            <StatusMarker role="alert" variant="destructive">
              Couldn&rsquo;t load this chat.{" "}
              <Button variant="text" onClick={() => onRetry()}>
                Try Again
              </Button>
            </StatusMarker>
          );
        case "turn":
          return (
            <TurnView
              turn={row.turn}
              continuations={row.continuations}
              density={density}
              cwd={cwd}
              changes={changes}
              onEditUser={onEditUser}
              branchModel={branchModel}
              onOpenChanges={onOpenChanges}
              running={row.trailing && working}
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
            <div
              title={row.pending ? "Lands at the next response" : undefined}
              {...props(liveTurnStyles.root, row.pending && liveTurnStyles.pending)}
            >
              <UserMessageView
                content={
                  row.message.source.kind === "action"
                    ? row.message.source.label
                    : row.message.content
                }
              />
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
          return (
            <LiveTurn working={working} settledWork={settledWork} density={density} cwd={cwd} />
          );
        default: {
          const _exhaustive: never = row;

          return _exhaustive;
        }
      }
    },
    [
      branchModel,
      changes,
      cwd,
      density,
      onEditUser,
      onOpenChanges,
      onRetry,
      rows,
      settledWork,
      working,
    ],
  );

  return (
    <TranscriptContent
      items={rows}
      ready={ready}
      estimateSize={estimateSize}
      renderItem={renderItem}
    />
  );
}
