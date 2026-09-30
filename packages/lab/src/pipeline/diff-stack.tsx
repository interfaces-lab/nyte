/**
 * The Diff tab: the file tree beside one virtualized CodeView stack that
 * wears the same header, reviewed state and selection action as the Guide.
 */
import * as stylex from "@stylexjs/stylex";
import { CodeView } from "@pierre/diffs/react";
import type { CodeViewLineSelection } from "@pierre/diffs";
import type { CodeViewHandle, CodeViewItem } from "@pierre/diffs/react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { FileTypeIconSprite } from "@nyte-ai/app/components/file-type-icon.tsx";
import { PierreWorkerProvider } from "@nyte-ai/app/pierre-worker-provider.tsx";
import { ChangesSidebar } from "@nyte-ai/app/workbench/changes-sidebar.tsx";
import { workbenchStyles } from "@nyte-ai/app/workbench/workbench.stylex.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon, PanelToggleIcon } from "@nyte-ai/ui/icon";
import { Menu, MenuRadioGroup, MenuRadioItem } from "@nyte-ai/ui/menu";
import { Toggle } from "@nyte-ai/ui/toggle";
import { Hint } from "@nyte-ai/ui/tooltip";
import { t } from "@nyte-ai/ui/vars.stylex";
import {
  AddToChat,
  CodeFileHeader,
  pierreHost,
  referenceOf,
  usePierreOptions,
  type CodeReference,
  type ReviewedState,
  type ReviewFile,
} from "./code";
import type { Commit } from "./scenario";

export interface DiffStackProps {
  readonly files: readonly ReviewFile[];
  readonly commits: readonly Pick<Commit, "oid" | "subject">[];
  readonly commit: string | undefined;
  readonly onCommit: (oid: string | undefined) => void;
  readonly layout: "unified" | "split";
  readonly onLayout: (layout: "unified" | "split") => void;
  readonly reviewed: (path: string) => ReviewedState;
  readonly onReviewed: (paths: readonly string[], reviewed: boolean) => void;
  readonly collapsed: (path: string) => boolean;
  readonly onToggle: (path: string) => void;
  readonly justUpdated: (path: string) => boolean;
  readonly focus: { readonly path: string | undefined; readonly revision: number };
  readonly onReference: (reference: CodeReference) => void;
}

interface Cached {
  readonly payload: string;
  readonly item: CodeViewItem<undefined>;
}

/** Keeps each Pierre item until its patch or collapse changes, so unchanged files never re-render. */
function createItemCache() {
  const cache = new Map<string, Cached>();

  return (
    files: readonly ReviewFile[],
    collapsed: (path: string) => boolean,
  ): CodeViewItem<undefined>[] =>
    files.flatMap((file): CodeViewItem<undefined>[] => {
      if (file.metadata === undefined) return [];

      const closed = collapsed(file.path);
      const payload = `${file.patch}\u0000${closed ? "c" : "e"}`;
      const cached = cache.get(file.path);

      if (cached?.payload === payload) return [cached.item];

      const item: CodeViewItem<undefined> = {
        id: file.path,
        type: "diff",
        fileDiff: file.metadata,
        collapsed: closed,
        version: (cached?.item.version ?? -1) + 1,
      };
      cache.set(file.path, { payload, item });

      return [item];
    });
}

export function DiffStack(props: DiffStackProps): ReactElement {
  const options = usePierreOptions(props.layout);
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const [itemsFor] = useState(createItemCache);
  const [treeVisible, setTreeVisible] = useState(true);
  const [active, setActive] = useState<string | undefined>(undefined);
  const selection = useRef<CodeViewLineSelection | null>(null);
  const files = [...props.files].toSorted((a, b) => a.path.localeCompare(b.path));
  const items = itemsFor(files, props.collapsed);
  const implementation = props.files.filter((file) => file.category === "implementation");
  const sum = (list: readonly ReviewFile[], key: "added" | "removed"): number =>
    list.reduce((total, file) => total + file[key], 0);
  const picked = props.commits.find((entry) => entry.oid === props.commit);

  useEffect(() => {
    if (props.focus.revision === 0 || props.focus.path === undefined) return;
    viewer.current?.scrollTo({
      type: "item",
      id: props.focus.path,
      align: "start",
      behavior: "instant",
    });
  }, [props.focus]);

  return (
    <div {...stylex.props(styles.panel)}>
      <FileTypeIconSprite />
      <div {...stylex.props(workbenchStyles.toolbar)}>
        <Menu
          label="Commits"
          trigger={<Button icon="git">{picked === undefined ? "All commits" : picked.oid}</Button>}
        >
          <MenuRadioGroup
            value={props.commit ?? "all"}
            onValueChange={(value) => props.onCommit(value === "all" ? undefined : String(value))}
          >
            <MenuRadioItem value="all" icon="git-branch">
              All commits
            </MenuRadioItem>
            {props.commits.map((entry) => (
              <MenuRadioItem key={entry.oid} value={entry.oid} icon="git" meta={entry.oid}>
                {entry.subject}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </Menu>
        <Hint
          content={`${sum(props.files, "added")} added, ${sum(props.files, "removed")} removed in all files`}
          trigger={
            <span {...stylex.props(styles.count)}>
              <span {...stylex.props(styles.added)}>+{sum(implementation, "added")}</span>
              <span {...stylex.props(styles.removed)}>−{sum(implementation, "removed")}</span>
              {implementation.length !== props.files.length && <span>*</span>}
            </span>
          }
        />
        <span {...stylex.props(styles.spacer)} />
        <Toggle
          iconOnly
          indicator="glyph"
          aria-label="Split view"
          pressed={props.layout === "split"}
          onPressedChange={(pressed) => props.onLayout(pressed ? "split" : "unified")}
        >
          <Icon name="split-right" size={16} />
        </Toggle>
        <Toggle
          iconOnly
          indicator="glyph"
          aria-label={treeVisible ? "Hide file tree" : "Show file tree"}
          pressed={treeVisible}
          onPressedChange={() => setTreeVisible(!treeVisible)}
        >
          <PanelToggleIcon side="right" visible={treeVisible} />
        </Toggle>
      </div>
      <div {...stylex.props(styles.body)}>
        <ChangesSidebar
          files={files.map((file) => ({
            path: file.path,
            status: "modified" as const,
            added: file.added,
            removed: file.removed,
            viewed:
              props.reviewed(file.path) === "reviewed"
                ? "viewed"
                : props.reviewed(file.path) === "changed"
                  ? "changed"
                  : "unviewed",
          }))}
          visible={treeVisible}
          activePath={active}
          onRevealPath={(path) => {
            setActive(path);
            viewer.current?.scrollTo({
              type: "item",
              id: path,
              align: "start",
              behavior: "instant",
            });
          }}
          onAllViewedChange={props.onReviewed}
        />
        <PierreWorkerProvider>
          <CodeView
            ref={viewer}
            items={items}
            options={{ ...options, stickyHeaders: true }}
            className={stylex.props(styles.stack, pierreHost).className}
            onSelectedLinesChange={(next) => {
              selection.current = next;
            }}
            renderCustomHeader={(item) => {
              const file = props.files.find((entry) => entry.path === item.id);

              if (file === undefined) return null;

              return (
                <CodeFileHeader
                  file={file}
                  collapsed={props.collapsed(file.path)}
                  reviewed={props.reviewed(file.path)}
                  justUpdated={props.justUpdated(file.path)}
                  onToggle={() => props.onToggle(file.path)}
                  onReviewed={(next) => props.onReviewed([file.path], next)}
                />
              );
            }}
            renderGutterUtility={(hovered, item) => (
              <AddToChat
                onAdd={() => {
                  const file = props.files.find((entry) => entry.path === item.id);
                  const line = hovered();
                  const picked =
                    selection.current?.id === item.id ? selection.current.range : undefined;
                  const range =
                    picked ??
                    (line === undefined
                      ? undefined
                      : "side" in line
                        ? {
                            start: line.lineNumber,
                            end: line.lineNumber,
                            side:
                              line.side === "deletions"
                                ? ("deletions" as const)
                                : ("additions" as const),
                          }
                        : { start: line.lineNumber, end: line.lineNumber });

                  if (file !== undefined && range !== undefined)
                    props.onReference(referenceOf(file, range));
                }}
              />
            )}
          />
        </PierreWorkerProvider>
      </div>
    </div>
  );
}

const styles = stylex.create({
  panel: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  body: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  stack: { flex: 1, width: "100%", height: "100%", minWidth: 0, minHeight: 0, overflow: "auto" },
  spacer: { flex: 1 },
  count: {
    display: "inline-flex",
    gap: 6,
    paddingInline: 6,
    color: t.contentSecondary,
    fontFamily: t.fontMono,
    fontSize: 11.5,
  },
  added: { color: t.intentSuccessContent },
  removed: { color: t.intentDangerContent },
});
