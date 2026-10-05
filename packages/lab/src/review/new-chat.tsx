/**
 * The new chat, as the app draws it: the workspace above an empty composer.
 * What you send is a task. Nyte builds it on a new branch in a worktree of its
 * own, starting from the branch your checkout is on, and opens a pull request
 * when it commits.
 */
import { contextStyles } from "@nyte-ai/app/screens/context-selector.stylex.ts";
import { threadStyles } from "@nyte-ai/app/screens/thread.stylex.ts";
import { composerStyles } from "@nyte-ai/app/conversation/styles.stylex.ts";
import { create, props } from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Spinner } from "@nyte-ai/ui/spinner";
import { role } from "@nyte-ai/ui/vars.stylex";
import { ReviewError, useRepo, useStartTask } from "./api";
import type { Repo } from "./wire";

function Composer({
  repo,
  onStarted,
}: {
  readonly repo: Repo;
  readonly onStarted: (id: string) => void;
}): ReactElement {
  const [task, setTask] = useState("");
  const start = useStartTask();
  const base = repo.current ?? repo.base;

  const submit = (): void => {
    if (task.trim() === "" || start.isPending) return;

    start.mutate({ task: task.trim(), base }, { onSuccess: (created) => onStarted(created.id) });
  };

  return (
    <>
      <div {...props(contextStyles.row)}>
        <span {...props(contextStyles.readout, contextStyles.controlLayout, styles.workspace)}>
          <Icon name="folder" size={14} />
          <span {...props(contextStyles.text)}>{repo.root.split("/").at(-1)}</span>
        </span>
        <span {...props(contextStyles.readout, contextStyles.controlLayout)}>
          <span translate="no" title={base} {...props(contextStyles.text)}>
            {base}
          </span>
        </span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        {...props(composerStyles.frame, composerStyles.frameNewChat)}
      >
        <div {...props(composerStyles.layout, composerStyles.layoutNewChat)}>
          <div {...props(composerStyles.editor)}>
            <textarea
              aria-label="Task"
              placeholder="Ask Nyte"
              rows={2}
              value={task}
              autoFocus
              onChange={(event) => setTask(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                  return;

                event.preventDefault();
                submit();
              }}
              {...props(composerStyles.input, composerStyles.inputNewChat, styles.text)}
            />
          </div>
          <div {...props(composerStyles.controls)}>
            <span {...props(composerStyles.spacer)} />
            <span {...props(composerStyles.sendActions)}>
              <Button
                iconOnly
                icon="arrow-up"
                aria-label="Send"
                type="submit"
                variant="solid"
                tone="primary"
                disabled={task.trim() === ""}
                loading={start.isPending}
              />
            </span>
          </div>
        </div>
      </form>
      {start.error !== null && (
        <p role="alert" {...props(threadStyles.error)}>
          {start.error.message}
        </p>
      )}
    </>
  );
}

export function NewChatPlace({
  onStarted,
}: {
  /** Nyte took the task: show its chat. */
  readonly onStarted: (id: string) => void;
}): ReactElement {
  const repo = useRepo();

  return (
    <div {...props(threadStyles.blank)}>
      <div {...props(threadStyles.blankColumn)}>
        {repo.data === undefined ? (
          <p role="status" {...props(threadStyles.blankHint, styles.status)}>
            {repo.error instanceof ReviewError && repo.error.offline ? (
              repo.error.message
            ) : (
              <>
                <Spinner /> Reading the workspace
              </>
            )}
          </p>
        ) : (
          <Composer repo={repo.data} onStarted={onStarted} />
        )}
      </div>
    </div>
  );
}

const styles = create({
  workspace: { gap: 6, color: role.contentPrimary },
  // The app's composer field is an editor; this one is a textarea dressed the same.
  text: {
    resize: "none",
    margin: 0,
    padding: 0,
    borderStyle: "none",
    outline: "none",
    backgroundColor: "transparent",
    color: role.contentPrimary,
    font: "inherit",
    "::placeholder": { color: role.contentSecondary },
  },
  status: { display: "flex", alignItems: "center", gap: 8, margin: 0 },
});
