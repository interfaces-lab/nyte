import { intent } from "@nyte-ai/ui/surface-theme";
/**
 * The Diff tab: the file tree beside one virtualized CodeView stack that
 * wears the same header, reviewed state and selection action as the Guide.
 */
import { create, props } from "@stylexjs/stylex";
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
import { role, type } from "@nyte-ai/ui/vars.stylex";
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

export function DiffStack(componentProps: DiffStackProps): ReactElement {
  const options = usePierreOptions(componentProps.layout);
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const [itemsFor] = useState(createItemCache);
  const [treeVisible, setTreeVisible] = useState(true);
  const [active, setActive] = useState<string | undefined>(undefined);
  const selection = useRef<CodeViewLineSelection | null>(null);
  const files = [...componentProps.files].toSorted((a, b) => a.path.localeCompare(b.path));
  const items = itemsFor(files, componentProps.collapsed);
  const implementation = componentProps.files.filter((file) => file.category === "implementation");
  const sum = (list: readonly ReviewFile[], key: "added" | "removed"): number =>
    list.reduce((total, file) => total + file[key], 0);
  const picked = componentProps.commits.find((entry) => entry.oid === componentProps.commit);

  useEffect(() => {
    if (componentProps.focus.revision === 0 || componentProps.focus.path === undefined) return;
    viewer.current?.scrollTo({
      type: "item",
      id: componentProps.focus.path,
      align: "start",
      behavior: "instant",
    });
  }, [componentProps.focus]);

  return (
    <div {...props(styles.panel)}>
      <FileTypeIconSprite />
      <div {...props(workbenchStyles.toolbar)}>
        <Menu
          label="Commits"
          trigger={<Button icon="git">{picked === undefined ? "All commits" : picked.oid}</Button>}
        >
          <MenuRadioGroup
            value={componentProps.commit ?? "all"}
            onValueChange={(value) =>
              componentProps.onCommit(value === "all" ? undefined : String(value))
            }
          >
            <MenuRadioItem value="all" icon="git-branch">
              All commits
            </MenuRadioItem>
            {componentProps.commits.map((entry) => (
              <MenuRadioItem key={entry.oid} value={entry.oid} icon="git" meta={entry.oid}>
                {entry.subject}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </Menu>
        <Hint
          content={`${sum(componentProps.files, "added")} added, ${sum(componentProps.files, "removed")} removed in all files`}
          trigger={
            <span {...props(styles.count)}>
              <span {...props([intent.success, styles.added])}>
                +{sum(implementation, "added")}
              </span>
              <span {...props([intent.danger, styles.removed])}>
                −{sum(implementation, "removed")}
              </span>
              {implementation.length !== componentProps.files.length && <span>*</span>}
            </span>
          }
        />
        <span {...props(styles.spacer)} />
        <Toggle
          iconOnly
          indicator="glyph"
          aria-label="Split view"
          pressed={componentProps.layout === "split"}
          onPressedChange={(pressed) => componentProps.onLayout(pressed ? "split" : "unified")}
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
      <div {...props(styles.body)}>
        <ChangesSidebar
          files={files.map((file) => ({
            path: file.path,
            status: "modified" as const,
            added: file.added,
            removed: file.removed,
            viewed:
              componentProps.reviewed(file.path) === "reviewed"
                ? "viewed"
                : componentProps.reviewed(file.path) === "changed"
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
          onAllViewedChange={componentProps.onReviewed}
        />
        <PierreWorkerProvider>
          <CodeView
            ref={viewer}
            items={items}
            options={{ ...options, stickyHeaders: true }}
            className={props(styles.stack, pierreHost).className}
            onSelectedLinesChange={(next) => {
              selection.current = next;
            }}
            renderCustomHeader={(item) => {
              const file = componentProps.files.find((entry) => entry.path === item.id);

              if (file === undefined) return null;

              return (
                <CodeFileHeader
                  file={file}
                  collapsed={componentProps.collapsed(file.path)}
                  reviewed={componentProps.reviewed(file.path)}
                  justUpdated={componentProps.justUpdated(file.path)}
                  onToggle={() => componentProps.onToggle(file.path)}
                  onReviewed={(next) => componentProps.onReviewed([file.path], next)}
                />
              );
            }}
            renderGutterUtility={(hovered, item) => (
              <AddToChat
                onAdd={() => {
                  const file = componentProps.files.find((entry) => entry.path === item.id);
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
                    componentProps.onReference(referenceOf(file, range));
                }}
              />
            )}
          />
        </PierreWorkerProvider>
      </div>
    </div>
  );
}

const styles = create({
  panel: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  body: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  stack: { flex: 1, width: "100%", height: "100%", minWidth: 0, minHeight: 0, overflow: "auto" },
  spacer: { flex: 1 },
  count: {
    display: "inline-flex",
    gap: 6,
    paddingInline: 6,
    color: role.contentSecondary,
    fontFamily: type.fontMono,
    fontSize: 11.5,
  },
  added: { color: role.contentSecondary },
  removed: { color: role.contentSecondary },
});
