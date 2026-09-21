/**
 * The Changes tab's commit surface: a message field and one primary action
 * with the rest of the Git actions behind its menu.
 *
 * Every action here is a host mutation, so each one is gated on workspace
 * trust and each outcome is reported in plain words instead of being retried
 * silently. Nothing is ever forced: a rejected push asks for a pull, an
 * untracked branch offers to publish itself, and a missing `gh` says so.
 *
 * The surface belongs to the working tree. A turn's changes and a commit's are
 * records of an edit, so the bar is not rendered for those scopes at all.
 */
import * as stylex from "@stylexjs/stylex";
import { Fragment, useState } from "react";
import type { ReactElement } from "react";
import type {
  VcsBranchOutcome,
  VcsCommitOutcome,
  VcsCommitTarget,
  VcsPushOutcome,
} from "@nyte-ai/protocol";
import type { GitHubPullRequestOutcome } from "../../../shared/ipc.ts";
import { errorMessage } from "../../../shared/errors.ts";
import { Menu, MenuItem, MenuSeparator } from "../components/menu.tsx";
import { Button, focus, IconButton } from "../components/ui";
import { Icon } from "../components/icons.tsx";
import type { IconName } from "../components/icons.tsx";
import { nyte } from "../nyte.ts";
import { refreshVcs, refreshVcsSnapshot } from "../queries.ts";
import { t } from "../theme/vars.stylex.ts";
import type { BranchReadout } from "./change-scopes.ts";
import type { WorkbenchChangesScope } from "./controller.ts";

/** Every action the split button can run, in the order the menu lists them. */
export const COMMIT_ACTIONS = [
  "branch-commit",
  "branch-commit-push",
  "branch",
  "commit",
  "commit-push",
  "commit-pull-request",
  "push",
  "pull-request",
] as const;

export type CommitAction = (typeof COMMIT_ACTIONS)[number];

/** Cursor's default: the action a reader who never opened the menu gets. */
export const DEFAULT_COMMIT_ACTION: CommitAction = "commit-push";

const STORAGE_KEY = "nyte.desktop.changes-commit-action.v1";

/** Which steps one action runs, in order. */
export interface CommitActionPlan {
  readonly branch: boolean;
  readonly commit: boolean;
  readonly push: boolean;
  readonly pullRequest: boolean;
}

export function commitActionPlan(action: CommitAction): CommitActionPlan {
  const steps = { branch: false, commit: false, push: false, pullRequest: false };
  switch (action) {
    case "branch-commit":
      return { ...steps, branch: true, commit: true };
    case "branch-commit-push":
      return { ...steps, branch: true, commit: true, push: true };
    case "branch":
      return { ...steps, branch: true };
    case "commit":
      return { ...steps, commit: true };
    case "commit-push":
      return { ...steps, commit: true, push: true };
    case "commit-pull-request":
      return { ...steps, commit: true, pullRequest: true };
    case "push":
      return { ...steps, push: true };
    case "pull-request":
      return { ...steps, pullRequest: true };
  }
}

export function commitActionLabel(action: CommitAction): string {
  switch (action) {
    case "branch-commit":
      return "Create branch and commit";
    case "branch-commit-push":
      return "Create branch, commit and push";
    case "branch":
      return "Create branch";
    case "commit":
      return "Commit";
    case "commit-push":
      return "Commit and push";
    case "commit-pull-request":
      return "Commit and create pull request";
    case "push":
      return "Push";
    case "pull-request":
      return "Create pull request";
  }
}

function commitActionIcon(action: CommitAction): IconName {
  const plan = commitActionPlan(action);
  if (plan.branch) return "git-branch";
  if (plan.pullRequest) return "pull-request";
  if (plan.commit) return "git";
  return "arrow-up";
}

/** The scopes that read the working tree, which is the only place a commit applies. */
export function isWorkingTreeScope(scope: WorkbenchChangesScope): boolean {
  return scope.kind === "uncommitted" || scope.kind === "staged" || scope.kind === "unstaged";
}

export interface CommitBarState {
  readonly scope: WorkbenchChangesScope;
  /** Files in the scope on screen; nothing to commit while this is zero. */
  readonly fileCount: number;
  readonly message: string;
  readonly branch: BranchReadout | undefined;
}

/**
 * Why an action cannot run, in the words shown on its menu row. An action that
 * creates a branch first leaves a detached or unborn HEAD behind, so those
 * checks apply only to the actions that push or open a pull request as they stand.
 */
export function commitActionDisabledReason(
  action: CommitAction,
  state: CommitBarState,
): string | undefined {
  const plan = commitActionPlan(action);
  if (plan.commit) {
    if (state.fileCount === 0) return "Nothing to commit in this scope";
    if (state.message.trim() === "") return "Write a commit message first";
  }
  if (plan.pullRequest && !isWorkingTreeScope(state.scope))
    return "Pull requests apply to the working tree";
  if (plan.branch) return undefined;
  const remoteStep = plan.push || plan.pullRequest;
  if (remoteStep && state.branch?.kind === "detached")
    return "HEAD is detached, so there is no branch";
  if (remoteStep && !plan.commit && state.branch?.kind === "unborn")
    return "This branch has no commits yet";
  return undefined;
}

/** What a step left behind, as the bar reports it. */
export interface CommitBarResult {
  readonly tone: "success" | "error";
  readonly text: string;
  /** Git's or `gh`'s own words, kept so nothing is lost to paraphrase. */
  readonly detail?: string;
  readonly url?: string;
  /** The branch tracks nothing, so the bar offers to publish it. */
  readonly offerPublish?: boolean;
}

export function createBranchResultMessage(result: VcsBranchOutcome, name: string): CommitBarResult {
  switch (result.kind) {
    case "created":
      return { tone: "success", text: `Created branch ${name} and switched to it.` };
    case "exists":
      return { tone: "error", text: `Branch ${name} already exists. Pick another name.` };
    case "invalid_name":
      return {
        tone: "error",
        text: `${name} is not a valid branch name. Pick another name.`,
        detail: result.reason,
      };
    case "failed":
      return { tone: "error", text: "Couldn’t create the branch.", detail: result.reason };
    case "stale":
      return { tone: "error", text: "Changes changed. Review them and try again." };
  }
}

export function commitResultMessage(result: VcsCommitOutcome): CommitBarResult {
  switch (result.kind) {
    case "committed":
      return { tone: "success", text: `Committed ${result.oid.slice(0, 7)}: ${result.summary}` };
    case "nothing_to_commit":
      return {
        tone: "error",
        text: "Nothing to commit. The working tree matches the last commit.",
      };
    case "failed":
      return { tone: "error", text: "The commit didn’t go through.", detail: result.reason };
    case "stale":
      return { tone: "error", text: "Changes changed. Review them and try again." };
  }
}

export function pushResultMessage(result: VcsPushOutcome): CommitBarResult {
  switch (result.kind) {
    case "pushed":
      return { tone: "success", text: `Pushed ${result.branch} to ${result.remote}.` };
    case "up_to_date":
      return { tone: "success", text: "Nothing to push. The remote already has these commits." };
    case "no_upstream":
      return {
        tone: "error",
        text: `${result.branch} tracks no remote branch yet. Publish it to push.`,
        offerPublish: true,
      };
    case "rejected":
      return {
        tone: "error",
        text: "The remote has commits this branch doesn’t. Pull them, then push again.",
        detail: result.reason,
      };
    case "failed":
      return { tone: "error", text: "The push didn’t go through.", detail: result.reason };
    case "stale":
      return { tone: "error", text: "Changes changed. Review them and try again." };
  }
}

export function pullRequestResultMessage(result: GitHubPullRequestOutcome): CommitBarResult {
  switch (result.kind) {
    case "created":
      return { tone: "success", text: "Opened a pull request.", url: result.url };
    case "exists":
      return {
        tone: "success",
        text: `A pull request is already open for this branch: #${String(result.pullRequest.number)} ${result.pullRequest.title}`,
        url: result.pullRequest.url,
      };
    case "cli_missing":
      return {
        tone: "error",
        text: "Pull requests need the GitHub CLI. Install gh, then try again.",
      };
    case "signed_out":
      return {
        tone: "error",
        text: "The GitHub CLI is signed out. Run gh auth login, then try again.",
      };
    case "no_remote":
      return {
        tone: "error",
        text: "This repository has no GitHub remote to open a pull request against.",
      };
    case "failed":
      return { tone: "error", text: "Couldn’t open the pull request.", detail: result.message };
  }
}

/** A trust refusal crosses IPC as a `forbidden` failure, not as an outcome. */
function isTrustRefusal(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null || !("cause" in cause)) return false;
  const inner = cause.cause;
  return (
    typeof inner === "object" && inner !== null && "code" in inner && inner.code === "forbidden"
  );
}

export function actionFailureMessage(cause: unknown): CommitBarResult {
  if (isTrustRefusal(cause))
    return {
      tone: "error",
      text: "Nyte needs trust for this workspace before it can write to Git. Trust the workspace, then try again.",
    };
  return { tone: "error", text: "The action didn’t go through.", detail: errorMessage(cause) };
}

/**
 * What a commit covers. The staged scope commits the index as it stands;
 * every other working-tree scope commits each tracked change with it.
 */
export function commitTargetFor(scope: WorkbenchChangesScope): VcsCommitTarget {
  return scope.kind === "staged" ? { kind: "staged" } : { kind: "all" };
}

/** A pull request needs a title; the message's first line is it, then the branch. */
export function pullRequestTitle(message: string, branch: BranchReadout | undefined): string {
  const firstLine = message.split("\n")[0]?.trim() ?? "";
  if (firstLine !== "") return firstLine;
  return branch?.label ?? "";
}

function readStoredAction(): CommitAction {
  try {
    if (typeof window === "undefined") return DEFAULT_COMMIT_ACTION;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return COMMIT_ACTIONS.find((action) => action === stored) ?? DEFAULT_COMMIT_ACTION;
  } catch {
    return DEFAULT_COMMIT_ACTION;
  }
}

function storeAction(action: CommitAction): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, action);
  } catch {
    // Remembering the last action is a convenience, never a reason to fail one.
  }
}

const styles = stylex.create({
  bar: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flexShrink: 0,
    padding: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: t.strokeTertiary,
  },
  field: {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    height: 24,
    gap: 4,
    paddingInline: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: t.strokeSecondary, ":focus-within": t.strokeFocused },
    borderRadius: t.radiusBase,
    backgroundColor: t.bgElevated,
    color: t.iconTertiary,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    borderStyle: "none",
    outline: "none",
    backgroundColor: "transparent",
    color: { default: t.textPrimary, "::placeholder": t.textTertiary },
    fontFamily: "inherit",
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  actions: { display: "flex", alignItems: "center", gap: 4, minWidth: 0 },
  branchField: { flex: 1, minWidth: 0 },
  // A grid cell stretches its only child, which is how the button fills the row.
  primary: { display: "grid", flex: 1, minWidth: 0 },
  result: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textWrap: "pretty",
  },
  resultError: { color: t.textDanger },
  resultDetail: { color: t.textTertiary, fontSize: t.fontXs, lineHeight: t.leadingXs },
  resultActions: { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" },
  link: {
    appearance: "none",
    padding: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: t.textAccent,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    textAlign: "start",
    cursor: "pointer",
  },
});

export interface ChangesCommitBarProps {
  readonly scope: WorkbenchChangesScope;
  readonly branch: BranchReadout | undefined;
  readonly revision: string;
  readonly fileCount: number;
}

interface RunOptions {
  readonly branchName?: string;
  readonly setUpstream?: boolean;
  /** A retry continues an action whose earlier steps already ran. */
  readonly skipBranch?: boolean;
  readonly skipCommit?: boolean;
}

export function ChangesCommitBar({
  scope,
  branch,
  revision,
  fileCount,
}: ChangesCommitBarProps): ReactElement {
  const [message, setMessage] = useState("");
  const [action, setAction] = useState<CommitAction>(readStoredAction);
  const [branchName, setBranchName] = useState("");
  const [branchPrompt, setBranchPrompt] = useState<CommitAction | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CommitBarResult | undefined>(undefined);
  const [interrupted, setInterrupted] = useState<CommitAction | undefined>(undefined);

  const state: CommitBarState = { scope, fileCount, message, branch };
  const primaryDisabledReason = commitActionDisabledReason(action, state);

  const run = async (chosen: CommitAction, options: RunOptions = {}): Promise<void> => {
    const plan = commitActionPlan(chosen);
    let expect = { revision };
    setRunning(true);
    setResult(undefined);
    setInterrupted(undefined);
    const reported: string[] = [];
    const settle = (outcome: CommitBarResult): void => {
      setResult(
        reported.length === 0
          ? outcome
          : { ...outcome, text: `${reported.join(" ")} ${outcome.text}` },
      );
    };
    try {
      if (plan.branch && options.skipBranch !== true) {
        const name = options.branchName ?? "";
        const created = await nyte.workspace.vcs.createBranch({
          target: { kind: "workspace" },
          name,
          checkout: true,
          expect,
        });
        const outcome = createBranchResultMessage(created, name);
        if (created.kind !== "created") {
          if (created.kind === "stale") refreshVcs();
          settle(outcome);
          return;
        }
        refreshVcs();
        if (plan.commit || plan.push) {
          const snapshot = await refreshVcsSnapshot();
          if (snapshot.kind !== "repository") {
            settle({ tone: "error", text: "This workspace is no longer a Git repository." });
            return;
          }
          expect = { revision: snapshot.revision };
        }
        // The prompt stays until the branch exists, so a taken or invalid name
        // can be corrected without retyping either field.
        setBranchPrompt(undefined);
        setBranchName("");
        reported.push(outcome.text);
      }
      if (plan.commit && options.skipCommit !== true) {
        const committed = await nyte.workspace.vcs.commit({
          target: { kind: "workspace" },
          message,
          files: commitTargetFor(scope),
          expect,
        });
        const outcome = commitResultMessage(committed);
        if (committed.kind !== "committed") {
          if (committed.kind === "stale") refreshVcs();
          settle(outcome);
          return;
        }
        refreshVcs();
        if (plan.push) {
          const snapshot = await refreshVcsSnapshot();
          if (snapshot.kind !== "repository") {
            settle({ tone: "error", text: "This workspace is no longer a Git repository." });
            return;
          }
          expect = { revision: snapshot.revision };
        }
        setMessage("");
        reported.push(outcome.text);
      }
      if (plan.push) {
        const pushed = await nyte.workspace.vcs.push({
          target: { kind: "workspace" },
          setUpstream: options.setUpstream === true,
          expect,
        });
        const outcome = pushResultMessage(pushed);
        if (outcome.tone === "error") {
          if (pushed.kind === "stale") refreshVcs();
          else setInterrupted(chosen);
          settle(outcome);
          return;
        }
        refreshVcs();
        reported.push(outcome.text);
      }
      if (plan.pullRequest) {
        const opened = await nyte.host.github.createPullRequest({
          title: pullRequestTitle(message, branch),
        });
        const outcome = pullRequestResultMessage(opened);
        if (outcome.tone === "success") refreshVcs();
        settle(outcome);
        return;
      }
      settle({ tone: "success", text: "" });
    } catch (cause) {
      settle(actionFailureMessage(cause));
    } finally {
      setRunning(false);
    }
  };

  const start = (chosen: CommitAction): void => {
    setAction(chosen);
    storeAction(chosen);
    setResult(undefined);
    if (commitActionPlan(chosen).branch) {
      setBranchPrompt(chosen);
      return;
    }
    setBranchPrompt(undefined);
    void run(chosen);
  };

  const confirmBranch = (): void => {
    const pending = branchPrompt;
    if (pending === undefined || branchName.trim() === "") return;
    void run(pending, { branchName: branchName.trim() });
  };

  const publishBranch = (): void => {
    const pending = interrupted ?? "push";
    void run(pending, { setUpstream: true, skipBranch: true, skipCommit: true });
  };

  const successText = result?.tone === "success" ? result.text.trim() : "";
  const showResult = result !== undefined && (result.tone === "error" || successText !== "");

  return (
    <div {...stylex.props(styles.bar)}>
      <div {...stylex.props(styles.field)}>
        <Icon name="git" size={12} />
        <input
          type="text"
          aria-label="Commit message"
          placeholder="Commit message"
          autoComplete="off"
          spellCheck
          value={message}
          disabled={running}
          onChange={(event) => setMessage(event.currentTarget.value)}
          {...stylex.props(styles.input)}
        />
      </div>
      {branchPrompt !== undefined && (
        <div {...stylex.props(styles.actions)}>
          <div {...stylex.props(styles.field, styles.branchField)}>
            <Icon name="git-branch" size={12} />
            <input
              type="text"
              aria-label="New branch name"
              placeholder="Branch name"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              value={branchName}
              disabled={running}
              onChange={(event) => setBranchName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirmBranch();
                }
                if (event.key === "Escape") setBranchPrompt(undefined);
              }}
              {...stylex.props(styles.input)}
            />
          </div>
          <Button
            variant="primary"
            disabled={running || branchName.trim() === ""}
            onClick={confirmBranch}
          >
            {commitActionLabel(branchPrompt)}
          </Button>
          <Button variant="ghost" disabled={running} onClick={() => setBranchPrompt(undefined)}>
            Cancel
          </Button>
        </div>
      )}
      <div {...stylex.props(styles.actions)}>
        <span {...stylex.props(styles.primary)}>
          <Button
            variant="primary"
            icon={commitActionIcon(action)}
            title={primaryDisabledReason}
            disabled={running || primaryDisabledReason !== undefined}
            onClick={() => start(action)}
          >
            {commitActionLabel(action)}
          </Button>
        </span>
        <Menu
          label="Commit actions"
          align="end"
          trigger={
            <IconButton icon="chevron-down" label="More commit actions" disabled={running} />
          }
        >
          {COMMIT_ACTIONS.map((candidate, index) => {
            const reason = commitActionDisabledReason(candidate, state);
            return (
              <Fragment key={candidate}>
                {(index === 3 || index === 6) && <MenuSeparator />}
                <MenuItem
                  icon={commitActionIcon(candidate)}
                  disabled={reason !== undefined}
                  meta={reason}
                  selected={candidate === action}
                  onSelect={() => start(candidate)}
                >
                  {commitActionLabel(candidate)}
                </MenuItem>
              </Fragment>
            );
          })}
        </Menu>
      </div>
      {showResult && result !== undefined && (
        <div
          role={result.tone === "error" ? "alert" : "status"}
          {...stylex.props(styles.result, result.tone === "error" && styles.resultError)}
        >
          <span>{result.text.trim()}</span>
          {result.detail !== undefined && result.detail !== "" && (
            <span {...stylex.props(styles.resultDetail)}>{result.detail}</span>
          )}
          {(result.url !== undefined || result.offerPublish === true) && (
            <span {...stylex.props(styles.resultActions)}>
              {result.url !== undefined && (
                <button
                  type="button"
                  onClick={() => {
                    if (result.url !== undefined)
                      void nyte.host.openExternal({ url: result.url }).catch(() => undefined);
                  }}
                  {...stylex.props(styles.link, focus.ring)}
                >
                  {result.url}
                </button>
              )}
              {result.offerPublish === true && (
                <Button disabled={running} onClick={publishBranch}>
                  Publish branch
                </Button>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
