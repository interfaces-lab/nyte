import { props } from "@stylexjs/stylex";
import type { SessionId, UserContent } from "@nyte-ai/sdk";
import type { ChatView } from "../../data/chat-store.ts";
import { useState } from "react";
// oxlint-disable-next-line no-restricted-imports -- TranscriptContent's uncompiled virtualizer calls renderRow on every scroll update, so each row needs its own memo boundary
import { memo } from "react";
import type { ReactElement, ReactNode } from "react";
import { showsAnswer } from "@nyte-ai/plugin/client/presentation";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { preferences, useSetting } from "../../preferences/index.ts";
import type { ToolCallDensity } from "../../preferences/index.ts";
import { useWatchSelect } from "../../data/watch-store.ts";
import type { WatchStore } from "../../data/watch-store.ts";
import { Button } from "@nyte-ai/ui/button";
import { Loader } from "@nyte-ai/ui/loader";
import { MarkerContent, MarkerIcon } from "@nyte-ai/ui/marker";
import { TranscriptSkeleton } from "./transcript-skeleton.tsx";
import { LiveTurn, liveTurnStyles } from "./live-turn.tsx";
import { SubagentReportLine } from "../tools/subagent-call.tsx";
import { AnswerLine } from "./answer-line.tsx";
import { TranscriptContent, useTranscriptScope } from "./transcript.tsx";
import { StatusMarker } from "./row-surfaces.tsx";
import { ChangesFooter, TurnItemView } from "./turn-view.tsx";
import type { BranchModelChoice, BranchModelPicker } from "./turn-view.tsx";
import { estimateRowSize, withDivider } from "./transcript-rows.ts";
import type { TranscriptProjector } from "./transcript-rows.ts";
import { firstUnread, observeVisit, openVisit } from "./transcript-unread.ts";
import type { UnreadVisit } from "./transcript-unread.ts";
import { UnreadDivider } from "./transcript-unread-view.tsx";
import { countWork, useCommitCount } from "../../lib/work-counts.ts";
import { useChatWindow } from "../../window/index.ts";

type EditUserMessage = (
  message: UserMessage,
  content: UserContent,
  choice: BranchModelChoice,
) => Promise<void>;

interface RowContext {
  readonly store: WatchStore<ChatView>;
  readonly projector: TranscriptProjector;
  readonly navigating: boolean;
  readonly density: ToolCallDensity;
  readonly cwd: string | undefined;
  readonly branchModel: BranchModelPicker;
  readonly onEditUser: EditUserMessage;
  readonly onRetry: () => void;
}

/**
 * Pages the steps above in by itself once the reader can see this row, so the button shows only
 * for a page that failed or brought nothing. A page also comes back empty when the view moved while
 * it loaded, so an empty page is tried once more first. The button brings the spinner back, and
 * the spinner pages under the same rule.
 */
function EarlierSteps(): ReactElement {
  const loadEarlier = useTranscriptScope()?.loadEarlier;
  const [stuck, setStuck] = useState(loadEarlier === undefined);

  const watch = (marker: HTMLSpanElement): (() => void) => {
    let empty = 0;

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.unobserve(marker);
      void (loadEarlier?.() ?? Promise.resolve(0)).then(
        (loaded) => {
          empty = loaded === 0 ? empty + 1 : 0;

          if (loaded > 0 || (loaded === 0 && empty < 2)) observer.observe(marker);
          else setStuck(true);
        },
        () => setStuck(true),
      );
    });

    observer.observe(marker);

    return () => observer.disconnect();
  };

  return (
    <StatusMarker role="status">
      {stuck ? (
        <Button variant="text" disabled={loadEarlier === undefined} onClick={() => setStuck(false)}>
          Show Earlier Steps
        </Button>
      ) : (
        <>
          <MarkerIcon>
            <Loader />
          </MarkerIcon>
          <MarkerContent ref={watch}>Loading Earlier Steps</MarkerContent>
        </>
      )}
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

      if (showsAnswer(row.message))
        return (
          <div {...props(liveTurnStyles.root)}>
            <AnswerLine message={row.message} held={row.held} />
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
      return <LiveTurn state={navigating && row.state === "idle" ? "planning" : row.state} />;
    default: {
      const _exhaustive: never = row;

      return _exhaustive;
    }
  }
});

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
  const projected = useWatchSelect(store, projector.rows);
  const replies = useWatchSelect(store, projector.replies);
  const seenThrough = useWatchSelect(store, (state) => state.value?.seenThrough);
  const [visit, setVisit] = useState<UnreadVisit>();
  const shown = useChatWindow((snapshot) => snapshot.shown.has(sessionId));
  const looking = useChatWindow((snapshot) => snapshot.looking.has(sessionId));

  const opened = !shown
    ? undefined
    : (visit ?? (seenThrough === undefined ? undefined : openVisit(seenThrough)));

  const observed = opened === undefined ? undefined : observeVisit(opened, looking, replies);

  if (observed !== visit) setVisit(observed);
  const divider = observed === undefined ? undefined : firstUnread(observed, replies);
  const rows = withDivider(projected, divider);

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
    />
  );
}
