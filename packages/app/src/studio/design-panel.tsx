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
import { useLights } from "../light/light.ts";
import { Board } from "./board.tsx";
import type { BoardHandle } from "./board.tsx";
import { DesignList } from "./design-list.tsx";
import { designLights, shineDesign, useDesigns } from "./designs.ts";
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
  const designs = useDesigns(input.workspace);
  const selected = useLights((lights) => designLights(lights).you?.subject.kind === "span");

  const dark = useSyncExternalStore(
    watchDisplayMode,
    () => document.documentElement.dataset["displayMode"] === "dark",
  );

  const [chosen, setChosen] = useState<boolean | null>(null);
  const [zoom, setZoom] = useState(60);
  const [listOpen, setListOpen] = useState(false);
  const board = useRef<BoardHandle>(null);
  const night = chosen ?? dark;

  if (designs.paths.length === 0)
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

  return (
    <div {...props(studioStyles.panel)}>
      <DesignList
        designs={designs}
        open={listOpen}
        onReveal={(path) => {
          shineDesign({ kind: "file", path });
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
        <Board
          designs={designs}
          handle={board}
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
