import { props } from "@stylexjs/stylex";
import { useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon, PanelToggleIcon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { nyte } from "../contract/nyte.ts";
import { useLights } from "../light/light.ts";
import { Board } from "./board.tsx";
import type { BoardHandle } from "./board.tsx";
import { DesignModeToggle, PageDesignBar } from "./board-design.tsx";
import type { ActivePage } from "./board-pages.ts";
import { DesignList } from "./design-list.tsx";
import { AddDesignToChat } from "./design-reference.tsx";
import { DesignStatus } from "./design-status.tsx";
import { useDesignStore } from "./designs.ts";
import type { DesignStore } from "./designs.ts";
import { studioStyles } from "./studio.stylex.ts";

function watchDisplayMode(listener: () => void): () => void {
  const observer = new MutationObserver(listener);

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-display-mode"],
  });

  return () => observer.disconnect();
}

/**
 * Every design of the workspace on one board, beside the list of them. The board follows the window's appearance until
 * the person chooses the other one. In a narrow panel the list stays closed until its toggle opens it.
 */
export function DesignPanel(input: {
  readonly workspace: SelectedWorkspace | undefined;
  /** Shows this window's chat and puts the cursor in its composer. */
  readonly onAsk: () => void;
}): ReactElement {
  const store = useDesignStore(input.workspace);

  if (store === undefined) return <NoDesigns onAsk={input.onAsk} />;

  return <DesignBoard store={store} workspace={input.workspace} onAsk={input.onAsk} />;
}

function DesignBoard(input: {
  readonly store: DesignStore;
  readonly workspace: SelectedWorkspace | undefined;
  readonly onAsk: () => void;
}): ReactElement {
  const store = input.store;
  const designs = store.useDesigns();
  const selected = useLights((lights) => store.lights(lights).you?.subject.kind === "span");

  const dark = useSyncExternalStore(
    watchDisplayMode,
    () => document.documentElement.dataset["displayMode"] === "dark",
  );

  const [chosen, setChosen] = useState<boolean | null>(null);
  const [zoom, setZoom] = useState(60);
  const [listOpen, setListOpen] = useState(false);
  const [page, setPage] = useState<ActivePage | null>(null);
  const board = useRef<BoardHandle>(null);
  const night = chosen ?? dark;

  if (designs.paths.length === 0) return <NoDesigns onAsk={input.onAsk} />;

  return (
    <div {...props(studioStyles.panel)}>
      <DesignList
        store={store}
        designs={designs}
        open={listOpen}
        onReveal={(path) => {
          store.shine({ kind: "file", path });
          board.current?.reveal(path);
        }}
      />
      <div {...props(studioStyles.column, hairline.inlineStart)}>
        <div {...props(studioStyles.toolbar, hairline.blockEnd)}>
          <span {...props(studioStyles.listToggle)}>
            <Toggle
              iconOnly
              indicator="glyph"
              aria-label={listOpen ? "Hide designs" : "Show designs"}
              pressed={listOpen}
              onPressedChange={(pressed) => setListOpen(pressed)}
              xstyle={studioStyles.leading}
            >
              <PanelToggleIcon side="left" visible={listOpen} />
            </Toggle>
          </span>
          <AddDesignToChat store={store} />
          {nyte.host.browser !== undefined && (
            <DesignModeToggle page={page} onEnter={(entered) => board.current?.enter(entered)} />
          )}
          <ToggleGroup
            aria-label="Board Appearance"
            value={[night ? "night" : "day"]}
            onValueChange={(value) => {
              const next = value[0];

              if (next === "day" || next === "night")
                setChosen((next === "night") === dark ? null : next === "night");
            }}
          >
            <Toggle value="day" size="xs">
              Day
            </Toggle>
            <Toggle value="night" size="xs">
              Night
            </Toggle>
          </ToggleGroup>
          <Menu>
            <MenuTrigger
              render={
                <Button variant="ghost" size="sm" xstyle={studioStyles.zoom}>
                  {`${String(zoom)}%`}
                  <Icon name="chevron-down" size="xs" />
                </Button>
              }
            />
            <MenuContent align="end">
              <MenuItem onClick={() => board.current?.camera("fit")}>Zoom to Fit</MenuItem>
              <MenuItem onClick={() => board.current?.camera("actual")}>Zoom to 100%</MenuItem>
              <MenuItem disabled={!selected} onClick={() => board.current?.camera("selection")}>
                Zoom to Selection
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
        <DesignStatus store={store} />
        {page !== null && <PageDesignBar surface={page.surface} />}
        <Board
          key={input.workspace?.path}
          store={store}
          designs={designs}
          handle={board}
          workspacePath={input.workspace?.path}
          onPage={setPage}
          night={night}
          following
          onZoom={(value) => {
            const percent = Math.round(value * 100);

            if (percent !== zoom) setZoom(percent);
          }}
        />
      </div>
    </div>
  );
}

function NoDesigns(input: { readonly onAsk: () => void }): ReactElement {
  return (
    <div {...props(text.sm, studioStyles.empty)}>
      <Icon name="bezier-pointer" size="lg" />
      <p {...props(text.base, studioStyles.emptyTitle)}>No designs yet</p>
      <p {...props(studioStyles.emptyBody)}>
        Ask Nyte for a screen, or add a JSX file to the design folder.
      </p>
      <Button variant="outline" xstyle={studioStyles.emptyAction} onClick={input.onAsk}>
        Ask Nyte
      </Button>
    </div>
  );
}
