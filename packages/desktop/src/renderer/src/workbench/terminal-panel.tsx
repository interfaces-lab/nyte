import type { JobInfo, SessionId } from "@nyte-ai/protocol";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { ReactElement } from "react";
import { errorMessage } from "../../../shared/errors";
import { Icon } from "../components/icons";
import { Button } from "../components/ui";
import { nyte } from "../nyte.ts";
import { keys } from "../queries.ts";
import { mountTerminal } from "./terminal-runtime";
import { isJobTerminal, terminalActions, useTerminals } from "./terminal-store";
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
        const exhaustive: never = tab.state.kind;
        return exhaustive;
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
      const exhaustive: never = tab.state;
      return exhaustive;
    }
  }
}

export function TerminalPanel({
  owner,
  sessionId,
  workspacePath,
  visible,
}: {
  readonly owner: string;
  readonly sessionId: SessionId | undefined;
  readonly workspacePath: string | null;
  readonly visible: boolean;
}): ReactElement {
  const { tabs, activeId } = useTerminals(owner);
  const observesJobs =
    sessionId !== undefined &&
    tabs.some((tab) => isJobTerminal(tab) && tab.source.sessionId === sessionId);
  const jobs = useQuery({
    queryKey: keys.jobs(sessionId),
    queryFn: async (): Promise<readonly JobInfo[]> => {
      const list = sessionId === undefined ? [] : await nyte.jobs.list({ sessionId });
      if (sessionId !== undefined) terminalActions.syncJobs(owner, sessionId, list);
      return list;
    },
    enabled: observesJobs,
    refetchInterval: observesJobs ? 2_000 : false,
  });
  const selected = tabs.find((tab) => tab.id === activeId);
  const [error, setError] = useState<string>();

  const restart = async (tab: TerminalTab): Promise<void> => {
    setError(undefined);
    try {
      await terminalActions.close(tab.id);
      await terminalActions.create(owner, workspacePath);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <section aria-label="Terminal" {...stylex.props(styles.root)}>
      {selected === undefined ? (
        <div {...stylex.props(styles.empty)}>
          <Icon name="console" size={24} />
          <span>
            Open a terminal in {workspacePath === null ? "your home folder" : "this workspace"}.
          </span>
          <Button
            variant="secondary"
            onClick={() => {
              void terminalActions.create(owner, workspacePath);
            }}
          >
            <Icon name="plus" size={14} />
            New Terminal
          </Button>
        </div>
      ) : (
        <div {...stylex.props(styles.body)}>
          {tabs.map((tab) => (
            <div key={tab.id} {...stylex.props(styles.panel, tab.id !== activeId && styles.hidden)}>
              <TerminalStatus
                tab={tab}
                restart={() => {
                  void restart(tab);
                }}
              />
              {(isJobTerminal(tab)
                ? tab.rendering.kind !== "failed"
                : tab.state.kind !== "failed") && (
                <TerminalCanvas id={tab.id} visible={visible && tab.id === activeId} />
              )}
            </div>
          ))}
        </div>
      )}
      {jobs.isError && selected !== undefined && isJobTerminal(selected) && (
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
