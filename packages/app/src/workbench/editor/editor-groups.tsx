import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { DragEvent, ReactElement, ReactNode } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Tabs } from "@nyte-ai/ui/tabs";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { control, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { FileTypeIcon } from "@nyte-ai/ui/file-type-icon";
import { droppedTreeFiles } from "../../references/composer-file-drop.ts";
import type { MentionFile } from "../../data/files.ts";
import { closeTab } from "../commands.ts";
import type { WorkbenchViewKey } from "../model.ts";
import { fileActions } from "./file-store.ts";
import type { FileGroup } from "./file-store.ts";

type Zone = "before" | "center" | "after";

/** The type a dragged group tab carries its id under. */
const TAB_DRAG = "application/x-nyte-file-tab";

/**
 * One editor group. Beside other groups it gets a tab row of its own, since the strip lists the
 * focused group's files alone; a file tab or a tree file dropped on it lands in it, or in a new
 * group beside it near its edges.
 */
export function EditorGroupView({
  viewKey,
  group,
  index,
  many,
  focused,
  children,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly group: FileGroup;
  readonly index: number;
  readonly many: boolean;
  readonly focused: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const [zone, setZone] = useState<Zone>();

  return (
    <section
      aria-label={`Editor group ${String(index + 1)}`}
      data-focused={many && focused ? "" : undefined}
      {...props(styles.group, many && index > 0 && hairline.inlineStart)}
      onPointerDownCapture={() => {
        if (!focused) fileActions.focusGroup(viewKey, group.id);
      }}
    >
      {many && (
        <div {...props(styles.row, hairline.blockEnd, focused && styles.rowFocused)}>
          <Tabs.Root
            value={group.active?.id ?? null}
            xstyle={styles.tabsRoot}
            onValueChange={(id) => {
              const file = group.tabs.find((tab) => tab.id === id);

              if (file === undefined) return;
              fileActions.focusGroup(viewKey, group.id);
              fileActions.open(viewKey, { path: file.path });
            }}
          >
            <Tabs.List aria-label="Open files" xstyle={styles.tabs}>
              {group.tabs.map((file) => {
                const name = file.displayPath.split("/").at(-1) ?? file.displayPath;

                return (
                  <span
                    key={file.id}
                    role="presentation"
                    {...props(styles.tab, file.id === group.active?.id && styles.tabSelected)}
                  >
                    <Tabs.Tab
                      variant="bare"
                      value={file.id}
                      title={file.displayPath}
                      draggable
                      xstyle={styles.tabButton}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(TAB_DRAG, file.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDoubleClick={() => fileActions.pin(viewKey, file.id)}
                      onAuxClick={(event) => {
                        if (event.button === 1) void closeTab(viewKey, file.id);
                      }}
                    >
                      <FileTypeIcon path={file.path} />
                      <span {...props(styles.label, file.preview && styles.preview)}>{name}</span>
                      {file.dirty && <span aria-label="Unsaved changes" {...props(styles.dirty)} />}
                    </Tabs.Tab>
                    <Button
                      size="2xs"
                      variant="plain"
                      iconOnly
                      icon="x"
                      tabIndex={-1}
                      aria-label={`Close ${name}`}
                      onClick={() => void closeTab(viewKey, file.id)}
                    />
                  </span>
                );
              })}
            </Tabs.List>
          </Tabs.Root>
          <Button
            size="2xs"
            iconOnly
            icon="x"
            aria-label="Close Group"
            onClick={() => {
              for (const file of group.tabs) void closeTab(viewKey, file.id);
            }}
          />
        </div>
      )}
      <div
        {...props(styles.body)}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(TAB_DRAG) && droppedTreeFiles(event).length === 0)
            return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setZone(dropZone(event));
        }}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(
              event.relatedTarget instanceof Node ? event.relatedTarget : null,
            )
          )
            setZone(undefined);
        }}
        onDrop={(event) => {
          setZone(undefined);
          const id = event.dataTransfer.getData(TAB_DRAG);
          const tree = droppedTreeFiles(event);

          if (id === "" && tree.length === 0) return;
          event.preventDefault();
          const at = dropZone(event);

          if (id !== "") fileActions.place(viewKey, id, group.id, at);
          else dropTreeFile(viewKey, group, at, tree);
        }}
      >
        {children}
        {zone !== undefined && <div aria-hidden="true" {...props(styles.drop, styles[zone])} />}
      </div>
    </section>
  );
}

function dropTreeFile(
  viewKey: WorkbenchViewKey,
  group: FileGroup,
  zone: Zone,
  files: readonly MentionFile[],
): void {
  const file = files.find((entry) => !entry.displayPath.endsWith("/"));

  if (file !== undefined) fileActions.openBeside(viewKey, file.path, group.id, zone);
}

function dropZone(event: DragEvent<HTMLElement>): Zone {
  const rect = event.currentTarget.getBoundingClientRect();
  const at = (event.clientX - rect.left) / rect.width;
  const start = document.dir === "rtl" ? "after" : "before";
  const end = start === "before" ? "after" : "before";

  return at < 0.25 ? start : at > 0.75 ? end : "center";
}

const styles = create({
  group: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    flexShrink: 0,
    height: control.heightMd,
    paddingInline: space.s1,
    color: role.contentSecondary,
  },
  rowFocused: { color: role.contentPrimary },
  tabs: {
    display: "flex",
    alignItems: "center",
    gap: space.px,
    flex: 1,
    minWidth: 0,
    overflowX: "auto",
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    flexShrink: 0,
    maxWidth: 200,
    paddingInlineStart: space.s1_5,
    borderRadius: radius.control,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    cursor: "default",
    userSelect: "none",
  },
  tabSelected: { backgroundColor: role.bgMutedTranslucent, color: role.contentPrimary },
  label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  preview: { fontStyle: "italic" },
  dirty: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: "50%",
    backgroundColor: role.contentAccent,
  },
  tabsRoot: { flex: 1, minWidth: 0 },
  tabButton: { display: "inline-flex", alignItems: "center", gap: space.s1, minWidth: 0 },
  body: { position: "relative", display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  drop: {
    position: "absolute",
    insetBlock: 0,
    zIndex: 3,
    pointerEvents: "none",
    backgroundColor: role.bgMutedTranslucent,
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineOffset: -2,
    outlineColor: role.contentAccent,
    borderRadius: radius.control,
  },
  before: { insetInlineStart: 0, width: "50%" },
  center: { insetInline: 0 },
  after: { insetInlineEnd: 0, width: "50%" },
});
