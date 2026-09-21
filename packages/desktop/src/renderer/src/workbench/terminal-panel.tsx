import type { JobInfo } from "@nyte-ai/protocol";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { errorMessage } from "../../../shared/errors";
import { Icon } from "../components/icons";
import { Button } from "../components/ui";
import { nyte } from "../nyte.ts";
import { keys } from "../queries.ts";
import type { WorkbenchTabId } from "./controller.ts";
import { mountTerminal } from "./terminal-runtime";
import { isJobTerminal, terminalActions, useTerminal } from "./terminal-store";
import type { TerminalTab } from "./terminal-store";
import { terminalStyles as styles } from "./terminal.stylex";

function TerminalCanvas({
  id,
  visible,
}: {
  readonly id: string;
  readonly visible: boolean;
}): ReactElement {
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null) return;
      return mountTerminal(id, element, visible);
    },
    [id, visible],
  );
  return <div ref={attach} {...stylex.props(styles.canvas)} />;
}

function TerminalStatus({
  tab,
  restart,
}: {
  readonly tab: TerminalTab;
  readonly restart: () => void;
}): ReactElement | null {
  if (isJobTerminal(tab)) {
    if (tab.rendering.kind === "failed") {
      return (
        <div role="alert" {...stylex.props(styles.state, styles.failure)}>
          <span>{tab.rendering.message}</span>
          <Button variant="secondary" onClick={() => terminalActions.retryRender(tab.id)}>
            Try Again
          </Button>
        </div>
      );
    }
    switch (tab.state.kind) {
      case "running":
        return <div {...stylex.props(styles.state)}>Agent command · read-only</div>;
      case "completed":
        return (
          <div role="status" {...stylex.props(styles.state)}>
            Command completed
          </div>
        );
      case "failed":
        return (
          <div role="status" {...stylex.props(styles.state, styles.failure)}>
            Command failed
          </div>
        );
      case "cancelled":
        return (
          <div role="status" {...stylex.props(styles.state)}>
            Command cancelled
          </div>
        );
      case "interrupted":
        return (
          <div role="status" {...stylex.props(styles.state)}>
            Command interrupted
          </div>
        );
      default: {
        const _exhaustive: never = tab.state.kind;
        return _exhaustive;
      }
    }
  }
  switch (tab.state.kind) {
    case "starting":
      return (
        <div role="status" {...stylex.props(styles.state)}>
          Starting terminal…
        </div>
      );
    case "running":
      return null;
    case "failed":
      return (
        <div role="alert" {...stylex.props(styles.state, styles.failure)}>
          <span>{tab.state.message}</span>
          <Button variant="secondary" onClick={restart}>
            Try Again
          </Button>
        </div>
      );
    case "exited":
      return (
        <div role="status" {...stylex.props(styles.state)}>
          <span>
            {tab.state.exitCode === 0
              ? "Shell exited"
              : "Shell exited with code " + String(tab.state.exitCode)}
          </span>
          <Button variant="secondary" onClick={restart}>
            Restart
          </Button>
        </div>
      );
    default: {
      const _exhaustive: never = tab.state;
      return _exhaustive;
    }
  }
}

export function TerminalPanel({
  tabId,
  workspacePath,
  visible,
}: {
  readonly tabId: WorkbenchTabId;
  readonly workspacePath: string | null;
  readonly visible: boolean;
}): ReactElement {
  const tab = useTerminal(tabId);
  const jobSessionId = tab !== undefined && isJobTerminal(tab) ? tab.source.sessionId : null;
  const jobRunning = tab !== undefined && isJobTerminal(tab) && tab.state.kind === "running";
  const jobs = useQuery({
    queryKey: keys.jobs(jobSessionId ?? undefined),
    queryFn: (): Promise<readonly JobInfo[]> =>
      jobSessionId === null ? Promise.resolve([]) : nyte.jobs.list({ sessionId: jobSessionId }),
    enabled: jobSessionId !== null,
    refetchInterval: jobRunning ? 2_000 : false,
  });
  // The conversation reads the same key; the store follows the settled data
  // no matter whose reader ran.
  useEffect(() => {
    if (jobSessionId === null || jobs.data === undefined) return;
    terminalActions.syncJobs(jobSessionId, jobs.data);
  }, [jobSessionId, jobs.data]);
  const [error, setError] = useState<string>();

  const restart = async (current: TerminalTab): Promise<void> => {
    setError(undefined);
    try {
      await terminalActions.close(current.id);
      await terminalActions.create({ id: current.id, workspacePath });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <section aria-label="Terminal" {...stylex.props(styles.root)}>
      {tab === undefined ? (
        <div {...stylex.props(styles.empty)}>
          <Icon name="console" size={24} />
          <span>Terminal unavailable.</span>
        </div>
      ) : (
        <div {...stylex.props(styles.body)}>
          <div {...stylex.props(styles.panel)}>
            <TerminalStatus
              tab={tab}
              restart={() => {
                void restart(tab);
              }}
            />
            {(isJobTerminal(tab)
              ? tab.rendering.kind !== "failed"
              : tab.state.kind !== "failed") && <TerminalCanvas id={tab.id} visible={visible} />}
          </div>
        </div>
      )}
      {jobs.isError && tab !== undefined && isJobTerminal(tab) && (
        <div role="alert" {...stylex.props(styles.state, styles.failure)}>
          <span>Couldn’t refresh command output. Showing the last received output.</span>
          <Button variant="secondary" onClick={() => void jobs.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {error !== undefined && (
        <div role="alert" {...stylex.props(styles.state, styles.failure)}>
          {error}
        </div>
      )}
    </section>
  );
}
