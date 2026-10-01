import type { JobInfo } from "@nyte-ai/protocol";
import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
// oxlint-disable-next-line no-restricted-imports -- job query results sync into the terminal store
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { errorMessage } from "../errors";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { nyte } from "../nyte.ts";
import { keys } from "../queries.ts";
import type { WorkbenchTabId } from "./controller.ts";
import { mountTerminal } from "./terminal-runtime";
import { isJobTerminal, terminalActions, useTerminal } from "./terminal-store";
import type { TerminalTab } from "./terminal-store";
import { terminalStyles } from "./terminal.stylex";

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

  return <div ref={attach} {...props(terminalStyles.canvas)} />;
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
        <div role="alert" {...props(intent.danger, terminalStyles.state, terminalStyles.failure)}>
          <span>{tab.rendering.message}</span>
          <Button variant="outline" onClick={() => terminalActions.retryRender(tab.id)}>
            Try Again
          </Button>
        </div>
      );
    }

    switch (tab.state.kind) {
      case "running":
        return <div {...props(terminalStyles.state)}>Agent command · read-only</div>;
      case "completed":
        return (
          <div role="status" {...props(terminalStyles.state)}>
            Command completed
          </div>
        );
      case "failed":
        return (
          <div
            role="status"
            {...props(intent.danger, terminalStyles.state, terminalStyles.failure)}
          >
            Command failed
          </div>
        );
      case "cancelled":
        return (
          <div role="status" {...props(terminalStyles.state)}>
            Command cancelled
          </div>
        );
      case "interrupted":
        return (
          <div role="status" {...props(terminalStyles.state)}>
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
        <div role="status" {...props(terminalStyles.state)}>
          Starting terminal…
        </div>
      );
    case "running":
      return null;
    case "failed":
      return (
        <div role="alert" {...props(intent.danger, terminalStyles.state, terminalStyles.failure)}>
          <span>{tab.state.message}</span>
          <Button variant="outline" onClick={restart}>
            Try Again
          </Button>
        </div>
      );
    case "exited":
      return (
        <div role="status" {...props(terminalStyles.state)}>
          <span>
            {tab.state.exitCode === 0
              ? "Shell exited"
              : "Shell exited with code " + String(tab.state.exitCode)}
          </span>
          <Button variant="outline" onClick={restart}>
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
    <section aria-label="Terminal" {...props(terminalStyles.root)}>
      {tab === undefined ? (
        <div {...props(terminalStyles.empty)}>
          <Icon name="console" size={24} />
          <span>Terminal unavailable.</span>
        </div>
      ) : (
        <div {...props(terminalStyles.body)}>
          <div {...props(terminalStyles.panel)}>
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
        <div role="alert" {...props(intent.danger, terminalStyles.state, terminalStyles.failure)}>
          <span>Couldn’t refresh command output. Showing the last received output.</span>
          <Button variant="outline" onClick={() => void jobs.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {error !== undefined && (
        <div role="alert" {...props(intent.danger, terminalStyles.state, terminalStyles.failure)}>
          {error}
        </div>
      )}
    </section>
  );
}
