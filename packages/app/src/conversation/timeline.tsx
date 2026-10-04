import { props } from "@stylexjs/stylex";
import type { SessionId, UserTurnPart } from "@nyte-ai/protocol";
import { memo, useCallback } from "react";
import type { ReactElement, ReactNode } from "react";
import { useSessionLive } from "../live.ts";
import type { LiveToolProgress } from "../live-fold.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { Button } from "@nyte-ai/ui/button";
import { TranscriptSkeleton } from "../screens/transcript-skeleton.tsx";
import { LiveTurn, liveTurnStyles } from "./live-turn.tsx";
import { TranscriptContent } from "./transcript.tsx";
import { StatusMarker } from "./row-surfaces.tsx";
import { TurnView, UserMessageView } from "./turn-view.tsx";
import type { BranchModelChoice, BranchModelPicker, TurnChangesTarget } from "./turn-view.tsx";
import { estimateRowSize } from "./transcript-rows.ts";
import type { RenderedTurn, TranscriptRow } from "./transcript-rows.ts";

const NO_LIVE_TOOLS: ReadonlyMap<string, LiveToolProgress> = new Map();

type EditUserMessage = (
  part: UserTurnPart,
  content: UserTurnPart["content"],
  choice: BranchModelChoice,
) => Promise<void>;

const SettledTurnView = memo(function SettledTurnView({
  turn,
  cwd,
  onEditUser,
  branchModel,
  onOpenChanges,
}: {
  turn: RenderedTurn;
  cwd: string | undefined;
  onEditUser: EditUserMessage;
  branchModel: BranchModelPicker;
  onOpenChanges: (target: TurnChangesTarget) => void;
}): ReactElement | null {
  return (
    <TurnView
      turn={turn}
      liveTools={NO_LIVE_TOOLS}
      cwd={cwd}
      onEditUser={onEditUser}
      branchModel={branchModel}
      onOpenChanges={onOpenChanges}
      running={false}
    />
  );
});

const TrailingTurnView = memo(function TrailingTurnView({
  sessionId,
  turn,
  cwd,
  onEditUser,
  branchModel,
  onOpenChanges,
}: {
  sessionId: SessionId;
  turn: RenderedTurn;
  cwd: string | undefined;
  onEditUser: EditUserMessage;
  branchModel: BranchModelPicker;
  onOpenChanges: (target: TurnChangesTarget) => void;
}): ReactElement | null {
  const live = useSessionLive(sessionId);

  return (
    <TurnView
      turn={turn}
      liveTools={live.tools}
      live={live}
      cwd={cwd}
      onEditUser={onEditUser}
      branchModel={branchModel}
      onOpenChanges={onOpenChanges}
      running={true}
    />
  );
});

const SessionLiveTurn = memo(function SessionLiveTurn({
  sessionId,
  working,
  settledWork,
  cwd,
}: {
  sessionId: SessionId;
  working: boolean;
  settledWork: boolean;
  cwd: string | undefined;
}): ReactElement | null {
  const live = useSessionLive(sessionId);

  return <LiveTurn live={live} working={working} settledWork={settledWork} cwd={cwd} />;
});

/** The session's rows mapped onto the scroller's items and the row surfaces. */
export function Timeline({
  sessionId,
  ready,
  rows,
  working,
  settledWork,
  cwd,
  branchModel,
  onEditUser,
  onOpenChanges,
  onRetry,
}: {
  readonly sessionId: SessionId;
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
  const density = useAppearanceSettings().toolCalls;

  const estimateSize = useCallback(
    (index: number) => estimateRowSize(rows[index], density),
    [density, rows],
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
        case "turn": {
          if (row.trailing && working) {
            return (
              <TrailingTurnView
                sessionId={sessionId}
                turn={row.turn}
                cwd={cwd}
                onEditUser={onEditUser}
                branchModel={branchModel}
                onOpenChanges={onOpenChanges}
              />
            );
          }

          return (
            <SettledTurnView
              turn={row.turn}
              cwd={cwd}
              onEditUser={onEditUser}
              branchModel={branchModel}
              onOpenChanges={onOpenChanges}
            />
          );
        }

        case "landing":
          return (
            <div
              title={row.pending ? "Lands at the next response" : undefined}
              {...props(liveTurnStyles.root, row.pending && liveTurnStyles.pending)}
            >
              <UserMessageView content={row.content} />
            </div>
          );
        case "retry":
          return (
            <StatusMarker role="status" variant="retrying" title={row.message}>
              Retrying…
            </StatusMarker>
          );
        case "live":
          return (
            <SessionLiveTurn
              sessionId={sessionId}
              working={working}
              settledWork={settledWork}
              cwd={cwd}
            />
          );
        default: {
          const _exhaustive: never = row;

          return _exhaustive;
        }
      }
    },
    [branchModel, cwd, onEditUser, onOpenChanges, onRetry, rows, sessionId, settledWork, working],
  );

  return (
    <TranscriptContent
      items={rows}
      ready={ready}
      density={density}
      estimateSize={estimateSize}
      renderItem={renderItem}
    />
  );
}
