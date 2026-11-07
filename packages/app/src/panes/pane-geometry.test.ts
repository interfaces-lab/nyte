import { asId } from "@nyte-ai/schema";
import { expect, test } from "vitest";
import type { Layout, LayoutNode, PaneSize } from "./layout.ts";
import { boxStyle, layoutGeometry } from "./pane-geometry.ts";

interface Note {
  readonly kind: "note";
}

type Node = LayoutNode<Note>;

function pane(id: string, hidden = false): Node {
  const tab = { id: asId<"pane-tab">(`${id}-tab`), content: { kind: "note" as const } };

  return { kind: "pane", id: asId<"pane">(id), tabs: [tab], active: tab.id, hidden };
}

function split(
  direction: "right" | "down",
  first: readonly [Node, PaneSize],
  second: readonly [Node, PaneSize],
): Node {
  return {
    kind: "split",
    id: asId<"split">(`${direction}-split`),
    direction,
    children: [
      { node: first[0], size: first[1] },
      { node: second[0], size: second[1] },
    ],
  };
}

const share = (value: number): PaneSize => ({ kind: "share", share: value });

const pixels = (value: number): PaneSize => ({ kind: "pixels", pixels: value });

function styles(root: Node, zoomed: string | null = null) {
  const state: Layout<Note> = {
    root,
    focus: [asId<"pane">("A")],
    zoomed: zoomed === null ? null : asId<"pane">(zoomed),
  };

  const geometry = layoutGeometry(state);

  return {
    panes: Object.fromEntries(
      [...geometry.panes].map((entry) => [entry[0], boxStyle(entry[1], "var(--gap)")]),
    ),
    separators: geometry.separators.map(
      (separator) =>
        `${separator.split}:${String(separator.index)} ${boxStyle(separator.box, "var(--gap)").insetInlineStart}`,
    ),
  };
}

test.each([
  {
    name: "one pane fills the layout",
    root: pane("A"),
    expected: {
      panes: {
        A: {
          insetInlineStart: "round(0px, 1px)",
          insetBlockStart: "round(0px, 1px)",
          inlineSize: "calc(round(calc(1 * 100cqi), 1px) - round(0px, 1px))",
          blockSize: "calc(round(calc(1 * 100cqb), 1px) - round(0px, 1px))",
        },
      },
      separators: [],
    },
  },
  {
    name: "two shares divide what the separator leaves",
    root: split("right", [pane("A"), share(1)], [pane("B"), share(1)]),
    expected: {
      panes: {
        A: {
          insetInlineStart: "round(0px, 1px)",
          insetBlockStart: "round(0px, 1px)",
          inlineSize: "calc(round(calc(0.5 * 100cqi + -0.5 * var(--gap)), 1px) - round(0px, 1px))",
          blockSize: "calc(round(calc(1 * 100cqb), 1px) - round(0px, 1px))",
        },
        B: {
          insetInlineStart: "round(calc(0.5 * 100cqi + 0.5 * var(--gap)), 1px)",
          insetBlockStart: "round(0px, 1px)",
          inlineSize:
            "calc(round(calc(1 * 100cqi), 1px) - round(calc(0.5 * 100cqi + 0.5 * var(--gap)), 1px))",
          blockSize: "calc(round(calc(1 * 100cqb), 1px) - round(0px, 1px))",
        },
      },
      separators: ["right-split:0 round(calc(0.5 * 100cqi + -0.5 * var(--gap)), 1px)"],
    },
  },
  {
    name: "a pixel-sized explorer keeps its width as the layout resizes",
    root: split("right", [pane("E"), pixels(200)], [pane("A"), share(1)]),
    expected: {
      panes: {
        E: {
          insetInlineStart: "round(0px, 1px)",
          insetBlockStart: "round(0px, 1px)",
          inlineSize: "calc(round(200px, 1px) - round(0px, 1px))",
          blockSize: "calc(round(calc(1 * 100cqb), 1px) - round(0px, 1px))",
        },
        A: {
          insetInlineStart: "round(calc(200px + 1 * var(--gap)), 1px)",
          insetBlockStart: "round(0px, 1px)",
          inlineSize:
            "calc(round(calc(1 * 100cqi), 1px) - round(calc(200px + 1 * var(--gap)), 1px))",
          blockSize: "calc(round(calc(1 * 100cqb), 1px) - round(0px, 1px))",
        },
      },
      separators: ["right-split:0 round(200px, 1px)"],
    },
  },
  {
    name: "a hidden pane gives its room and its separator to the others",
    root: split("right", [pane("E", true), pixels(200)], [pane("A"), share(1)]),
    expected: {
      panes: {
        E: {
          insetInlineStart: "round(0px, 1px)",
          insetBlockStart: "round(0px, 1px)",
          inlineSize: "calc(round(0px, 1px) - round(0px, 1px))",
          blockSize: "calc(round(calc(1 * 100cqb), 1px) - round(0px, 1px))",
        },
        A: {
          insetInlineStart: "round(0px, 1px)",
          insetBlockStart: "round(0px, 1px)",
          inlineSize: "calc(round(calc(1 * 100cqi), 1px) - round(0px, 1px))",
          blockSize: "calc(round(calc(1 * 100cqb), 1px) - round(0px, 1px))",
        },
      },
      separators: [],
    },
  },
  {
    name: "a column inside a row splits the row's child top to bottom",
    root: split(
      "right",
      [pane("A"), share(1)],
      [split("down", [pane("B"), share(1)], [pane("C"), share(3)]), share(1)],
    ),
    expected: {
      panes: {
        A: {
          insetInlineStart: "round(0px, 1px)",
          insetBlockStart: "round(0px, 1px)",
          inlineSize: "calc(round(calc(0.5 * 100cqi + -0.5 * var(--gap)), 1px) - round(0px, 1px))",
          blockSize: "calc(round(calc(1 * 100cqb), 1px) - round(0px, 1px))",
        },
        B: {
          insetInlineStart: "round(calc(0.5 * 100cqi + 0.5 * var(--gap)), 1px)",
          insetBlockStart: "round(0px, 1px)",
          inlineSize:
            "calc(round(calc(1 * 100cqi), 1px) - round(calc(0.5 * 100cqi + 0.5 * var(--gap)), 1px))",
          blockSize: "calc(round(calc(0.25 * 100cqb + -0.25 * var(--gap)), 1px) - round(0px, 1px))",
        },
        C: {
          insetInlineStart: "round(calc(0.5 * 100cqi + 0.5 * var(--gap)), 1px)",
          insetBlockStart: "round(calc(0.25 * 100cqb + 0.75 * var(--gap)), 1px)",
          inlineSize:
            "calc(round(calc(1 * 100cqi), 1px) - round(calc(0.5 * 100cqi + 0.5 * var(--gap)), 1px))",
          blockSize:
            "calc(round(calc(1 * 100cqb), 1px) - round(calc(0.25 * 100cqb + 0.75 * var(--gap)), 1px))",
        },
      },
      separators: [
        "right-split:0 round(calc(0.5 * 100cqi + -0.5 * var(--gap)), 1px)",
        "down-split:0 round(calc(0.5 * 100cqi + 0.5 * var(--gap)), 1px)",
      ],
    },
  },
])("$name", (row) => {
  expect(styles(row.root)).toEqual(row.expected);
});

test("a zoomed pane covers the layout and the others keep their boxes", () => {
  const root = split("right", [pane("A"), share(1)], [pane("B"), share(1)]);
  const zoomed = styles(root, "B");

  expect(zoomed.panes).toEqual({
    A: {
      insetInlineStart: "round(0px, 1px)",
      insetBlockStart: "round(0px, 1px)",
      inlineSize: "calc(round(calc(0.5 * 100cqi + -0.5 * var(--gap)), 1px) - round(0px, 1px))",
      blockSize: "calc(round(calc(1 * 100cqb), 1px) - round(0px, 1px))",
    },
    B: {
      insetInlineStart: "round(0px, 1px)",
      insetBlockStart: "round(0px, 1px)",
      inlineSize: "calc(round(calc(1 * 100cqi), 1px) - round(0px, 1px))",
      blockSize: "calc(round(calc(1 * 100cqb), 1px) - round(0px, 1px))",
    },
  });
});
