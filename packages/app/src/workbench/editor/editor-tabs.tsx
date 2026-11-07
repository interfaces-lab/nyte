import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { DragEvent, ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@nyte-ai/ui/context-menu";
import { FileTypeIcon } from "@nyte-ai/ui/file-type-icon";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Tabs } from "@nyte-ai/ui/tabs";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { control, media, radius, space, target } from "@nyte-ai/ui/styles/schema.stylex";
import { appearance, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { MOVE_SHORTCUTS, readMoveStep } from "../../components/sortable-strip.tsx";
import { nyte } from "../../contract/nyte.ts";
import type { EditorGroupId, WorkbenchTabId, WorkbenchViewKey } from "../model.ts";
import { workbench } from "../store.ts";
import { carriesEditorDrop, FILE_TAB_DRAG, readEditorDrop } from "./editor-drop.ts";
import { fileActions } from "./file-store.ts";
import type { FileGroup } from "./file-store.ts";
import { FileTabMenuItems } from "./file-tab-menu.tsx";

export function EditorTabs(input: {
  readonly viewKey: WorkbenchViewKey;
  readonly group: FileGroup;
  readonly index: number;
  readonly focused: boolean;
  readonly many: boolean;
  readonly onClose: (id: WorkbenchTabId) => void;
  readonly onCloseGroup: (group: EditorGroupId) => void;
}): ReactElement {
  const track = useRef<HTMLDivElement>(null);
  const [insertion, setInsertion] = useState<{ readonly before: WorkbenchTabId | null }>();
  const group = input.group;
  const selected = group.active?.id;

  const focusTab = (id: WorkbenchTabId): void => {
    workbench.dispatch(input.viewKey, { kind: "activate", id });
    requestAnimationFrame(() => {
      const tab = document.getElementById(`${input.viewKey}-file-tab-${id}`);
      tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
      tab?.focus();
    });
  };

  const beforeTab = (event: DragEvent<HTMLElement>): WorkbenchTabId | null => {
    const list = track.current;

    if (list === null) return null;
    const rect = list.getBoundingClientRect();
    const step = list.clientHeight;
    list.scrollBy({
      left: event.clientX < rect.left + step ? -step : event.clientX > rect.right - step ? step : 0,
    });
    const rtl = getComputedStyle(list).direction === "rtl";

    for (const tab of list.querySelectorAll<HTMLElement>("[data-editor-file]")) {
      const bounds = tab.getBoundingClientRect();
      const middle = bounds.left + bounds.width / 2;

      if (rtl ? event.clientX > middle : event.clientX < middle)
        return tab.dataset.editorFile ?? null;
    }

    return null;
  };

  return (
    <div
      id={`${input.viewKey}-file-tabs-${group.id}`}
      data-editor-tabs=""
      data-focused={input.focused ? "" : undefined}
      {...props(styles.row, input.many && input.index > 0 && hairline.inlineStart)}
      onPointerDownCapture={() => {
        if (!input.focused) fileActions.focusGroup(input.viewKey, group.id);
      }}
      onFocusCapture={() => {
        if (!input.focused) fileActions.focusGroup(input.viewKey, group.id);
      }}
      onDragOver={(event) => {
        if (!carriesEditorDrop(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setInsertion({ before: beforeTab(event) });
      }}
      onDragLeave={(event) => {
        if (
          !event.currentTarget.contains(
            event.relatedTarget instanceof Node ? event.relatedTarget : null,
          )
        )
          setInsertion(undefined);
      }}
      onDrop={(event) => {
        setInsertion(undefined);
        const source = readEditorDrop(event);

        if (source === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        fileActions.place(input.viewKey, source, {
          kind: "tabs",
          group: group.id,
          before: beforeTab(event),
        });
        const active = workbench.getView(input.viewKey).active;

        if (active !== null) focusTab(active);
      }}
    >
      {input.many && input.focused && <span aria-hidden="true" {...props(styles.focused)} />}
      <Tabs.Root
        value={selected ?? null}
        xstyle={styles.root}
        onValueChange={(id) => workbench.dispatch(input.viewKey, { kind: "activate", id })}
      >
        <Tabs.List
          ref={track}
          aria-label={`Editor group ${String(input.index + 1)} files${input.focused ? ", focused" : ""}`}
          xstyle={styles.tabs}
        >
          {group.tabs.map((file, index) => {
            const name = file.displayPath.split(/[\\/]/).at(-1) ?? file.displayPath;
            const active = file.id === selected;

            return (
              <ContextMenu key={file.id}>
                <ContextMenuTrigger
                  render={
                    <span
                      role="presentation"
                      data-editor-file={file.id}
                      {...props(
                        styles.item,
                        active && styles.selected,
                        insertion?.before === file.id && styles.insertBefore,
                      )}
                    >
                      <Tabs.Tab
                        variant="bare"
                        id={`${input.viewKey}-file-tab-${file.id}`}
                        value={file.id}
                        aria-controls={`${input.viewKey}-file-panel-${file.id}`}
                        aria-label={`${file.displayPath}${file.dirty ? ", unsaved changes" : ""}`}
                        title={file.displayPath}
                        draggable
                        xstyle={styles.tab}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(FILE_TAB_DRAG, file.id);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => setInsertion(undefined)}
                        onDoubleClick={() => fileActions.pin(input.viewKey, file.id)}
                        onAuxClick={(event) => {
                          if (event.button !== 1) return;
                          event.preventDefault();
                          input.onClose(file.id);
                        }}
                        onFocus={(event) =>
                          event.currentTarget.scrollIntoView({
                            block: "nearest",
                            inline: "nearest",
                          })
                        }
                        aria-keyshortcuts={MOVE_SHORTCUTS}
                        onKeyDown={(event) => {
                          if (event.key === "Delete") {
                            event.preventDefault();
                            input.onClose(file.id);

                            return;
                          }

                          const direction = readMoveStep(event);

                          if (direction === 0) return;

                          const step =
                            getComputedStyle(event.currentTarget).direction === "rtl"
                              ? -direction
                              : direction;

                          if (group.tabs[index + step] === undefined) return;
                          event.preventDefault();
                          fileActions.place(
                            input.viewKey,
                            { kind: "tab", id: file.id },
                            {
                              kind: "tabs",
                              group: group.id,
                              before:
                                step < 0
                                  ? (group.tabs[index - 1]?.id ?? null)
                                  : (group.tabs[index + 2]?.id ?? null),
                            },
                          );
                          requestAnimationFrame(() =>
                            document
                              .getElementById(`${input.viewKey}-file-tab-${file.id}`)
                              ?.focus(),
                          );
                        }}
                      >
                        <FileTypeIcon path={file.path} />
                        <span {...props(styles.label, file.preview && styles.preview)}>{name}</span>
                        {file.dirty && (
                          <span aria-hidden="true" {...props(surfaceTheme.yellow, styles.dirty)} />
                        )}
                      </Tabs.Tab>
                      <span {...props(styles.close)}>
                        <Button
                          size="2xs"
                          variant="plain"
                          iconOnly
                          icon="x"
                          tabIndex={active ? 0 : -1}
                          aria-label={`Close ${file.displayPath}`}
                          onClick={() => input.onClose(file.id)}
                        />
                      </span>
                    </span>
                  }
                />
                <ContextMenuContent aria-label={`${name} actions`}>
                  <FileTabMenuItems
                    viewKey={input.viewKey}
                    file={file}
                    onClose={() => input.onClose(file.id)}
                    onCloseOthers={() => {
                      for (const other of group.tabs)
                        if (other.id !== file.id && !other.dirty && !other.saving)
                          fileActions.close(input.viewKey, other.id);
                      focusTab(file.id);
                    }}
                  />
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          {insertion?.before === null && <span aria-hidden="true" {...props(styles.insertEnd)} />}
          {group.tabs.length === 0 && <span {...props(styles.empty)}>No open files</span>}
        </Tabs.List>
      </Tabs.Root>
      <span {...props(styles.actions)}>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="sm"
                iconOnly
                icon="chevron-down"
                aria-label={`Open files in group ${String(input.index + 1)}`}
                title="Open files"
                disabled={group.tabs.length === 0}
              />
            }
          />
          <MenuContent align="end">
            {group.tabs.map((file) => (
              <MenuItem
                key={file.id}
                icon={file.id === selected ? "checkmark" : undefined}
                aria-current={file.id === selected ? "true" : undefined}
                onClick={() => focusTab(file.id)}
              >
                <span {...props(styles.path)}>{file.displayPath}</span>
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        <Button
          size="sm"
          iconOnly
          icon="split-right"
          aria-label="Split Editor Right"
          title={`Split Editor Right (${nyte.platform === "darwin" ? "⌘\\" : "Ctrl+\\"})`}
          disabled={group.active === undefined}
          onClick={() => {
            if (group.active !== undefined)
              fileActions.split(input.viewKey, "after", group.active.id);
          }}
        />
        {input.many && (
          <Button
            size="sm"
            iconOnly
            icon="x"
            aria-label="Close Group"
            onClick={() => input.onCloseGroup(group.id)}
          />
        )}
      </span>
    </div>
  );
}

const styles = create({
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    flex: 1,
    minWidth: 0,
    height: control.heightXl,
    paddingInline: space.s1,
    color: role.contentSecondary,
  },
  focused: {
    position: "absolute",
    insetBlockStart: 0,
    insetInline: 0,
    height: space.s0_5,
    backgroundColor: appearance.focusColor,
    pointerEvents: "none",
  },
  root: { flex: 1, minWidth: 0 },
  tabs: {
    display: "flex",
    alignItems: "center",
    gap: space.px,
    minWidth: 0,
    overflowX: "auto",
    scrollbarWidth: "none",
  },
  item: {
    "--_file-close-opacity": {
      default: "0",
      ":hover": { [media.hover]: "1" },
      ":has(:focus-visible)": "1",
      "@media (hover: none)": "1",
    },
    "--_file-close-events": {
      default: "none",
      ":hover": { [media.hover]: "auto" },
      ":has(:focus-visible)": "auto",
      "@media (hover: none)": "auto",
    },
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    maxWidth: 200,
    height: control.heightSm,
    minHeight: target.min,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": { [media.hover]: role.fillTertiary } },
    color: { default: role.contentSecondary, ":hover": { [media.hover]: role.contentPrimary } },
  },
  selected: { backgroundColor: role.fillSecondary, color: role.contentPrimary },
  tab: {
    backgroundColor: {
      default: "transparent",
      "[data-active]": { default: "transparent", [media.forcedColors]: "SelectedItem" },
    },
    color: {
      default: "inherit",
      "[data-active]": { default: "inherit", [media.forcedColors]: "SelectedItemText" },
    },
    forcedColorAdjust: { default: null, "[data-active]": "none" },
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1_5,
    minWidth: 0,
    height: "100%",
    paddingBlock: space.s0_5,
    paddingInline: space.s1,
    borderRadius: radius.control,
    fontFamily: type.fontSans,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    letterSpacing: type.letterBase,
    cursor: appearance.cursorInteractive,
    whiteSpace: "nowrap",
  },
  label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  preview: { fontStyle: "italic" },
  dirty: {
    width: space.s1_5,
    height: space.s1_5,
    flexShrink: 0,
    borderRadius: radius.pill,
    backgroundColor: role.contentAccent,
  },
  close: {
    display: "flex",
    flexShrink: 0,
    opacity: "var(--_file-close-opacity)",
    pointerEvents: "var(--_file-close-events)",
  },
  actions: { display: "flex", flexShrink: 0, gap: space.s0_5 },
  empty: { paddingInline: space.s1, fontSize: type.fontSm, lineHeight: type.leadingSm },
  path: { whiteSpace: "normal", overflowWrap: "anywhere" },
  insertBefore: {
    "::before": {
      content: '""',
      position: "absolute",
      insetInlineStart: 0,
      insetBlock: 0,
      width: space.s0_5,
      backgroundColor: appearance.focusColor,
      pointerEvents: "none",
    },
  },
  insertEnd: {
    width: space.s0_5,
    height: control.heightSm,
    flexShrink: 0,
    backgroundColor: appearance.focusColor,
  },
});
