import { intent } from "@nyte-ai/ui/surface-theme";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
// oxlint-disable-next-line no-restricted-imports -- job query results sync into the terminal store
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { ADD_TO_CHAT_LABEL } from "../conversation/add-to-chat.ts";
import { errorMessage } from "../errors";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { useSession, useWorkspaceJobs } from "../queries.ts";
import { connection } from "../sdk.tsx";
import { useMountEffect } from "../use-mount-effect.ts";
import type { WorkbenchTabId } from "./controller.ts";
import { nyte } from "../nyte.ts";
import {
  addTerminalToChat,
  mountTerminal,
  subscribeTerminalSelection,
  terminalHasSelection,
} from "./terminal-runtime";
import { getTerminal, terminalActions, useTerminal } from "./terminal-store";
import type { TerminalTab } from "./terminal-store";
import { terminalStyles } from "./terminal.stylex";

const startingStyles = create({
  overlay: {
    position: "absolute",
    insetBlockStart: 0,
    insetInline: 0,
    zIndex: 1,
    backgroundColor: role.bgBase,
  },
});

const chatStyles = create({
  action: {
    position: "absolute",
    insetBlockStart: space.s2,
    insetInlineEnd: space.s3,
    zIndex: 1,
  },
});

function AddSelectionToChat({ id }: { readonly id: string }): ReactElement | null {
  const subscribe = useCallback(
    (listener: () => void) => subscribeTerminalSelection(id, listener),
    [id],
  );

  const selected = useSyncExternalStore(subscribe, () => terminalHasSelection(id));

  if (!selected) return null;

  return (
    <span {...props(chatStyles.action)}>
      <Button
        variant="outline"
        size="sm"
        icon="paperclip"
        aria-keyshortcuts={nyte.platform === "darwin" ? "Meta+Shift+L" : "Control+Shift+L"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => addTerminalToChat(id)}
      >
        {ADD_TO_CHAT_LABEL}
      </Button>
    </span>
  );
}

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
  stop,
  stopping,
}: {
  readonly tab: TerminalTab;
  readonly restart: () => void;
  readonly stop: () => void;
  readonly stopping: boolean;
}): ReactElement | null {
  if (tab.kind === "job") {
    if (tab.rendering.kind === "failed") {
      return (
        <div
          role="alert"
          {...props(text.sm, intent.danger, terminalStyles.state, terminalStyles.failure)}
        >
          <span>{tab.rendering.message}</span>
          <Button variant="outline" onClick={() => terminalActions.retryRender(tab.id)}>
            Try Again
          </Button>
        </div>
      );
    }

    switch (tab.state.kind) {
      case "running":
        return (
          <div {...props(text.sm, terminalStyles.state)}>
            <span>Agent command · read-only</span>
            <Button variant="outline" loading={stopping} onClick={stop}>
              Stop Command
            </Button>
          </div>
        );
      case "exited":
        return tab.state.reason === "terminated" ? (
          <div role="status" {...props(text.sm, terminalStyles.state)}>
            Command cancelled
          </div>
        ) : tab.state.code === 0 ? (
          <div role="status" {...props(text.sm, terminalStyles.state)}>
            Command completed
          </div>
        ) : (
          <div
            role="status"
            {...props(text.sm, intent.danger, terminalStyles.state, terminalStyles.failure)}
          >
            Command failed
          </div>
        );
      case "lost":
        return (
          <div role="status" {...props(text.sm, terminalStyles.state)}>
            Command interrupted
          </div>
        );
      default: {
        const _exhaustive: never = tab.state;

        return _exhaustive;
      }
    }
  }

  switch (tab.state.kind) {
    case "starting":
      return (
        <div role="status" {...props(text.sm, terminalStyles.state, startingStyles.overlay)}>
          Starting terminal…
        </div>
      );
    case "running":
      return null;
    case "failed":
      return (
        <div
          role="alert"
          {...props(text.sm, intent.danger, terminalStyles.state, terminalStyles.failure)}
        >
          <span>{tab.state.message}</span>
          <Button variant="outline" onClick={restart}>
            Try Again
          </Button>
        </div>
      );
    case "exited":
      return (
        <div role="status" {...props(text.sm, terminalStyles.state)}>
          <span>
            {tab.state.exitCode === 0 || tab.state.exitCode === null
              ? "Shell exited"
              : "Shell exited with code " + String(tab.state.exitCode)}
          </span>
          <Button variant="outline" onClick={restart}>
            Restart Terminal
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

  useMountEffect(() => {
    if (getTerminal(tabId) === undefined)
      void terminalActions.restore({ id: tabId, workspacePath });
  });

  const jobSessionId = tab !== undefined && tab.kind === "job" ? tab.sessionId : undefined;
  const workspace = useSession(jobSessionId).data?.workspace;
  const jobs = useWorkspaceJobs(jobSessionId === undefined ? undefined : workspace);

  const cancellation = useMutation({
    mutationFn: (current: TerminalTab) => {
      if (current.kind !== "job" || workspace === undefined)
        throw new Error("Only agent commands can be stopped here");

      return connection().workspace(workspace).job(current.jobId).stop();
    },
  });

  useEffect(() => {
    if (jobSessionId === undefined || jobs === undefined) return;
    terminalActions.syncJobs(
      jobSessionId,
      jobs.filter((job) => job.session === jobSessionId),
    );
  }, [jobSessionId, jobs]);
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
        <div {...props(text.base, terminalStyles.empty)}>
          <Icon name="console" size={24} />
          <span>Terminal unavailable.</span>
        </div>
      ) : (
        <div {...props(terminalStyles.body)}>
          <div {...props(terminalStyles.panel)}>
            <TerminalStatus
              tab={tab}
              stopping={cancellation.isPending}
              stop={() => cancellation.mutate(tab)}
              restart={() => {
                void restart(tab);
              }}
            />
            {(tab.kind === "job"
              ? tab.rendering.kind !== "failed"
              : tab.state.kind !== "failed") && <TerminalCanvas id={tab.id} visible={visible} />}
            <AddSelectionToChat id={tab.id} />
          </div>
        </div>
      )}
      {cancellation.isSuccess && (
        <div role="status" {...props(text.sm, terminalStyles.state)}>
          {cancellation.data.kind === "requested"
            ? "Cancellation requested."
            : cancellation.data.kind === "settled"
              ? "This command has already finished."
              : "This command is no longer available."}
        </div>
      )}
      {cancellation.isError && (
        <div
          role="alert"
          {...props(text.sm, intent.danger, terminalStyles.state, terminalStyles.failure)}
        >
          {errorMessage(cancellation.error)}
        </div>
      )}
      {error !== undefined && (
        <div
          role="alert"
          {...props(text.sm, intent.danger, terminalStyles.state, terminalStyles.failure)}
        >
          {error}
        </div>
      )}
    </section>
  );
}
