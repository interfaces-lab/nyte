/** Local Git changes. GitHub state never participates in this query path. */
import { Tabs } from "@nyte-ai/ui/primitives";
import * as stylex from "@stylexjs/stylex";
import { useMemo, useRef } from "react";
import type { ReactElement } from "react";
import type { FileChange, SessionId, VcsStatus } from "@nyte-ai/core";
import { FileTypeIcon, FileTypeIconSprite } from "../components/file-type-icon";
import { focus } from "../components/ui";
import { DiffView } from "../conversation/diff-view";
import { useRunChanges, useVcsDiff, useVcsSnapshot } from "../queries.ts";
import type { VcsDiffIdentity } from "../queries.ts";
import { workbench } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { parseCachedDiff } from "./diff-cache.ts";

type StatusFile = VcsStatus["files"][number];

interface ChangeRow {
  readonly path: string;
  readonly kind: StatusFile["kind"];
  readonly inWorkingTree: boolean;
  readonly declared: FileChange | undefined;
}

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: t.bgBase,
  },
  body: { display: "flex", flex: 1, minHeight: 0, minWidth: 0 },
  files: {
    order: 1,
    width: workbench.fileListWidth,
    flexShrink: 0,
    minHeight: 0,
    overflowY: "auto",
    padding: 5,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: t.borderSubtle,
    backgroundColor: t.bgSubtle,
  },
  filesHidden: { display: "none" },
  file: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    minHeight: 26,
    paddingInline: 6,
    borderRadius: t.radiusBase,
    borderStyle: "none",
    backgroundColor: { default: "transparent", ":hover": t.fillGhostHover },
    color: t.textSecondary,
    fontSize: t.fontSm,
    textAlign: "left",
    cursor: "pointer",
  },
  fileSelected: { backgroundColor: t.fillGhostSelected, color: t.textPrimary },
  status: {
    width: 10,
    flexShrink: 0,
    color: t.textTertiary,
    fontFamily: t.fontMono,
    fontSize: t.fontCode,
    textAlign: "center",
  },
  addedStatus: { color: t.textSuccess },
  modifiedStatus: { color: t.textWarning },
  removedStatus: { color: t.textDanger },
  filePath: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  fileStat: {
    display: "inline-flex",
    gap: 3,
    flexShrink: 0,
    fontSize: t.fontXs,
    fontVariantNumeric: "tabular-nums",
  },
  added: { color: t.textSuccess },
  removed: { color: t.textDanger },
  preview: { flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", padding: 8 },
  empty: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 0,
    padding: 20,
    color: t.textTertiary,
    fontSize: t.fontSm,
    textAlign: "center",
  },
  notice: {
    padding: 10,
    borderRadius: t.radiusLg,
    backgroundColor: t.bgFaint,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  raw: {
    margin: 0,
    padding: 10,
    borderRadius: t.radiusLg,
    backgroundColor: t.bgEditor,
    color: t.textSecondary,
    fontFamily: t.fontMono,
    fontSize: t.fontCode,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
});

function statusLetter(kind: StatusFile["kind"]): string {
  switch (kind) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "untracked":
      return "?";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function queryError(...errors: readonly (Error | null)[]): string | undefined {
  const error = errors.find((candidate) => candidate !== null);
  if (error === undefined) return undefined;
  const message = error.message;
  return message.length > 160 ? `${message.slice(0, 159)}…` : message;
}

export function changeRows(
  status: VcsStatus | undefined,
  declared: readonly FileChange[],
): readonly ChangeRow[] {
  const declaredByPath = new Map(declared.map((change) => [change.path, change]));
  const rows = (status?.files ?? []).map((file): ChangeRow => ({
    ...file,
    inWorkingTree: true,
    declared: declaredByPath.get(file.path),
  }));
  const workingPaths = new Set(rows.map((row) => row.path));
  for (const change of declared) {
    if (!workingPaths.has(change.path)) {
      rows.push({ path: change.path, kind: "modified", inWorkingTree: false, declared: change });
    }
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

export interface ChangesPanelProps {
  readonly sessionId: SessionId | undefined;
  readonly selectedPath: string | undefined;
  readonly scrollTop: number;
  readonly fileTreeVisible: boolean;
  readonly onSelectPath: (path: string | undefined) => void;
  readonly onScrollTop: (scrollTop: number) => void;
}

export function ChangesPanel({
  sessionId,
  selectedPath,
  scrollTop,
  fileTreeVisible,
  onSelectPath,
  onScrollTop,
}: ChangesPanelProps): ReactElement {
  const declared = useRunChanges(sessionId);
  const snapshot = useVcsSnapshot(true);
  const status = snapshot.data?.status;
  const rows = useMemo(() => changeRows(status, declared.data ?? []), [declared.data, status]);
  const activePath = rows.some((row) => row.path === selectedPath) ? selectedPath : rows[0]?.path;
  const active = rows.find((row) => row.path === activePath);
  const identity: VcsDiffIdentity | undefined =
    snapshot.data?.kind === "repository" && active?.inWorkingTree === true
      ? {
          repositoryId: snapshot.data.repositoryId,
          revision: snapshot.data.revision,
          path: active.path,
        }
      : undefined;
  const diff = useVcsDiff(identity, true);
  const parsed =
    diff.data === undefined || identity === undefined
      ? undefined
      : parseCachedDiff(identity, diff.data.patch);
  const unavailable = queryError(snapshot.error, declared.error);
  // The saved offset belongs to the file it was read at, so it is restored once,
  // when that file's panel mounts. Every other panel mounts scrolled to the top.
  const restore = useRef<
    { readonly path: string | undefined; readonly scrollTop: number } | undefined
  >({
    path: selectedPath,
    scrollTop,
  });
  const restorePreviewScroll = (preview: HTMLDivElement | null): void => {
    const pending = restore.current;
    if (preview === null || pending === undefined || pending.path !== activePath) return;
    restore.current = undefined;
    preview.scrollTop = pending.scrollTop;
  };

  return (
    <section {...stylex.props(styles.panel)} aria-label="Workspace changes">
      <FileTypeIconSprite />
      {rows.length === 0 ? (
        <div
          role={unavailable === undefined ? "status" : "alert"}
          title={unavailable}
          {...stylex.props(styles.empty)}
        >
          {unavailable !== undefined
            ? "Couldn't read changes. Check that this folder is a Git repository."
            : snapshot.isLoading || declared.isLoading
              ? "Reading changes…"
              : "Working tree is clean"}
        </div>
      ) : (
        <Tabs.Root
          orientation="vertical"
          value={activePath}
          {...stylex.props(styles.body)}
          onValueChange={(value) => {
            const row = rows.find((candidate) => candidate.path === value);
            if (row !== undefined) onSelectPath(row.path);
          }}
        >
          <Tabs.List
            data-nyte-scrollport
            {...stylex.props(styles.files, !fileTreeVisible && styles.filesHidden)}
          >
            {rows.map((row) => (
              <Tabs.Tab
                key={row.path}
                value={row.path}
                title={row.path}
                {...stylex.props(
                  styles.file,
                  focus.ringInset,
                  row.path === activePath && styles.fileSelected,
                )}
              >
                <FileTypeIcon path={row.path} />
                <span {...stylex.props(styles.filePath)}>{row.path.split("/").at(-1)}</span>
                {row.declared !== undefined && (
                  <span {...stylex.props(styles.fileStat)}>
                    {row.declared.added > 0 && (
                      <span {...stylex.props(styles.added)}>+{row.declared.added}</span>
                    )}
                    {row.declared.removed > 0 && (
                      <span {...stylex.props(styles.removed)}>-{row.declared.removed}</span>
                    )}
                  </span>
                )}
                <span
                  aria-label={row.kind}
                  {...stylex.props(
                    styles.status,
                    (row.kind === "added" || row.kind === "untracked") && styles.addedStatus,
                    row.kind === "modified" && styles.modifiedStatus,
                    row.kind === "deleted" && styles.removedStatus,
                  )}
                >
                  {statusLetter(row.kind)}
                </span>
              </Tabs.Tab>
            ))}
          </Tabs.List>
          {rows.map((row) => (
            <Tabs.Panel
              key={row.path}
              ref={row.path === activePath ? restorePreviewScroll : undefined}
              value={row.path}
              data-nyte-scrollport="balanced"
              {...stylex.props(styles.preview)}
              onScroll={(event) => onScrollTop(event.currentTarget.scrollTop)}
            >
              {row.path === activePath &&
                (active?.inWorkingTree === false ? (
                  <div {...stylex.props(styles.notice)}>
                    This file changed during the conversation but is no longer different in the
                    working tree.
                  </div>
                ) : diff.isLoading ? (
                  <div {...stylex.props(styles.notice)}>Loading patch…</div>
                ) : diff.isError ? (
                  <div {...stylex.props(styles.notice)}>The patch could not be read.</div>
                ) : parsed !== undefined && activePath !== undefined ? (
                  <DiffView path={activePath} diff={parsed} variant="workbench" />
                ) : diff.data !== undefined && diff.data.patch.trim() !== "" ? (
                  <pre {...stylex.props(styles.raw)}>{diff.data.patch}</pre>
                ) : (
                  <div {...stylex.props(styles.notice)}>
                    No text diff is available for this file.
                  </div>
                ))}
            </Tabs.Panel>
          ))}
        </Tabs.Root>
      )}
    </section>
  );
}
