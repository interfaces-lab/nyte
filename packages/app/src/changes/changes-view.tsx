import type { FileStatus, GitOutcome, GitRevision, GitStatus, WorkspaceId } from "@nyte-ai/sdk";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Button, ButtonLink, SplitButton } from "@nyte-ai/ui/button";
import { Checkbox } from "@nyte-ai/ui/checkbox";
import { FileTypeIcon, FileTypeIconSprite } from "@nyte-ai/ui/file-type-icon";
import { Row } from "@nyte-ai/ui/row";
import { Input, Textarea } from "@nyte-ai/ui/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import type { Tint } from "@nyte-ai/ui/surface-theme";
import { create, props } from "@stylexjs/stylex";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useState } from "react";
import type { ReactElement } from "react";
import { useGitHub, useGitHubAccountState, useGitHubState } from "../account/github-account.ts";
import { gitFor, refreshVcs, useVcsSnapshot } from "../data/vcs.ts";
import { resolveHeight } from "../editor/tree-theme.ts";
import { worktreeFiles } from "../editor/worktree-files.ts";
import type { WorktreeFile } from "../editor/worktree-files.ts";
import { openExternal } from "../lib/open-external.ts";
import { useWorkbenchWorkspace } from "../workbench/workbench-workspace.tsx";
import { commitActionDisabledReason, runCommitAction } from "./changes-commit-bar.tsx";
import type { CommitBarState, RunOptions } from "./changes-commit-bar.tsx";
import { branchReadout } from "./change-scopes.ts";
import { revertConfirmation } from "./changes-model.ts";
import type { CommitAction } from "./changes-view-options.ts";
import { useCommitChecks } from "./commit-checks.ts";
import { updateCommitDraft, useCommitDraft } from "./commit-draft.ts";
import type { CommitDraft } from "./commit-draft.ts";

const OVERSCAN = 8;

type Repository = Extract<GitStatus, { readonly kind: "repository" }>;

const STATUS = {
  modified: { letter: "M", tint: "yellow", label: "Modified" },
  renamed: { letter: "R", tint: "yellow", label: "Renamed" },
  added: { letter: "A", tint: "green", label: "Added" },
  untracked: { letter: "U", tint: "green", label: "Untracked" },
  deleted: { letter: "D", tint: "red", label: "Deleted" },
  conflicted: { letter: "C", tint: "red", label: "Conflicted" },
} as const satisfies Record<
  FileStatus,
  { readonly letter: string; readonly tint: Tint; readonly label: string }
>;

const MORE_ACTIONS = [
  { action: "commit-push", label: "Commit and Push" },
  { action: "branch-commit", label: "Commit to New Branch…" },
  { action: "commit-pull-request", label: "Commit and Create Pull Request" },
] as const satisfies readonly { readonly action: CommitAction; readonly label: string }[];

/** A Code window's Changes view: a commit message, Commit, and the changed files, each checked into the next commit or not. */
export function ChangesView({
  onOpen,
  onInitialize,
}: {
  /** Opens a changed file in the Editor, by its path on disk. */
  readonly onOpen: (path: string) => void;
  /** Turns the folder at `path` into a git repository. */
  readonly onInitialize: (path: string) => void;
}): ReactElement | null {
  const browsed = useWorkbenchWorkspace();
  const workspace = browsed.kind === "ready" ? browsed.workspace : undefined;
  const status = useVcsSnapshot(workspace?.id, workspace !== undefined).data;

  if (workspace === undefined || status === undefined) return null;

  if (status.kind === "none") {
    return (
      <div {...props(styles.view)}>
        <div {...props(styles.notice)}>
          <p {...props(text.base, styles.noticeText)}>This folder isn&apos;t a git repository.</p>
          <Button variant="solid" onClick={() => onInitialize(workspace.path)}>
            Initialize Repository
          </Button>
        </div>
      </div>
    );
  }

  return (
    <RepositoryChanges
      key={workspace.id}
      workspace={workspace.id}
      root={workspace.path}
      status={status}
      onOpen={onOpen}
    />
  );
}

function RepositoryChanges({
  workspace,
  root,
  status,
  onOpen,
}: {
  readonly workspace: WorkspaceId;
  readonly root: string;
  readonly status: Repository;
  readonly onOpen: (path: string) => void;
}): ReactElement {
  const files = worktreeFiles(status);

  const checks = useCommitChecks(
    `${workspace}:${status.branch ?? status.head ?? ""}`,
    files.map((file) => file.path),
  );

  const { message, running, result, retry } = useCommitDraft(workspace);
  const update = (patch: Partial<CommitDraft>): void => updateCommitDraft(workspace, patch);
  const [branchPrompt, setBranchPrompt] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [discarding, setDiscarding] = useState<{
    readonly file: WorktreeFile;
    readonly revision: GitRevision;
  }>();
  const [discardError, setDiscardError] = useState<string>();
  const [discardPending, setDiscardPending] = useState(false);
  const github = useGitHub(workspace);
  const githubState = useGitHubState(workspace, github);
  const account = useGitHubAccountState().data;
  const count = checks.checked.size === 0 ? files.length : checks.checked.size;
  const allChecked = files.length > 0 && checks.checked.size === files.length;

  const state: CommitBarState = {
    scope: { kind: "uncommitted" },
    fileCount: count,
    message,
    branch: branchReadout(status),
    account,
    github: githubState.data,
  };

  const blocked = (action: CommitAction): boolean =>
    running ||
    count === 0 ||
    message.trim() === "" ||
    commitActionDisabledReason(action, state) !== undefined;

  const listed = new Set(files.map((file) => file.path));

  const sides = (file: WorktreeFile): readonly string[] =>
    file.from === undefined || listed.has(file.from) ? [file.path] : [file.path, file.from];

  const committing = files.filter(
    (file) => checks.checked.size === 0 || checks.checked.has(file.path),
  );

  const run = async (
    action: CommitAction,
    options: RunOptions = {},
    sent: string = message,
  ): Promise<void> => {
    update({ running: true, result: undefined });
    const branch = options.branchName ?? status.branch;

    const outcome = await runCommitAction({
      workspace,
      action,
      options: { ...options, setUpstream: status.upstream === null && branch !== null },
      revision: status.revision,
      message: sent,
      files: { kind: "paths", paths: committing.flatMap(sides) },
      github,
      onBranchCreated: () => {
        setBranchPrompt(false);
        setBranchName("");
      },
      onCommitted: () => {
        update({
          message: "",
          retry:
            action === "commit" || action === "branch-commit"
              ? undefined
              : { action, message: sent, branch },
        });
        checks.setAll(false);
      },
      onPushInterrupted: () => undefined,
    });

    update({
      running: false,
      result: outcome,
      ...(outcome.tone === "success" && { retry: undefined }),
    });
  };

  const start = (action: CommitAction): void => {
    if (blocked(action)) return;

    if (action === "branch-commit") {
      setBranchPrompt(true);

      return;
    }

    void run(action);
  };

  const submit = (): void => {
    if (!branchPrompt) {
      start("commit");

      return;
    }

    if (!blocked("branch-commit") && branchName.trim() !== "") {
      void run("branch-commit", { branchName: branchName.trim() });
    }
  };

  const discard = async (target: WorktreeFile, revision: GitRevision): Promise<void> => {
    setDiscardPending(true);
    const staged = status.staged.some((file) => file.path === target.path);
    const outcome = await discardFile(workspace, sides(target), staged, revision);

    setDiscardPending(false);

    if (outcome.kind === "failed") {
      setDiscardError(outcome.reason);

      return;
    }
    setDiscardError(undefined);
    setDiscarding(undefined);

    if (outcome.kind === "stale") {
      void refreshVcs(workspace);
      update({
        result: {
          tone: "error",
          text: `${target.path} changed after you asked to discard it. Review it and discard again.`,
        },
      });
    }
  };

  const absolute = (path: string): string => `${root.replace(/\/$/u, "")}/${path}`;

  const confirmation =
    discarding === undefined
      ? undefined
      : revertConfirmation({
          path: discarding.file.path,
          untracked: discarding.file.kind === "untracked",
          added: discarding.file.kind === "added",
        });

  const successText = result?.tone === "success" ? result.text.trim() : "";

  return (
    <div {...props(styles.view)}>
      <FileTypeIconSprite />
      <form
        {...props(styles.commit)}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Textarea
          aria-label="Commit message"
          placeholder={
            status.branch === null
              ? "Message (⌘↵ to commit)"
              : `Message (⌘↵ to commit on ${status.branch})`
          }
          rows={2}
          value={message}
          readOnly={running}
          spellCheck
          onChange={(event) => update({ message: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {branchPrompt && (
          <div {...props(styles.branchRow)}>
            <Input
              autoFocus
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
                if (!running && event.key === "Escape") setBranchPrompt(false);
              }}
            />
            <Button disabled={running} onClick={() => setBranchPrompt(false)}>
              Cancel
            </Button>
          </div>
        )}
        <SplitButton.Root>
          <SplitButton.Main
            type="submit"
            variant="solid"
            disabled={
              branchPrompt
                ? blocked("branch-commit") || branchName.trim() === ""
                : blocked("commit")
            }
            loading={running}
            xstyle={styles.primary}
          >
            {branchPrompt
              ? "Commit to New Branch"
              : count === 0
                ? "Commit"
                : `Commit ${String(count)} ${count === 1 ? "file" : "files"}`}
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
              {MORE_ACTIONS.flatMap((entry) =>
                github === undefined && entry.action === "commit-pull-request"
                  ? []
                  : [
                      <MenuItem
                        key={entry.action}
                        layout="plain"
                        disabled={blocked(entry.action)}
                        onClick={() => start(entry.action)}
                      >
                        {entry.label}
                      </MenuItem>,
                    ],
              )}
            </MenuContent>
          </Menu>
        </SplitButton.Root>
        {result !== undefined && (result.tone === "error" || successText !== "") && (
          <div
            role={result.tone === "error" ? "alert" : "status"}
            {...props(text.sm, result.tone === "error" && intent.danger, styles.result)}
          >
            <span>{result.text.trim()}</span>
            {result.detail !== undefined && result.detail !== "" && (
              <span {...props(text.xs)}>{result.detail}</span>
            )}
            {result.tone === "error" && retry !== undefined && retry.branch === status.branch && (
              <Button
                variant="outline"
                loading={running}
                onClick={() =>
                  void run(retry.action, { skipBranch: true, skipCommit: true }, retry.message)
                }
              >
                {retry.action === "commit-pull-request"
                  ? "Push and Open Pull Request"
                  : "Push Again"}
              </Button>
            )}
            {result.url !== undefined && (
              <ButtonLink
                href={result.url}
                target="_blank"
                rel="noreferrer"
                variant="text"
                onClick={(event) => {
                  event.preventDefault();

                  if (result.url !== undefined) openExternal(result.url);
                }}
              >
                {result.url}
              </ButtonLink>
            )}
          </div>
        )}
      </form>
      <div role="group" aria-label="Changes" {...props(styles.changes)}>
        <div {...props(styles.section)}>
          <Checkbox
            aria-label={allChecked ? "Uncheck all files" : "Check all files"}
            checked={allChecked}
            indeterminate={checks.checked.size > 0 && !allChecked}
            disabled={files.length === 0}
            onCheckedChange={() => checks.setAll(!allChecked)}
          />
          <span {...props(text.base, styles.sectionTitle)}>Changes</span>
          <span {...props(text.base, styles.count)}>{files.length}</span>
        </div>
        {files.length === 0 && <p {...props(text.sm, styles.empty)}>No changes</p>}
        <ChangeRows
          files={files}
          checked={checks.checked}
          onCheck={checks.toggle}
          onOpen={(file) => onOpen(absolute(file.path))}
          onDiscard={(file) => {
            setDiscardError(undefined);
            setDiscarding({ file, revision: status.revision });
          }}
        />
      </div>
      {confirmation !== undefined && discarding !== undefined && (
        <ConfirmDialog
          open
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          pendingLabel={confirmation.pendingLabel}
          pending={discardPending}
          error={discardError}
          tint="red"
          onOpenChange={(open) => {
            if (!open) setDiscarding(undefined);
          }}
          onConfirm={() => void discard(discarding.file, discarding.revision)}
        />
      )}
    </div>
  );
}

type DiscardOutcome =
  | { readonly kind: "done" }
  | { readonly kind: "stale"; readonly revision: GitRevision }
  | { readonly kind: "failed"; readonly reason: string };

async function discardFile(
  workspace: WorkspaceId,
  paths: readonly string[],
  staged: boolean,
  revision: GitRevision,
): Promise<DiscardOutcome> {
  try {
    const git = await gitFor(workspace);
    const unstaged = staged ? await git.unstage(paths, { expect: revision }) : undefined;

    if (unstaged !== undefined && unstaged.kind !== "applied" && unstaged.kind !== "unchanged") {
      return refused(unstaged);
    }

    const discarded = await git.discard(paths, {
      expect: unstaged?.kind === "applied" ? unstaged.revision : revision,
    });

    return discarded.kind === "applied" || discarded.kind === "unchanged"
      ? { kind: "done" }
      : refused(discarded);
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : "Couldn’t discard this file.",
    };
  }
}

function refused(
  outcome: Exclude<GitOutcome, { readonly kind: "applied" | "unchanged" }>,
): DiscardOutcome {
  if (outcome.kind === "stale") return outcome;

  if (outcome.kind === "busy") {
    return { kind: "failed", reason: "A run is still writing to this workspace." };
  }

  return { kind: "failed", reason: outcome.reason };
}

function ChangeRows({
  files,
  checked,
  onCheck,
  onOpen,
  onDiscard,
}: {
  readonly files: readonly WorktreeFile[];
  readonly checked: ReadonlySet<string>;
  readonly onCheck: (path: string, checked: boolean) => void;
  readonly onOpen: (file: WorktreeFile) => void;
  readonly onDiscard: (file: WorktreeFile) => void;
}): ReactElement {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [rowHeight] = useState(() => resolveHeight(row.heightMd));

  // oxlint-disable-next-line react/incompatible-library -- the bailout is the intended behaviour
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: files.length,
    getScrollElement: () => viewport,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
  });

  return (
    <div ref={setViewport} {...props(styles.list)}>
      <ul {...props(styles.rows, styles.height(virtualizer.getTotalSize()))}>
        {virtualizer.getVirtualItems().flatMap((item) => {
          const file = files[item.index];

          if (file === undefined) return [];
          const slash = file.path.lastIndexOf("/");
          const name = file.path.slice(slash + 1);
          const folder = slash < 0 ? "" : file.path.slice(0, slash);
          const shown = STATUS[file.kind];

          return [
            <li
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              aria-setsize={files.length}
              aria-posinset={item.index + 1}
              {...props(styles.item, styles.offset(item.start))}
            >
              <Row interactive revealActions>
                <Checkbox
                  aria-label={`Include ${file.path} in the commit`}
                  checked={checked.has(file.path)}
                  onCheckedChange={(on) => onCheck(file.path, on)}
                />
                <Row.Primary
                  title={file.path}
                  disabled={file.kind === "deleted"}
                  onClick={() => onOpen(file)}
                >
                  <Row.Leading>
                    <FileTypeIcon path={file.path} />
                  </Row.Leading>
                  <Row.Label>
                    <span {...props(file.kind === "deleted" && styles.deleted)}>{name}</span>
                    {folder !== "" && <span {...props(text.sm, styles.folder)}>{folder}</span>}
                  </Row.Label>
                </Row.Primary>
                <Row.Actions>
                  <Button
                    size="2xs"
                    variant="plain"
                    iconOnly
                    icon="refresh"
                    aria-label={`Discard changes to ${file.path}`}
                    onClick={() => onDiscard(file)}
                  />
                </Row.Actions>
                <Row.Meta>
                  <span
                    title={shown.label}
                    aria-label={shown.label}
                    {...props(text.sm, surfaceTheme[shown.tint], styles.status)}
                  >
                    {shown.letter}
                  </span>
                </Row.Meta>
              </Row>
            </li>,
          ];
        })}
      </ul>
    </div>
  );
}

const styles = create({
  view: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  notice: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2_5,
    paddingInline: space.s2,
    paddingBlockStart: space.s1,
  },
  noticeText: { margin: 0, paddingInline: space.s2_5, color: role.contentSecondary },
  commit: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1_5,
    flexShrink: 0,
    paddingInline: space.s2,
  },
  branchRow: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  branchField: { flex: 1 },
  primary: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  result: {
    display: "flex",
    flexDirection: "column",
    gap: space.s0_5,
    color: role.contentSecondary,
    textWrap: "pretty",
  },
  changes: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    paddingBlockStart: space.s2_5,
    paddingInline: space.s1_5,
  },
  list: { flex: 1, minHeight: 0, overflowY: "auto" },
  rows: { position: "relative", margin: 0, padding: 0, listStyle: "none" },
  height: (pixels: number) => ({ height: pixels }),
  item: { position: "absolute", insetBlockStart: 0, insetInline: 0 },
  offset: (pixels: number) => ({ transform: `translateY(${String(pixels)}px)` }),
  section: {
    display: "flex",
    alignItems: "center",
    gap: space.s1_5,
    flexShrink: 0,
    minHeight: row.heightMd,
    paddingInline: space.s1,
  },
  sectionTitle: { color: role.contentSecondary, fontWeight: type.weightMedium },
  count: { flex: 1, color: role.contentTertiary, fontVariantNumeric: "tabular-nums" },
  empty: {
    margin: 0,
    paddingBlock: space.s2,
    paddingInline: space.s2_5,
    color: role.contentTertiary,
  },
  deleted: { textDecorationLine: "line-through" },
  folder: {
    marginInlineStart: space.s1_5,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: role.contentTertiary,
  },
  status: {
    flexShrink: 0,
    width: space.s3,
    textAlign: "center",
    fontWeight: type.weightMedium,
    color: role.contentAccent,
  },
});
