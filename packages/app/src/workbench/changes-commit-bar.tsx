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
import { create, props } from "@stylexjs/stylex";
import { Fragment, useState } from "react";
import type { ReactElement } from "react";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { GitOutcome, GitRevision } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { GitHubPullRequestOutcome } from "../bridge.ts";
import { errorMessage } from "../errors.ts";
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { Button, ButtonLink, SplitButton } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { nyte } from "../nyte.ts";
import { keys, queryClient, refreshVcs, workspaceGit } from "../queries.ts";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
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

/** The default action before the user chooses one from the menu. */
export const DEFAULT_COMMIT_ACTION: CommitAction = "commit-push";

const STORAGE_KEY = "nyte.desktop.changes-commit-action.v1";

/** Which steps one action runs, in order. A pull request always pushes its branch first. */
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
      return { ...steps, commit: true, push: true, pullRequest: true };
    case "push":
      return { ...steps, push: true };
    case "pull-request":
      return { ...steps, push: true, pullRequest: true };
  }
}

/** The actions this host offers; pull requests need GitHub. */
export function commitActions(pullRequests: boolean): readonly CommitAction[] {
  return pullRequests
    ? COMMIT_ACTIONS
    : COMMIT_ACTIONS.filter((action) => !commitActionPlan(action).pullRequest);
}

/** Menu groups: actions that branch first, then commits, then pushes and pull requests. */
function commitActionGroup(action: CommitAction): "branch" | "commit" | "push" {
  const plan = commitActionPlan(action);

  if (plan.branch) return "branch";

  return plan.commit ? "commit" : "push";
}

export function commitActionLabel(action: CommitAction): string {
  switch (action) {
    case "branch-commit":
      return "Create Branch and Commit Changes…";
    case "branch-commit-push":
      return "Create Branch, Commit and Push…";
    case "branch":
      return "Create Branch…";
    case "commit":
      return "Commit Changes";
    case "commit-push":
      return "Commit and Push Changes";
    case "commit-pull-request":
      return "Commit and Create Pull Request";
    case "push":
      return "Push Branch";
    case "pull-request":
      return "Create Pull Request";
  }
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
 * Why an action cannot run, when the bar does not already show it. An action that
 * creates a branch first leaves a detached or unborn HEAD behind, so those
 * checks apply only to the actions that push or open a pull request as they stand.
 */
export function commitActionDisabledReason(
  action: CommitAction,
  state: CommitBarState,
): string | undefined {
  const plan = commitActionPlan(action);

  if (plan.pullRequest && !isWorkingTreeScope(state.scope))
    return "Pull requests apply to the working tree";

  if (plan.branch) return undefined;

  if (plan.push && state.branch?.kind === "detached")
    return "HEAD is detached, so there is no branch";

  if (plan.push && !plan.commit && state.branch?.kind === "unborn")
    return "This branch has no commits yet";

  return undefined;
}

function commitActionDisabled(action: CommitAction, state: CommitBarState): boolean {
  return (
    (commitActionPlan(action).commit && (state.fileCount === 0 || state.message.trim() === "")) ||
    commitActionDisabledReason(action, state) !== undefined
  );
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

/** What a git write that did not apply says, whichever step it was. */
function refusedMessage(
  result: Exclude<GitOutcome, { readonly kind: "applied" }>,
  what: string,
): CommitBarResult {
  switch (result.kind) {
    case "unchanged":
      return { tone: "error", text: `${what}: nothing to do.` };
    case "stale":
      return { tone: "error", text: "Changes changed. Review them and try again." };
    case "busy":
      return { tone: "error", text: "A run is still writing to this workspace." };
    case "rejected":
      return { tone: "error", text: `${what} didn’t go through.`, detail: result.reason };
    default: {
      const _exhaustive: never = result;

      return _exhaustive;
    }
  }
}

export function createBranchResultMessage(result: GitOutcome, name: string): CommitBarResult {
  return result.kind === "applied"
    ? { tone: "success", text: `Created branch ${name} and switched to it.` }
    : refusedMessage(result, `Creating ${name}`);
}

export function commitResultMessage(result: GitOutcome): CommitBarResult {
  return result.kind === "applied"
    ? { tone: "success", text: "Committed." }
    : result.kind === "unchanged"
      ? { tone: "error", text: "Nothing to commit." }
      : refusedMessage(result, "The commit");
}

export function pushResultMessage(result: GitOutcome): CommitBarResult {
  return result.kind === "applied"
    ? { tone: "success", text: "Pushed." }
    : result.kind === "unchanged"
      ? { tone: "success", text: "Nothing to push." }
      : refusedMessage(result, "The push");
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
const trustRefusal = Type.Object({ cause: Type.Object({ code: Type.Literal("forbidden") }) });

export function actionFailureMessage(cause: unknown): CommitBarResult {
  if (Value.Check(trustRefusal, cause))
    return {
      tone: "error",
      text: "Trust this workspace to let Nyte write to Git, then try again.",
    };

  return { tone: "error", text: "The action didn’t go through.", detail: errorMessage(cause) };
}

/**
 * What a commit covers. The staged scope commits the index as it stands;
 * every other working-tree scope commits each tracked change with it.
 */
export function commitTargetFor(scope: WorkbenchChangesScope): "staged" | "all" {
  return scope.kind === "staged" ? "staged" : "all";
}

/** A pull request needs a title; the message's first line is it, then the branch. */
export function pullRequestTitle(message: string, branch: BranchReadout | undefined): string {
  const firstLine = message.split("\n")[0]?.trim() ?? "";

  if (firstLine !== "") return firstLine;

  return branch?.label ?? "";
}

function readStoredAction(actions: readonly CommitAction[]): CommitAction {
  try {
    if (typeof window === "undefined") return DEFAULT_COMMIT_ACTION;
    const stored = window.localStorage.getItem(STORAGE_KEY);

    return actions.find((action) => action === stored) ?? DEFAULT_COMMIT_ACTION;
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

const styles = create({
  bar: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flexShrink: 0,
    padding: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
  },
  actions: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  branchField: { flex: 1 },
  primary: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  result: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
  resultError: { color: role.contentSecondary },
  resultDetail: { color: role.contentSecondary, fontSize: type.fontXs, lineHeight: type.leadingXs },
  resultActions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
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
  const github = nyte.host.github;
  const actions = commitActions(github !== undefined);
  const [message, setMessage] = useState("");
  const [action, setAction] = useState<CommitAction>(() => readStoredAction(actions));
  const [branchName, setBranchName] = useState("");
  const [branchPrompt, setBranchPrompt] = useState<CommitAction | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CommitBarResult | undefined>(undefined);
  const [interrupted, setInterrupted] = useState<CommitAction | undefined>(undefined);

  const state: CommitBarState = { scope, fileCount, message, branch };

  const primaryDisabled =
    commitActionDisabled(action, state) || (branchPrompt !== undefined && branchName.trim() === "");

  const run = async (chosen: CommitAction, options: RunOptions = {}): Promise<void> => {
    if (running) return;
    const plan = commitActionPlan(chosen);
    let expect: GitRevision = asId<"git-revision">(revision);
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

        const created = await (await workspaceGit()).branch({ name, checkout: true }, { expect });
        const outcome = createBranchResultMessage(created, name);

        if (created.kind !== "applied") {
          settle(outcome);

          return;
        }

        expect = created.revision;

        // The prompt stays until the branch exists, so a taken or invalid name
        // can be corrected without retyping either field.
        setBranchPrompt(undefined);
        setBranchName("");
        reported.push(outcome.text);
      }

      if (plan.commit && options.skipCommit !== true) {
        const committed = await (
          await workspaceGit()
        ).commit({ message, files: commitTargetFor(scope) }, { expect });

        const outcome = commitResultMessage(committed);

        if (committed.kind !== "applied") {
          settle(outcome);

          return;
        }

        expect = committed.revision;

        setMessage("");
        reported.push(outcome.text);
      }

      if (plan.push) {
        const pushed = await (
          await workspaceGit()
        ).push({ setUpstream: options.setUpstream === true }, { expect });

        const outcome = pushResultMessage(pushed);

        if (outcome.tone === "error") {
          if (pushed.kind !== "stale") setInterrupted(chosen);
          settle(outcome);

          return;
        }

        reported.push(outcome.text);
      }

      if (plan.pullRequest) {
        if (github === undefined) {
          settle({ tone: "error", text: "Pull requests need GitHub on the server." });

          return;
        }

        const opened = await github.createPullRequest({
          title: pullRequestTitle(message, branch),
        });

        const outcome = pullRequestResultMessage(opened);

        if (outcome.tone === "success") {
          refreshVcs();
          void queryClient.invalidateQueries({ queryKey: keys.github });
        }

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
    if (running || commitActionDisabled(chosen, state)) return;
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

    if (running || primaryDisabled || pending === undefined) return;
    void run(pending, { branchName: branchName.trim() });
  };

  const publishBranch = (): void => {
    const pending = interrupted ?? "push";
    void run(pending, { setUpstream: true, skipBranch: true, skipCommit: true });
  };

  const successText = result?.tone === "success" ? result.text.trim() : "";
  const showResult = result !== undefined && (result.tone === "error" || successText !== "");

  return (
    <form
      {...props(styles.bar)}
      onSubmit={(event) => {
        event.preventDefault();

        if (running || primaryDisabled) return;

        if (branchPrompt === undefined) start(action);
        else confirmBranch();
      }}
    >
      <Input
        type="text"
        aria-label="Commit message"
        placeholder="Fix tab close behavior"
        autoComplete="off"
        spellCheck
        value={message}
        readOnly={running}
        onValueChange={setMessage}
      />
      {branchPrompt !== undefined && (
        <div {...props(styles.actions)}>
          <Input
            type="text"
            aria-label="New branch name"
            placeholder="fix/tab-close"
            autoComplete="off"
            spellCheck={false}
            value={branchName}
            readOnly={running}
            xstyle={styles.branchField}
            onValueChange={setBranchName}
            onKeyDown={(event) => {
              if (!running && event.key === "Escape") setBranchPrompt(undefined);
            }}
          />
          <Button loading={running} onClick={() => setBranchPrompt(undefined)}>
            Cancel
          </Button>
        </div>
      )}
      <SplitButton.Root>
        <SplitButton.Main
          type="submit"
          variant="solid"
          disabled={primaryDisabled}
          disabledReason={commitActionDisabledReason(action, state)}
          loading={running}
          xstyle={styles.primary}
        >
          {commitActionLabel(action).replace(/…$/, branchPrompt === undefined ? "…" : "")}
        </SplitButton.Main>
        <Menu>
          <MenuTrigger
            render={
              <SplitButton.MenuTrigger
                variant="solid"
                aria-label="More commit actions"
                loading={running}
              />
            }
          />
          <MenuContent align="end">
            <MenuRadioGroup value={action}>
              {actions.map((candidate, index) => {
                const previous = actions[index - 1];

                return (
                  <Fragment key={candidate}>
                    {previous !== undefined &&
                      commitActionGroup(previous) !== commitActionGroup(candidate) && (
                        <MenuSeparator />
                      )}
                    <MenuRadioItem
                      value={candidate}
                      layout="plain"
                      disabled={commitActionDisabled(candidate, state)}
                      onClick={() => start(candidate)}
                    >
                      {commitActionLabel(candidate)}
                    </MenuRadioItem>
                  </Fragment>
                );
              })}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      </SplitButton.Root>
      {showResult && result !== undefined && (
        <div
          role={result.tone === "error" ? "alert" : "status"}
          {...props(
            result.tone === "error" && intent.danger,
            styles.result,
            result.tone === "error" && styles.resultError,
          )}
        >
          <span>{result.text.trim()}</span>
          {result.detail !== undefined && result.detail !== "" && (
            <span {...props(styles.resultDetail)}>{result.detail}</span>
          )}
          {(result.url !== undefined || result.offerPublish === true) && (
            <span {...props(styles.resultActions)}>
              {result.url !== undefined && (
                <ButtonLink
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  variant="text"
                  onClick={(event) => {
                    event.preventDefault();

                    if (result.url !== undefined)
                      void nyte.host.openExternal({ url: result.url }).catch(() => undefined);
                  }}
                >
                  {result.url}
                </ButtonLink>
              )}
              {result.offerPublish === true && (
                <Button variant="outline" loading={running} onClick={publishBranch}>
                  Publish Branch
                </Button>
              )}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
