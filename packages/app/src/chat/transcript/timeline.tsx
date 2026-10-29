import { props } from "@stylexjs/stylex";
import type { SessionId, SessionView, UserContent } from "@nyte-ai/sdk";
import { useState } from "react";
// oxlint-disable-next-line no-restricted-imports -- TranscriptContent's uncompiled virtualizer calls renderRow on every scroll update, so each row needs its own memo boundary
import { memo } from "react";
import type { ReactElement, ReactNode } from "react";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { preferences, useSetting } from "../../preferences/index.ts";
import type { ToolCallDensity } from "../../preferences/index.ts";
import { useWatchSelect } from "../../data/watch-store.ts";
import type { WatchStore } from "../../data/watch-store.ts";
import { Button } from "@nyte-ai/ui/button";
import { TranscriptSkeleton } from "./transcript-skeleton.tsx";
import { LiveTurn, liveTurnStyles } from "./live-turn.tsx";
import { SubagentReportLine } from "../tools/subagent-call.tsx";
import { TranscriptContent, useTranscriptControls, useTranscriptScope } from "./transcript.tsx";
import { StatusMarker } from "./row-surfaces.tsx";
import { ChangesFooter, TurnItemView } from "./turn-view.tsx";
import type { BranchModelChoice, BranchModelPicker } from "./turn-view.tsx";
import { dividerKey, estimateRowSize, withDivider } from "./transcript-rows.ts";
import type { TranscriptProjector } from "./transcript-rows.ts";
import { nextVisit, openVisit, readUnread } from "./transcript-unread.ts";
import type { UnreadEvent, UnreadVisit } from "./transcript-unread.ts";
import { NewMessages, UnreadDivider } from "./transcript-unread-view.tsx";
import { countWork, useCommitCount } from "../../lib/work-counts.ts";
import { useChatWindow } from "../../window/index.ts";

type EditUserMessage = (
  message: UserMessage,
  content: UserContent,
  choice: BranchModelChoice,
) => Promise<void>;

interface RowContext {
  readonly store: WatchStore<SessionView>;
  readonly projector: TranscriptProjector;
  readonly navigating: boolean;
  readonly density: ToolCallDensity;
  readonly cwd: string | undefined;
  readonly branchModel: BranchModelPicker;
  readonly onEditUser: EditUserMessage;
  readonly onRetry: () => void;
}

function EarlierSteps(): ReactElement {
  const loadEarlier = useTranscriptScope()?.loadEarlier;
  const [showing, setShowing] = useState(false);

  return (
    <StatusMarker>
      <Button
        variant="text"
        disabled={loadEarlier === undefined || showing}
        onClick={() => {
          if (loadEarlier === undefined) return;
          setShowing(true);
          void loadEarlier().finally(() => setShowing(false));
        }}
      >
        Show Earlier Steps
      </Button>
    </StatusMarker>
  );
}

const TranscriptRowView = memo(function TranscriptRowView({
  rowKey,
  store,
  projector,
  navigating,
  density,
  cwd,
  branchModel,
  onEditUser,
  onRetry,
}: RowContext & { readonly rowKey: string }): ReactElement | null {
  useCommitCount("render:transcript-row");

  const row = useWatchSelect(store, (state) => {
    countWork("select:row");

    return projector.row(state, rowKey);
  });

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
          running={row.kind === "step" && row.running}
          density={density}
          cwd={cwd}
          onEditUser={onEditUser}
          branchModel={branchModel}
        />
      );
    case "earlier":
      return <EarlierSteps />;
    case "changes":
      return <ChangesFooter state={navigating ? "pending" : row.state} files={row.files} />;

    case "prompt": {
      const { source } = row.message;

      if (source.kind === "child" || source.kind === "job")
        return (
          <div {...props(liveTurnStyles.root)}>
            <SubagentReportLine source={source} content={row.message.content} held={row.held} />
          </div>
        );

      return <TurnItemView row={row} running={false} density={density} cwd={cwd} />;
    }

    case "retry":
      return (
        <StatusMarker role="status" variant="retrying" title={row.message}>
          Retrying…
        </StatusMarker>
      );
    case "live":
      return <LiveTurn working={row.working || navigating} />;
    default: {
      const _exhaustive: never = row;

      return _exhaustive;
    }
  }
});

/** A chat's transcript. Its unread visit lasts while the window shows the chat: none opens off screen, and leaving ends it. */
export function Timeline({
  sessionId,
  store,
  projector,
  ready,
  navigating,
  cwd,
  branchModel,
  onEditUser,
  onRetry,
}: Omit<RowContext, "density"> & {
  readonly sessionId: SessionId;
  readonly ready: boolean;
}): ReactElement {
  const density = useSetting(preferences.toolCalls);
  const uiFontSize = useSetting(preferences.uiFontSize);
  const controls = useTranscriptControls();
  const projected = useWatchSelect(store, projector.rows);
  const replies = useWatchSelect(store, projector.replies);
  const seenThrough = useWatchSelect(store, (state) => state.value?.seenThrough);
  const [visit, setVisit] = useState<UnreadVisit>();
  const shown = useChatWindow((snapshot) => snapshot.shown.has(sessionId));
  const looking = useChatWindow((snapshot) => snapshot.looking.has(sessionId));

  const opened = !shown
    ? undefined
    : (visit ?? (seenThrough === undefined ? undefined : openVisit(seenThrough)));

  const observed =
    opened === undefined
      ? undefined
      : nextVisit(opened, { kind: "observed", active: looking }, replies);

  if (observed !== visit) setVisit(observed);
  const unread = observed === undefined ? undefined : readUnread(observed, replies);
  const divider = unread?.divider;
  const rows = withDivider(projected, divider);

  const update = (event: UnreadEvent): void =>
    setVisit((current) => current && nextVisit(current, event, replies));

  const estimateSize = (index: number): number => {
    const row = rows[index];

    if (row === undefined) return 0;

    return estimateRowSize(
      "kind" in row ? row : projector.row(store.getState(), row.key),
      density,
      uiFontSize,
    );
  };

  const renderRow = (index: number): ReactNode => {
    const row = rows[index];

    if (row !== undefined && "kind" in row) return <UnreadDivider />;
    const key = row?.key;

    return key === undefined ? null : (
      <TranscriptRowView
        rowKey={key}
        store={store}
        projector={projector}
        navigating={navigating}
        density={density}
        cwd={cwd}
        branchModel={branchModel}
        onEditUser={onEditUser}
        onRetry={onRetry}
      />
    );
  };

  return (
    <TranscriptContent
      rows={rows}
      ready={ready}
      estimateSize={estimateSize}
      renderRow={renderRow}
      marker={divider === undefined ? undefined : dividerKey(divider)}
      onPlace={(place) => update({ kind: "placed", place })}
      overlay={
        <NewMessages
          pill={unread?.pill ?? null}
          onOpen={(direction) => {
            if (direction === "down") {
              controls.end();

              return;
            }

            update({ kind: "revealed" });

            if (divider !== undefined) controls.reveal(dividerKey(divider));
          }}
          onDismiss={(direction) => update({ kind: "dismissed", direction })}
        />
      }
    />
  );
}
