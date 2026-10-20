import { props } from "@stylexjs/stylex";
import type { SessionView, UserContent } from "@nyte-ai/sdk";
import { memo, useCallback } from "react";
import type { ReactElement, ReactNode } from "react";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { preferences, useSetting } from "../preferences/index.ts";
import type { ToolCallDensity } from "../preferences/index.ts";
import { useWatchSelect } from "../sdk.tsx";
import type { WatchStore } from "../sdk.tsx";
import { Button } from "@nyte-ai/ui/button";
import { TranscriptSkeleton } from "../screens/transcript-skeleton.tsx";
import { LiveTurn, liveTurnStyles } from "./live-turn.tsx";
import { SubagentReportLine } from "./subagent-call.tsx";
import { TranscriptContent } from "./transcript.tsx";
import { StatusMarker } from "./row-surfaces.tsx";
import { ChangesCard, TurnItemView, UserMessageView } from "./turn-view.tsx";
import type { BranchModelChoice, BranchModelPicker } from "./turn-view.tsx";
import { estimateRowSize } from "./transcript-rows.ts";
import type { TranscriptProjector } from "./transcript-rows.ts";

type EditUserMessage = (
  message: UserMessage,
  content: UserContent,
  choice: BranchModelChoice,
) => Promise<void>;

interface RowContext {
  readonly store: WatchStore<SessionView>;
  readonly projector: TranscriptProjector;
  readonly working: boolean;
  readonly density: ToolCallDensity;
  readonly cwd: string | undefined;
  readonly branchModel: BranchModelPicker;
  readonly onEditUser: EditUserMessage;
  readonly onOpenChanges: (path: string | null) => void;
  readonly onRetry: () => void;
}

const TranscriptRowView = memo(function TranscriptRowView({
  rowKey,
  store,
  projector,
  working,
  density,
  cwd,
  branchModel,
  onEditUser,
  onOpenChanges,
  onRetry,
}: RowContext & { readonly rowKey: string }): ReactElement | null {
  const row = useWatchSelect(store, (state) => projector.row(state, rowKey));

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
    case "part":
    case "step":
    case "agents":
    case "response":
    case "failure":
      return (
        <TurnItemView
          row={row}
          running={row.kind === "step" && row.trailing && working}
          density={density}
          cwd={cwd}
          onEditUser={onEditUser}
          branchModel={branchModel}
        />
      );
    case "changes":
      return working ? null : <ChangesCard files={row.files} onOpenChanges={onOpenChanges} />;

    case "prompt": {
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
              row.message.source.kind === "action" ? row.message.source.label : row.message.content
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
        <LiveTurn working={working} settledWork={row.settledWork} density={density} cwd={cwd} />
      );
    default: {
      const _exhaustive: never = row;

      return _exhaustive;
    }
  }
});

export function Timeline({
  store,
  projector,
  ready,
  working,
  cwd,
  branchModel,
  onEditUser,
  onOpenChanges,
  onRetry,
}: Omit<RowContext, "density"> & { readonly ready: boolean }): ReactElement {
  const density = useSetting(preferences.toolCalls);
  const uiFontSize = useSetting(preferences.uiFontSize);
  const rows = useWatchSelect(store, projector.rows);

  const estimateSize = useCallback(
    (index: number) => {
      const state = store.getState();
      const key = projector.rows(state)[index]?.key;

      return estimateRowSize(
        key === undefined ? undefined : projector.row(state, key),
        density,
        uiFontSize,
      );
    },
    [density, projector, store, uiFontSize],
  );

  const renderRow = useCallback(
    (index: number): ReactNode => {
      const key = rows[index]?.key;

      return key === undefined ? null : (
        <TranscriptRowView
          rowKey={key}
          store={store}
          projector={projector}
          working={working}
          density={density}
          cwd={cwd}
          branchModel={branchModel}
          onEditUser={onEditUser}
          onOpenChanges={onOpenChanges}
          onRetry={onRetry}
        />
      );
    },
    [
      branchModel,
      cwd,
      density,
      onEditUser,
      onOpenChanges,
      onRetry,
      projector,
      rows,
      store,
      working,
    ],
  );

  return (
    <TranscriptContent
      rows={rows}
      ready={ready}
      estimateSize={estimateSize}
      renderRow={renderRow}
    />
  );
}
