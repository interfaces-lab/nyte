import assert from "node:assert/strict";
import { afterAll, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { sessionId } from "@nyte-ai/protocol";
import { shellActions, useShellState } from "../chrome/shell-state.ts";
import {
  PaneControllerProvider,
  paneControllerForWorkspace,
  usePaneActions,
  useCanSplitPane,
  usePaneControllerSnapshot,
} from "./pane-context.tsx";
import type { PaneActions } from "./pane-context.tsx";

vi.hoisted(() => {
  vi.stubGlobal("self", {});
  vi.stubGlobal("document", {
    documentElement: { style: { setProperty() {} } },
  });
});

test.each([560, 640])("split availability and execution agree at window width %s", (width) => {
  vi.stubGlobal("window", { innerWidth: width });
  shellActions.showWorkspace();
  const workspaceKey = `split-action-${String(width)}`;
  const controller = paneControllerForWorkspace(workspaceKey);
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
      <PaneControllerProvider workspaceKey={workspaceKey}>
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
  const layout = controller.getSnapshot().layout;
  assert.equal(layout.kind, selected.available ? "split" : "single");
  assert.equal(selected.actions.focusNext(), selected.available);
  if (layout.kind === "split") {
    assert.equal(controller.getSnapshot().focusRequest.paneId, "primary");
  }
});
afterAll(() => vi.unstubAllGlobals());

test("new chat leaves Customize and selects the blank pane through the shared pane action", () => {
  const workspaceKey = "new-chat-action-fixture";
  const controller = paneControllerForWorkspace(workspaceKey);
  const id = sessionId("previous-chat");
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
    const shell = useShellState();
    const snapshot = usePaneControllerSnapshot();
    return (
      <span>
        {shell.stage.kind}:{snapshot.layout.kind}
      </span>
    );
  }
  const render = () =>
    renderToStaticMarkup(
      <RouterContextProvider router={router}>
        <PaneControllerProvider workspaceKey={workspaceKey}>
          <Probe
            inspect={(value) => {
              actions = value;
            }}
          />
        </PaneControllerProvider>
      </RouterContextProvider>,
    );
  expect(render()).toBe("<span>customize:single</span>");
  assert.ok(actions);
  actions.newChat();
  expect(render()).toBe("<span>workspace:single</span>");
  const layout = controller.getSnapshot().layout;
  assert.equal(layout.kind, "single");
  expect(layout.pane.selection).toEqual({ kind: "blank" });
});
