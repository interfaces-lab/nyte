import { props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@nyte-ai/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@nyte-ai/ui/context-menu";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Tabs } from "@nyte-ai/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { SortableItem, SortableList } from "../components/sortable-strip.tsx";
import { useMountEffect } from "../use-mount-effect.ts";
import { stripStyles } from "./window-tab-strip.stylex.ts";

export type WindowTabSplit = "right" | "down";

export interface WindowTabItem {
  readonly id: string;
  /** The focused place's title. */
  readonly title: string;
  /** Hover text: the title, or both pane titles of a split. */
  readonly tooltip: string;
  /** Status mark or place icon; undefined shows none. */
  readonly glyph: ReactNode;
  /** A chat in this background tab finished since it was last seen. */
  readonly unread: boolean;
  readonly split: WindowTabSplit | undefined;
}

export interface WindowTabStripProps {
  readonly tabs: readonly WindowTabItem[];
  readonly activeTabId: string;
  /** ⌘ keycaps on macOS, Ctrl elsewhere. */
  readonly mac: boolean;
  readonly onActivate: (tabId: string) => void;
  readonly onClose: (tabId: string) => void;
  readonly onNewTab: () => void;
  /** The full new order of every tab id. */
  readonly onReorder: (tabIds: readonly string[]) => void;
  readonly onDuplicate: (tabId: string) => void;
  readonly onCloseOthers: (tabId: string) => void;
  readonly onCloseToRight: (tabId: string) => void;
}

interface HeldKeys {
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly digit: string | undefined;
}

const RELEASED: HeldKeys = { meta: false, ctrl: false, digit: undefined };

/** The modifier lights while held and the digit while pressed, so the tooltip answers the hand. */
function useHeldKeys(): HeldKeys {
  const [held, setHeld] = useState<HeldKeys>(RELEASED);

  useMountEffect(() => {
    const read = (event: KeyboardEvent): void => {
      setHeld({
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        digit: event.type === "keydown" ? /^Digit([1-9])$/.exec(event.code)?.[1] : undefined,
      });
    };

    const clear = (): void => setHeld(RELEASED);

    window.addEventListener("keydown", read);
    window.addEventListener("keyup", read);
    window.addEventListener("blur", clear);

    return () => {
      window.removeEventListener("keydown", read);
      window.removeEventListener("keyup", read);
      window.removeEventListener("blur", clear);
    };
  });

  return held;
}

function TabItem({
  tab,
  position,
  active,
  closable,
  othersClosable,
  rightClosable,
  held,
  strip,
}: {
  readonly tab: WindowTabItem;
  readonly position: number;
  readonly active: boolean;
  readonly closable: boolean;
  readonly othersClosable: boolean;
  readonly rightClosable: boolean;
  readonly held: HeldKeys;
  readonly strip: WindowTabStripProps;
}): ReactElement {
  const digit = position < 9 ? String(position + 1) : undefined;
  const shortcut = (key: string): string => (strip.mac ? `⌘${key}` : `Ctrl+${key}`);
  const modifierHeld = strip.mac ? held.meta : held.ctrl;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            role="presentation"
            {...props(
              stripStyles.tab,
              closable && stripStyles.tabClosable,
              active && stripStyles.tabActive,
            )}
            onMouseDown={(event) => {
              // Middle-click closes; stop the browser's autoscroll from starting first.
              if (event.button === 1) event.preventDefault();
            }}
            onAuxClick={(event) => {
              if (event.button === 1) strip.onClose(tab.id);
            }}
          />
        }
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Tabs.Tab
                value={tab.id}
                aria-label={tab.unread ? `${tab.tooltip}, unread` : tab.tooltip}
                xstyle={[stripStyles.tabButton, !closable && stripStyles.tabButtonUnclosable]}
              />
            }
          >
            <span {...props(stripStyles.glyph)}>{tab.glyph}</span>
            <span {...props(stripStyles.label)}>{tab.title}</span>
            {tab.split !== undefined && (
              <span {...props(stripStyles.splitMark)}>
                <Icon name={tab.split === "down" ? "split-down" : "split-right"} size={12} />
              </span>
            )}
            {tab.unread && <span aria-hidden="true" {...props(stripStyles.unread)} />}
          </TooltipTrigger>
          <TooltipContent>
            <span {...props(stripStyles.shortcut)}>
              {tab.tooltip}
              {digit !== undefined && (
                <span {...props(stripStyles.keys)}>
                  <Kbd
                    keys={[strip.mac ? "⌘" : "Ctrl"]}
                    xstyle={[stripStyles.key, modifierHeld && stripStyles.held]}
                  />
                  <Kbd
                    keys={[digit]}
                    xstyle={[stripStyles.key, held.digit === digit && stripStyles.held]}
                  />
                </span>
              )}
            </span>
          </TooltipContent>
        </Tooltip>
        {closable && (
          <span {...props(stripStyles.close, active && stripStyles.closeVisible)}>
            <Button
              size="xs"
              iconOnly
              icon="close"
              aria-label="Close tab"
              tabIndex={-1}
              onClick={() => strip.onClose(tab.id)}
            />
          </span>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`${tab.title} tab actions`}>
        <ContextMenuItem icon="plus" meta={shortcut("T")} onClick={strip.onNewTab}>
          New Tab
        </ContextMenuItem>
        <ContextMenuItem icon="copy" onClick={() => strip.onDuplicate(tab.id)}>
          Duplicate Tab
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon="close" meta={shortcut("W")} onClick={() => strip.onClose(tab.id)}>
          Close Tab
        </ContextMenuItem>
        <ContextMenuItem
          icon="circle-x"
          disabled={!othersClosable}
          onClick={() => strip.onCloseOthers(tab.id)}
        >
          Close Other Tabs
        </ContextMenuItem>
        <ContextMenuItem
          icon="arrow-right"
          disabled={!rightClosable}
          onClick={() => strip.onCloseToRight(tab.id)}
        >
          Close Tabs to the Right
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function WindowTabStrip(strip: WindowTabStripProps): ReactElement {
  const { tabs, activeTabId, mac } = strip;
  const held = useHeldKeys();
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <Tabs.Root
      value={activeTabId}
      xstyle={stripStyles.strip}
      onValueChange={(tabId) => strip.onActivate(tabId)}
    >
      <Tabs.List ref={listRef} aria-label="Tabs" xstyle={stripStyles.list}>
        <SortableList
          ids={tabs.map((tab) => tab.id)}
          listRef={listRef}
          onPick={strip.onActivate}
          onReorder={strip.onReorder}
        >
          {tabs.map((tab, position) => (
            <SortableItem key={tab.id} id={tab.id} xstyle={stripStyles.slot}>
              <TabItem
                tab={tab}
                position={position}
                active={tab.id === activeTabId}
                closable={tabs.length > 1}
                othersClosable={tabs.length > 1}
                rightClosable={position < tabs.length - 1}
                held={held}
                strip={strip}
              />
            </SortableItem>
          ))}
        </SortableList>
      </Tabs.List>
      <span {...props(stripStyles.control)}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                iconOnly
                icon="plus"
                aria-label="New tab"
                title={undefined}
                onClick={strip.onNewTab}
              />
            }
          />
          <TooltipContent>{`New Tab ${mac ? "⌘T" : "Ctrl+T"}`}</TooltipContent>
        </Tooltip>
      </span>
    </Tabs.Root>
  );
}
