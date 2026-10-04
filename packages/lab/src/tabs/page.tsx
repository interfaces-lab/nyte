import { applyDisplayMode } from "@nyte-ai/app/theme/appearance.ts";
import { props } from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useReducer, useState, type ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { PanelToggleIcon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Tabs } from "@nyte-ai/ui/tabs";
import { Toggle } from "@nyte-ai/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import {
  activePlace,
  activeTab,
  canTravel,
  currentPlace,
  currentView,
  focusedPane,
  initialWindow,
  reduce,
  type OpenTarget,
  type PanesView,
  type Place,
  type View,
  type WindowAction,
  type WindowState,
} from "./model";
import { PlaceGlyph, PlaceView, placeInfo } from "./place";
import { Sidebar } from "./sidebar";
import { TabStrip } from "./tab-strip";
import { boardStyles, windowStyles as styles } from "./tabs.stylex";

function Segmented<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly (readonly [Value, string])[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}): ReactElement {
  return (
    <Tabs.Root
      variant="segmented"
      value={value}
      onValueChange={(next: unknown) => {
        const option = options.find(([id]) => id === next);

        if (option !== undefined) onChange(option[0]);
      }}
    >
      <Tabs.List aria-label={label}>
        {options.map(([id, text]) => (
          <Tabs.Tab key={id} value={id}>
            {text}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

/**
 * The browser keeps ⌘T, ⌘W, ⌘N and ⌃Tab for itself, so this board binds the
 * tab commands to ⌥. The desktop would use the ⌘ chords in the legend.
 */
function windowAction(event: KeyboardEvent): WindowAction | undefined {
  const primary = event.metaKey || event.ctrlKey;
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1];

  // ⌘1–9 where the browser lets it through; ⌥1–9 always.
  if (digit !== undefined && (primary || event.altKey) && !event.shiftKey)
    return { kind: "activate-index", index: Number(digit) - 1 };

  if (primary && !event.altKey && !event.shiftKey) {
    if (event.code === "BracketLeft") return { kind: "travel", step: -1 };

    if (event.code === "BracketRight") return { kind: "travel", step: 1 };

    return undefined;
  }

  if (!event.altKey || primary) return undefined;

  if (event.code === "KeyT") return event.shiftKey ? { kind: "reopen-tab" } : { kind: "new-tab" };

  // opencode binds ⌘N and ⌘T to the same new chat tab.
  if (event.code === "KeyN" && !event.shiftKey) return { kind: "new-tab" };

  if (event.code === "KeyD") return { kind: "split", direction: event.shiftKey ? "down" : "right" };

  if (event.shiftKey && event.code === "BracketLeft") return { kind: "cycle-tab", step: -1 };

  if (event.shiftKey && event.code === "BracketRight") return { kind: "cycle-tab", step: 1 };

  return undefined;
}

/** A top page fills its tab and a pinned tab keeps its place, so neither splits. */
function SplitActions({
  view,
  pinned,
  dispatch,
}: {
  readonly view: View;
  readonly pinned: boolean;
  readonly dispatch: (action: WindowAction) => void;
}): ReactElement {
  const split = pinned || view.kind === "page" || view.panes.length > 1;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              iconOnly
              icon="split-right"
              aria-label="Split right"
              disabled={split}
              onClick={() => dispatch({ kind: "split", direction: "right" })}
            />
          }
        />
        <TooltipContent>Split Right ⌘D</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              iconOnly
              icon="split-down"
              aria-label="Split down"
              disabled={split}
              onClick={() => dispatch({ kind: "split", direction: "down" })}
            />
          }
        />
        <TooltipContent>Split Down ⌘⇧D</TooltipContent>
      </Tooltip>
    </>
  );
}

function Panes({
  view,
  dispatch,
}: {
  readonly view: PanesView;
  readonly dispatch: (action: WindowAction) => void;
}): ReactElement {
  const split = view.panes.length > 1;

  return (
    <div {...props(styles.panes, view.direction === "down" && styles.panesDown)}>
      {view.panes.map((pane, index) => {
        const place = currentPlace(pane);
        const info = placeInfo(place);
        const focused = pane.id === view.activePaneId;

        return (
          <div key={pane.id} style={{ display: "contents" }}>
            {index > 0 && (
              <div
                {...props(
                  styles.divider,
                  view.direction === "down" ? styles.dividerDown : styles.dividerRight,
                )}
              />
            )}
            <section
              aria-label={info.title}
              {...props(styles.pane)}
              onPointerDownCapture={() => dispatch({ kind: "focus-pane", paneId: pane.id })}
            >
              {split && (
                <header {...props(styles.paneHeader, focused && styles.paneHeaderActive)}>
                  <PlaceGlyph info={info} />
                  <span {...props(styles.crumbTitle)}>{info.title}</span>
                  <span {...props(styles.laneFill)} />
                  <Button
                    size="xs"
                    iconOnly
                    icon="close"
                    aria-label="Close pane"
                    onClick={() => dispatch({ kind: "close-pane", paneId: pane.id })}
                  />
                </header>
              )}
              <div {...props(styles.paneBody)}>
                <PlaceView
                  place={place}
                  onOpen={(next, target) => dispatch({ kind: "open", place: next, target })}
                  onReplace={(next) => dispatch({ kind: "replace", paneId: pane.id, place: next })}
                />
              </div>
            </section>
          </div>
        );
      })}
    </div>
  );
}

function AppWindow(): ReactElement {
  const [state, dispatch] = useReducer(reduce, undefined, initialWindow);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const tab = activeTab(state);
  const view = currentView(tab);
  const place = activePlace(state);
  const open = (next: Place, target: OpenTarget): void =>
    dispatch({ kind: "open", place: next, target });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey && !event.metaKey && !event.ctrlKey && event.code === "KeyW") {
        event.preventDefault();
        dispatch({ kind: "close-tab", tabId: state.activeTabId });

        return;
      }

      const action = windowAction(event);

      if (action === undefined) return;
      event.preventDefault();
      dispatch(action);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.activeTabId]);

  return (
    <div {...props(styles.frame)}>
      <div {...props(styles.window)}>
        <header {...props(styles.titlebar)}>
          <div {...props(styles.lane, sidebarVisible && styles.laneSidebar)}>
            <span {...props(styles.lights)}>
              <span {...props(styles.light)} />
              <span {...props(styles.light)} />
              <span {...props(styles.light)} />
            </span>
            <Toggle
              iconOnly
              indicator="glyph"
              aria-label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
              pressed={sidebarVisible}
              onPressedChange={() => setSidebarVisible((visible) => !visible)}
            >
              <PanelToggleIcon side="left" visible={sidebarVisible} />
            </Toggle>
            {sidebarVisible && <span {...props(styles.laneFill)} />}
            <Button
              iconOnly
              icon="arrow-left"
              aria-label="Go back"
              disabled={!canTravel(state, -1)}
              onClick={() => dispatch({ kind: "travel", step: -1 })}
            />
            <Button
              iconOnly
              icon="arrow-right"
              aria-label="Go forward"
              disabled={!canTravel(state, 1)}
              onClick={() => dispatch({ kind: "travel", step: 1 })}
            />
          </div>
          <TabStrip tabs={state.tabs} activeTabId={state.activeTabId} dispatch={dispatch} />
          <span {...props(styles.titlebarActions)}>
            <SplitActions view={view} pinned={tab.pinned} dispatch={dispatch} />
          </span>
        </header>
        <div {...props(styles.body)}>
          {sidebarVisible && (
            <div {...props(styles.sidebar)}>
              <Sidebar current={place} onOpen={open} />
            </div>
          )}
          <main {...props(styles.main, !sidebarVisible && styles.mainSidebarHidden)}>
            {view.kind === "page" ? (
              <PlaceView
                key={tab.id}
                place={view.place}
                onOpen={open}
                onReplace={() => undefined}
              />
            ) : (
              <Panes key={tab.id} view={view} dispatch={dispatch} />
            )}
          </main>
        </div>
      </div>
      <PaneTrail state={state} />
    </div>
  );
}

function trailLabel(place: Place): string {
  const { title } = placeInfo(place);

  return place.kind === "review" ? `PR · ${title}` : title;
}

function viewLabel(view: View): string {
  if (view.kind === "page") return placeInfo(view.place).title;

  return view.panes.map((pane) => trailLabel(currentPlace(pane))).join(" | ");
}

/** Where back would land: the focused pane's entries first, then the views the tab moved between. */
function PaneTrail({ state }: { readonly state: WindowState }): ReactElement {
  const tab = activeTab(state);
  const view = currentView(tab);
  const pane = view.kind === "panes" ? focusedPane(view) : undefined;

  return (
    <div {...props(boardStyles.legend, boardStyles.trail)}>
      {pane !== undefined && (
        <>
          <span>Focused pane:</span>
          {pane.entries.map((entry, index) => (
            <span key={index} {...props(index === pane.index && boardStyles.trailHere)}>
              {trailLabel(entry)}
            </span>
          ))}
        </>
      )}
      <span>Tab:</span>
      {tab.views.map((entry, index) => (
        <span key={index} {...props(index === tab.index && boardStyles.trailHere)}>
          {viewLabel(entry)}
        </span>
      ))}
      <span>Closed tabs: {state.closed.length}</span>
    </div>
  );
}

const SHORTCUTS = [
  [["⌥", "T"], "new chat tab (⌘T, ⌘N)"],
  [["⌥", "W"], "close tab (⌘W)"],
  [["⌥", "⇧", "T"], "reopen (⌘⇧T)"],
  [["⌥", "1–9"], "tab 1–9 (⌘1–9)"],
  [["⌥", "⇧", "]"], "next tab (⌃⇥, ⌘⌥→)"],
  [["⌘", "["], "back"],
  [["⌘", "]"], "forward"],
  [["⌥", "D"], "split (⌘D)"],
] as const;

export function TabsPage(): ReactElement {
  const [appearance, setAppearance] = useState<"light" | "dark">("dark");

  useLayoutEffect(() => {
    applyDisplayMode(appearance);
  }, [appearance]);

  return (
    <main {...props(boardStyles.page)}>
      <header {...props(boardStyles.header)}>
        <h1 {...props(boardStyles.title)}>Tabs</h1>
        <span {...props(boardStyles.subtitle)}>
          A tab is a saved place. Clicking in the sidebar moves the current tab; ⌘-click or
          middle-click opens a background tab, ⌘⇧-click opens and shows it. Environments and
          Customize fill the whole tab; back returns to the split they replaced. Hover a tab and
          hold ⌘; right-click a tab to pin it or close others; drag to reorder.
        </span>
        <Segmented
          label="Appearance"
          options={[
            ["dark", "Dark"],
            ["light", "Light"],
          ]}
          value={appearance}
          onChange={setAppearance}
        />
      </header>
      <div {...props(boardStyles.legend)}>
        {SHORTCUTS.map(([keys, label]) => (
          <span key={label} {...props(boardStyles.legendItem)}>
            <Kbd keys={keys} />
            {label}
          </span>
        ))}
      </div>
      <AppWindow />
    </main>
  );
}
