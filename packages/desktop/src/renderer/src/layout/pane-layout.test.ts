import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { SessionId } from "@nyte-ai/protocol";
import { sessionId } from "@nyte-ai/protocol";
import {
  DEFAULT_SPLIT_RATIO,
  activePane,
  createSinglePane,
  orderedPanes,
  parsePersistedPaneLayout,
  reducePaneLayout,
  serializePaneLayout,
} from "./pane-layout.ts";
import type {
  DropPlacement,
  PaneId,
  PaneLayout,
  PaneSelection,
  SplitDirection,
} from "./pane-layout.ts";

type SplitPaneLayout = Extract<PaneLayout, { kind: "split" }>;
type EdgePlacement = Exclude<DropPlacement, "center">;

const ALPHA = sessionId("alpha");
const BETA = sessionId("beta");
const GAMMA = sessionId("gamma");
const TARGET_PANE_IDS = ["primary", "secondary"] satisfies readonly PaneId[];

const EDGE_CASES = [
  { placement: "left", direction: "right", draggedLeads: true },
  { placement: "right", direction: "right", draggedLeads: false },
  { placement: "top", direction: "down", draggedLeads: true },
  { placement: "bottom", direction: "down", draggedLeads: false },
] satisfies readonly {
  readonly placement: EdgePlacement;
  readonly direction: SplitDirection;
  readonly draggedLeads: boolean;
}[];

function session(sessionId: SessionId): PaneSelection {
  return { kind: "session", sessionId };
}

function splitLayout({
  direction,
  leading,
  primary,
  secondary,
  activePaneId,
  ratio = 0.37,
}: {
  readonly direction: SplitDirection;
  readonly leading: PaneId;
  readonly primary: SessionId;
  readonly secondary: SessionId;
  readonly activePaneId: PaneId;
  readonly ratio?: number;
}): SplitPaneLayout {
  return {
    kind: "split",
    direction,
    ratio,
    leading,
    primary: session(primary),
    secondary: session(secondary),
    activePaneId,
  };
}

function drop({
  layout,
  sessionId,
  targetPaneId,
  placement,
}: {
  readonly layout: PaneLayout;
  readonly sessionId: SessionId;
  readonly targetPaneId: PaneId;
  readonly placement: DropPlacement;
}): PaneLayout {
  return reducePaneLayout(layout, {
    kind: "drop-session",
    sessionId,
    targetPaneId,
    placement,
  });
}

function expectSplit(layout: PaneLayout): SplitPaneLayout {
  if (layout.kind === "single") assert.fail("Expected a split pane layout");
  return layout;
}

describe("pane drop semantics", () => {
  test("a center drop replaces a single pane's selection", () => {
    const result = drop({
      layout: createSinglePane("primary", session(ALPHA)),
      sessionId: BETA,
      targetPaneId: "primary",
      placement: "center",
    });

    assert.deepEqual(result, createSinglePane("primary", session(BETA)));
  });

  test("a center drop of a third session replaces only the target and activates it", () => {
    const initial = splitLayout({
      direction: "right",
      leading: "primary",
      primary: ALPHA,
      secondary: BETA,
      activePaneId: "secondary",
    });
    const result = expectSplit(
      drop({
        layout: initial,
        sessionId: GAMMA,
        targetPaneId: "primary",
        placement: "center",
      }),
    );

    assert.deepEqual(result, {
      ...initial,
      primary: session(GAMMA),
      activePaneId: "primary",
    });
  });

  test("a center drop of an already-visible session swaps panes and activates the destination", () => {
    const initial = splitLayout({
      direction: "right",
      leading: "primary",
      primary: ALPHA,
      secondary: BETA,
      activePaneId: "secondary",
    });
    const result = expectSplit(
      drop({
        layout: initial,
        sessionId: BETA,
        targetPaneId: "primary",
        placement: "center",
      }),
    );

    assert.deepEqual(result, {
      ...initial,
      primary: session(BETA),
      secondary: session(ALPHA),
      activePaneId: "primary",
    });
  });

  test("each edge splits a single pane with the dragged session on the requested side", () => {
    for (const { placement, direction, draggedLeads } of EDGE_CASES) {
      const result = expectSplit(
        drop({
          layout: createSinglePane("primary", session(ALPHA)),
          sessionId: BETA,
          targetPaneId: "primary",
          placement,
        }),
      );

      assert.equal(result.direction, direction, placement);
      assert.equal(result.ratio, DEFAULT_SPLIT_RATIO, placement);
      assert.equal(result.leading, draggedLeads ? "secondary" : "primary", placement);
      assert.deepEqual(result.primary, session(ALPHA), placement);
      assert.deepEqual(result.secondary, session(BETA), placement);
      assert.equal(activePane(result).id, "secondary", placement);
    }
  });

  test("an edge drop moves an already-visible session without replacing either selection", () => {
    const initial = splitLayout({
      direction: "right",
      leading: "primary",
      primary: ALPHA,
      secondary: BETA,
      activePaneId: "secondary",
    });
    const result = expectSplit(
      drop({
        layout: initial,
        sessionId: ALPHA,
        targetPaneId: "secondary",
        placement: "bottom",
      }),
    );

    assert.equal(result.direction, "down");
    assert.equal(result.leading, "secondary");
    assert.deepEqual(result.primary, session(ALPHA));
    assert.deepEqual(result.secondary, session(BETA));
    assert.equal(result.ratio, initial.ratio);
    assert.equal(activePane(result).id, "primary");
  });

  test("an already-positioned edge drop still activates the dragged session", () => {
    const initial = splitLayout({
      direction: "right",
      leading: "primary",
      primary: ALPHA,
      secondary: BETA,
      activePaneId: "secondary",
    });
    const result = expectSplit(
      drop({
        layout: initial,
        sessionId: ALPHA,
        targetPaneId: "secondary",
        placement: "left",
      }),
    );

    assert.deepEqual(
      orderedPanes(result).map((pane) => pane.id),
      ["primary", "secondary"],
    );
    assert.equal(activePane(result).id, "primary");
  });

  test("dropping a session onto itself is a no-op for center and every edge", () => {
    const initial = splitLayout({
      direction: "right",
      leading: "primary",
      primary: ALPHA,
      secondary: BETA,
      activePaneId: "secondary",
    });
    const placements: readonly DropPlacement[] = ["center", "top", "bottom", "left", "right"];

    for (const placement of placements) {
      const result = drop({
        layout: initial,
        sessionId: ALPHA,
        targetPaneId: "primary",
        placement,
      });
      assert.strictEqual(result, initial, placement);
    }
  });

  test("edge-dropping a third session into a split replaces the non-target pane", () => {
    for (const targetPaneId of TARGET_PANE_IDS) {
      for (const { placement, direction, draggedLeads } of EDGE_CASES) {
        const initial = splitLayout({
          direction: "right",
          leading: "primary",
          primary: ALPHA,
          secondary: BETA,
          activePaneId: targetPaneId,
        });
        const draggedPaneId: PaneId = targetPaneId === "primary" ? "secondary" : "primary";
        const result = expectSplit(
          drop({
            layout: initial,
            sessionId: GAMMA,
            targetPaneId,
            placement,
          }),
        );

        assert.equal(result.direction, direction, `${targetPaneId}:${placement}`);
        assert.equal(
          result.leading,
          draggedLeads ? draggedPaneId : targetPaneId,
          `${targetPaneId}:${placement}`,
        );
        assert.deepEqual(
          result.primary,
          session(targetPaneId === "primary" ? ALPHA : GAMMA),
          `${targetPaneId}:${placement}`,
        );
        assert.deepEqual(
          result.secondary,
          session(targetPaneId === "secondary" ? BETA : GAMMA),
          `${targetPaneId}:${placement}`,
        );
        assert.equal(activePane(result).id, draggedPaneId, `${targetPaneId}:${placement}`);
        assert.equal(result.ratio, initial.ratio, `${targetPaneId}:${placement}`);
      }
    }
  });
});

describe("pane layout persistence", () => {
  test("a serialized layout restores exactly", () => {
    const layouts: readonly PaneLayout[] = [
      createSinglePane("secondary", session(ALPHA)),
      splitLayout({
        direction: "down",
        leading: "secondary",
        primary: ALPHA,
        secondary: BETA,
        activePaneId: "secondary",
      }),
    ];
    for (const layout of layouts) {
      assert.deepEqual(parsePersistedPaneLayout(serializePaneLayout(layout)), layout);
    }
  });

  test("a version 1 layout string still restores, including a swapped order", () => {
    const single = JSON.stringify({
      version: 1,
      kind: "single",
      pane: { id: "secondary", selection: { kind: "session", sessionId: ALPHA } },
    });
    assert.deepEqual(
      parsePersistedPaneLayout(single),
      createSinglePane("secondary", session(ALPHA)),
    );

    const split = JSON.stringify({
      version: 1,
      kind: "split",
      direction: "down",
      ratio: 0.4,
      order: ["secondary", "primary"],
      primary: { id: "primary", selection: { kind: "session", sessionId: ALPHA } },
      secondary: { id: "secondary", selection: { kind: "blank" } },
      activePaneId: "secondary",
    });
    assert.deepEqual(parsePersistedPaneLayout(split), {
      kind: "split",
      direction: "down",
      ratio: 0.4,
      leading: "secondary",
      primary: session(ALPHA),
      secondary: { kind: "blank" },
      activePaneId: "secondary",
    });
  });

  test("a corrupt or duplicated layout string resets to a blank single pane", () => {
    const duplicated = JSON.stringify({
      version: 2,
      kind: "split",
      direction: "right",
      ratio: 0.5,
      leading: "primary",
      primary: { kind: "session", sessionId: ALPHA },
      secondary: { kind: "session", sessionId: ALPHA },
      activePaneId: "primary",
    });
    for (const value of [null, "not json", "{}", duplicated]) {
      assert.deepEqual(parsePersistedPaneLayout(value), createSinglePane());
    }
  });
});
