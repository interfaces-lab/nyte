import { PRIMARY, tabPanes } from "../../test/panes.ts";
import assert from "node:assert/strict";
import { afterAll, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { asId } from "@nyte-ai/schema";
import { shellActions, useStagePage } from "../tabs/shell-state.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import {
  PaneControllerProvider,
  usePaneActions,
  useCanSplitPane,
  usePaneLayout,
} from "./pane-context.tsx";
import type { PaneActions } from "./pane-context.tsx";
import type { PaneId } from "./layout.ts";
import { activeSelection, chatPanes } from "./pane-layout.ts";

vi.hoisted(() => {
  vi.stubGlobal("self", {});
  vi.stubGlobal("document", {
    documentElement: { style: { setProperty() {} } },
  });
});

test.each([560, 640])("split availability and execution agree at window width %s", (width) => {
  vi.stubGlobal("window", { innerWidth: width });
  shellActions.showWorkspace();
  const controller = tabPanes();
  const requests: PaneId[] = [];
  controller.store.onFocusRequest((pane) => requests.push(pane));

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory(),
    isServer: true,
  });

  let selected: { readonly actions: PaneActions; readonly available: boolean } | undefined;

  function Probe({
    inspect,
  }: {
    readonly inspect: (actions: PaneActions, available: boolean) => void;
  }) {
    inspect(usePaneActions(), useCanSplitPane());

    return null;
  }

  renderToStaticMarkup(
    <RouterContextProvider router={router}>
      <PaneControllerProvider controller={controller}>
        <Probe
          inspect={(actions, available) => {
            selected = { actions, available };
          }}
        />
      </PaneControllerProvider>
    </RouterContextProvider>,
  );
  assert.ok(selected);
  assert.equal(selected.available, width >= 640);
  selected.actions.split("right");
  assert.equal(chatPanes(controller.getSnapshot()).length, selected.available ? 2 : 1);
  assert.equal(selected.actions.focusNext(), selected.available);

  if (selected.available) assert.equal(requests.at(-1), PRIMARY);
});

afterAll(() => vi.unstubAllGlobals());

test("new chat leaves Customize and selects the blank pane through the shared pane action", () => {
  const controller = windowTabs.controller();
  const id = asId<"session">("previous-chat");
  controller.selectSession(id);
  shellActions.openCustomize(id);

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory(),
    isServer: true,
  });

  let actions: PaneActions | undefined;

  function Probe({ inspect }: { readonly inspect: (value: PaneActions) => void }) {
    inspect(usePaneActions());
    const page = useStagePage();
    const panes = usePaneLayout((layout) => chatPanes(layout).length);

    return (
      <span>
        {page?.kind ?? "workspace"}:{panes}
      </span>
    );
  }

  const render = () =>
    renderToStaticMarkup(
      <RouterContextProvider router={router}>
        <PaneControllerProvider>
          <Probe
            inspect={(value) => {
              actions = value;
            }}
          />
        </PaneControllerProvider>
      </RouterContextProvider>,
    );

  expect(render()).toBe("<span>customize:1</span>");
  assert.ok(actions);
  actions.newChat();
  expect(render()).toBe("<span>workspace:1</span>");
  const layout = controller.getSnapshot();
  assert.equal(chatPanes(layout).length, 1);
  expect(activeSelection(layout)).toEqual({ kind: "blank" });
});
