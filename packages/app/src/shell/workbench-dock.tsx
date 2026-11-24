import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { control, layer, media, radius, space, target } from "@nyte-ai/ui/styles/schema.stylex";
import { appearance, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { Tabs } from "@nyte-ai/ui/tabs";
import { create, props } from "@stylexjs/stylex";
import { useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement } from "react";
import type { ClientCapabilities } from "../contract/client-actions.ts";
import {
  closeTab,
  confirmTerminalClose,
  dismissTerminalClose,
  pendingTerminalClose,
} from "../commands/close-tab.ts";
import { launch } from "../commands/launch.ts";
import { useTerminalRuntime } from "../terminal/terminal-store.ts";
import { tab as tabSize } from "../theme/schema.stylex.ts";
import { WORKBENCH_KINDS } from "../workbench/model.ts";
import type {
  WorkbenchScope,
  WorkbenchTab,
  WorkbenchViewKey,
  WorkbenchViewState,
} from "../workbench/model.ts";
import { dockTabs, shownDockTab, tabPresentation } from "../workbench/selectors.ts";
import { workbench } from "../workbench/store.ts";

const MIN_HEIGHT = 120;

const EDITOR_ROOM = 96;

const KEY_STEP = 16;

interface Resize {
  readonly pointerId: number;
  readonly startY: number;
  readonly startHeight: number;
  readonly room: number;
  next: number;
}

/** The panel under a Code window's Editor: terminals, browsers and every other tab that isn't a file. */
export function WorkbenchDock({
  viewKey,
  view,
  scope,
  capabilities,
  renderTab,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly view: WorkbenchViewState;
  readonly scope: WorkbenchScope;
  readonly capabilities: ClientCapabilities;
  readonly renderTab: (tab: WorkbenchTab, visible: boolean) => ReactElement;
}): ReactElement | null {
  const tabs = dockTabs(view, scope, capabilities);
  const shown = shownDockTab(view, scope, capabilities);
  const terminals = useTerminalRuntime();
  const pending = useSyncExternalStore(pendingTerminalClose.subscribe, pendingTerminalClose.read);
  const terminalClose = pending.kind !== "closed" && pending.view === viewKey ? pending : undefined;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const resize = useRef<Resize | undefined>(undefined);
  const [preview, setPreview] = useState<number>();
  const dock = view.dock;
  const height = preview ?? dock.height;

  if (tabs.length === 0) return null;

  const setHeight = (pixels: number): void =>
    workbench.dispatch(viewKey, { kind: "dock", patch: { height: pixels, maximized: false } });

  const beginResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const room = event.currentTarget.parentElement?.parentElement?.clientHeight ?? height;

    event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: event.currentTarget.parentElement?.clientHeight ?? height,
      room,
      next: height,
    };
  };

  const moveResize = (event: PointerEvent<HTMLDivElement>): void => {
    const held = resize.current;

    if (held === undefined || held.pointerId !== event.pointerId) return;
    held.next = clampHeight(held.startHeight + held.startY - event.clientY, held.room);
    setPreview(held.next);
  };

  const endResize = (event: PointerEvent<HTMLDivElement>): void => {
    const held = resize.current;

    if (held === undefined || held.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resize.current = undefined;
    setPreview(undefined);
    setHeight(held.next);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === "ArrowUp" ? KEY_STEP : event.key === "ArrowDown" ? -KEY_STEP : 0;

    if (step === 0) return;
    event.preventDefault();
    const room = event.currentTarget.parentElement?.parentElement?.clientHeight ?? height;
    setHeight(clampHeight(height + step, room));
  };

  const close = (tab: WorkbenchTab, button: HTMLButtonElement): void => {
    closeRef.current = button;
    void closeTab(viewKey, tab.id);
  };

  return (
    <section
      data-workbench-dock=""
      aria-label="Panel"
      hidden={shown === undefined}
      {...props(
        styles.dock,
        hairline.blockStart,
        dock.maximized && preview === undefined ? styles.maximized : styles.height(height),
      )}
    >
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize panel"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(height)}
        title="Drag to resize"
        {...props(styles.sash)}
        onKeyDown={resizeWithKeyboard}
        onPointerDown={beginResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      />
      <div {...props(styles.header)}>
        <Tabs.Root
          value={shown?.id ?? null}
          xstyle={styles.tabsRoot}
          onValueChange={(id) => workbench.dispatch(viewKey, { kind: "activate", id })}
        >
          <Tabs.List aria-label="Panel tabs" xstyle={styles.tabs}>
            {tabs.map((tab) => {
              const terminal = tab.kind === "terminal" ? terminals.get(tab.id) : undefined;
              const presentation = tabPresentation(tab, undefined, terminal);
              const selected = tab.id === shown?.id;

              return (
                <span key={tab.id} {...props(styles.item, selected && styles.selected)}>
                  <Tabs.Tab
                    variant="bare"
                    value={tab.id}
                    title={presentation.title}
                    xstyle={styles.tab}
                  >
                    <Icon name={WORKBENCH_KINDS[tab.kind].icon} size="sm" />
                    <span {...props(styles.label)}>{presentation.label}</span>
                  </Tabs.Tab>
                  <span {...props(styles.close)}>
                    <Button
                      size="2xs"
                      variant="plain"
                      iconOnly
                      icon="x"
                      tabIndex={selected ? 0 : -1}
                      aria-label={`Close ${presentation.label}`}
                      onClick={(event) => close(tab, event.currentTarget)}
                    />
                  </span>
                </span>
              );
            })}
          </Tabs.List>
        </Tabs.Root>
        <Button
          size="sm"
          iconOnly
          icon="plus"
          aria-label="New Terminal"
          onClick={() => launch(viewKey, "terminal")}
        />
        <span {...props(styles.actions)}>
          <Button
            size="sm"
            iconOnly
            icon={dock.maximized ? "minimize" : "expand"}
            aria-label={dock.maximized ? "Restore Panel" : "Maximize Panel"}
            onClick={() =>
              workbench.dispatch(viewKey, { kind: "dock", patch: { maximized: !dock.maximized } })
            }
          />
          <Button
            size="sm"
            iconOnly
            icon="chevron-down"
            aria-label="Hide Panel"
            onClick={() => workbench.dispatch(viewKey, { kind: "dock", patch: { open: false } })}
          />
        </span>
      </div>
      <div {...props(styles.body)}>{tabs.map((tab) => renderTab(tab, tab.id === shown?.id))}</div>
      <ConfirmDialog
        open={terminalClose !== undefined}
        pending={terminalClose?.kind === "closing"}
        error={terminalClose?.kind === "confirming" ? terminalClose.error : undefined}
        finalFocus={closeRef}
        title="Close Terminal"
        description="This ends this shell session and any processes running in it."
        confirmLabel="Close Terminal"
        pendingLabel="Closing…"
        onOpenChange={dismissTerminalClose}
        onConfirm={() => void confirmTerminalClose()}
      />
    </section>
  );
}

function clampHeight(pixels: number, room: number): number {
  return Math.max(MIN_HEIGHT, Math.min(pixels, room - EDITOR_ROOM));
}

const styles = create({
  dock: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minHeight: MIN_HEIGHT,
    backgroundColor: role.bgBase,
  },
  height: (pixels: number) => ({
    height: `min(${String(pixels)}px, calc(100% - ${String(EDITOR_ROOM)}px))`,
  }),
  maximized: { height: "100%" },
  sash: {
    position: "absolute",
    zIndex: layer.sash,
    insetInline: 0,
    insetBlockStart: `calc(${space.s1} * -1)`,
    height: space.s2,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: -1,
    cursor: "row-resize",
    touchAction: "none",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    flexShrink: 0,
    height: control.heightXl,
    paddingInline: space.s1,
    color: role.contentSecondary,
  },
  tabsRoot: { flex: "0 1 auto", minWidth: 0 },
  tabs: { display: "flex", alignItems: "center", gap: space.px, minWidth: 0, overflowX: "clip" },
  item: {
    "--_dock-close-opacity": {
      default: "0",
      ":hover": { [media.hover]: "1" },
      ":has(:focus-visible)": "1",
      "@media (hover: none)": "1",
    },
    display: "inline-flex",
    alignItems: "center",
    minWidth: tabSize.minWidth,
    maxWidth: 200,
    height: control.heightSm,
    minHeight: target.min,
    borderRadius: radius.control,
    backgroundColor: { default: "transparent", ":hover": { [media.hover]: role.fillTertiary } },
    color: { default: role.contentSecondary, ":hover": { [media.hover]: role.contentPrimary } },
  },
  selected: {
    flexShrink: 0,
    backgroundColor: role.fillSecondary,
    color: role.contentPrimary,
    "--_dock-close-opacity": "1",
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1_5,
    minWidth: 0,
    height: "100%",
    paddingInline: space.s1,
    borderRadius: radius.control,
    backgroundColor: "transparent",
    color: "inherit",
    fontFamily: type.fontSans,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    cursor: appearance.cursorInteractive,
    whiteSpace: "nowrap",
  },
  label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  close: { display: "flex", flexShrink: 0, opacity: "var(--_dock-close-opacity)" },
  actions: { display: "flex", alignItems: "center", gap: space.s0_5, marginInlineStart: "auto" },
  body: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
});
