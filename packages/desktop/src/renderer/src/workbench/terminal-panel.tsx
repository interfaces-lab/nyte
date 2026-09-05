import * as stylex from "@stylexjs/stylex";
import { useCallback, useState } from "react";
import type { ReactElement } from "react";
import { errorMessage } from "../../../shared/errors";
import { Icon } from "../components/icons";
import { Button } from "../components/ui";
import { mountTerminal } from "./terminal-runtime";
import { terminalActions, useTerminals } from "./terminal-store";
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
  workspacePath,
  visible,
}: {
  readonly owner: string;
  readonly workspacePath: string | null;
  readonly visible: boolean;
}): ReactElement {
  const { tabs, activeId } = useTerminals(owner);
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
              {tab.state.kind !== "failed" && (
                <TerminalCanvas id={tab.id} visible={visible && tab.id === activeId} />
              )}
            </div>
          ))}
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
