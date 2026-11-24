import { Children, Fragment, isValidElement } from "react";
import type { ReactNode } from "react";
import { kit } from "./index.ts";

export type FloorRule = "lead" | "gap" | "inset" | "overlap" | "clip" | "overflow";

export interface Floor {
  readonly steps: number;
  readonly holds: string;
  readonly kit: string;
  readonly fix: string;
}

export const LAYOUT_FLOOR = {
  lead: {
    steps: 3,
    holds: "between a Heading or Text and the surface or block it introduces",
    kit: "Stack and Card leave it before the block, whatever gap the canvas asks for",
    fix: "Put the title in the Card's or Section's `title`, or set the Stack's gap to 3",
  },
  gap: {
    steps: 2,
    holds: "between two surfaces or blocks, and between a block and the text after it",
    kit: "Stack and Card leave it between the pair; Grid raises its gap to it",
    fix: "Set the Stack's or Grid's gap to 2 or more",
  },
  inset: {
    steps: 1,
    holds: "between text and the edges of the surface around it",
    kit: "Card's padding never drops below 2; with padding 0 everything but a Table, KeyValue, Divider or Panes is inset",
    fix: "Drop `padding={0}`, which is only for a Table, KeyValue, Divider or Panes that runs edge to edge",
  },
  overlap: {
    steps: 0,
    holds: "between text and text, or text and a surface, that neither contains",
    kit: "Card titles wrap instead of running under the actions",
    fix: "Give the content more room: fewer Grid columns, a larger minWidth, or a shorter label",
  },
  clip: {
    steps: 0,
    holds: "between content and an ancestor that hides its overflow",
    kit: "Chart axes and legends are measured into the chart's own box",
    fix: "Give the chart or its container more room, or shorten the labels with a format function",
  },
  overflow: {
    steps: 0,
    holds: "between content and the canvas's width, or the surface it sits in",
    kit: "Fixed Grid columns fold onto more rows before a column drops under 30 steps",
    fix: "Let it wrap: a Grid with columns 'auto', a Stack with `wrap`, or a narrower fixed width",
  },
} as const satisfies Readonly<Record<FloorRule, Floor>>;

export const GRID_COLUMN_FLOOR = 30;

export type LayoutRole = "surface" | "text" | "block" | "flush";

export const KIT_ROLES = new Map<string, LayoutRole>([
  ["Card", "surface"],
  ["Callout", "surface"],
  ["Code", "surface"],
  ["Panes", "flush"],
  ["Heading", "text"],
  ["Text", "text"],
  ["Stack", "block"],
  ["Grid", "block"],
  ["Section", "block"],
  ["Stat", "block"],
  ["Meter", "block"],
  ["Steps", "block"],
  ["Tracker", "block"],
  ["BarList", "block"],
  ["StackedBars", "block"],
  ["LineChart", "block"],
  ["BarChart", "block"],
  ["PieChart", "block"],
  ["Tabs", "block"],
  ["Table", "flush"],
  ["KeyValue", "flush"],
  ["Divider", "flush"],
]);

const kitNames = new Map<unknown, string>();

export function findKitName(type: unknown): string | undefined {
  if (kitNames.size === 0) {
    for (const [name, value] of Object.entries(kit)) {
      if (typeof value === "function") kitNames.set(value, name);

      if (typeof value === "object" && value !== null) {
        for (const [part, member] of Object.entries(value)) {
          if (typeof member === "function") kitNames.set(member, `${name}.${part}`);
        }
      }
    }
  }

  return kitNames.get(type);
}

export function findLayoutRole(node: ReactNode): LayoutRole | undefined {
  if (typeof node === "string" || typeof node === "number") return "text";

  if (!isValidElement(node)) return undefined;
  const name = findKitName(node.type);

  if (name === undefined) return undefined;

  if (name === "Code") {
    return typeof node.props === "object" && node.props !== null && "block" in node.props
      ? node.props.block === true
        ? "surface"
        : undefined
      : undefined;
  }

  return KIT_ROLES.get(name.split(".")[0] ?? name);
}

const STRENGTH: readonly (LayoutRole | undefined)[] = [
  undefined,
  "text",
  "block",
  "flush",
  "surface",
];

interface FlowProps {
  readonly children?: ReactNode;
  readonly direction?: unknown;
}

export function findEdgeRole(node: ReactNode, edge: "start" | "end"): LayoutRole | undefined {
  const role = findLayoutRole(node);

  if (!isValidElement<FlowProps>(node) || (role !== "block" && node.type !== Fragment)) return role;
  const name = findKitName(node.type);

  if (node.type !== Fragment && name !== "Stack" && name !== "Grid") return role;
  const nodes = Children.toArray(node.props.children);

  if (name !== "Grid" && node.props.direction !== "row") {
    return findEdgeRole(edge === "start" ? nodes[0] : nodes.at(-1), edge);
  }

  return nodes
    .map((child) => findEdgeRole(child, edge))
    .reduce<LayoutRole | undefined>(
      (strongest, next) =>
        STRENGTH.indexOf(next) > STRENGTH.indexOf(strongest) ? next : strongest,
      undefined,
    );
}

export function pairFloor(
  before: LayoutRole | undefined,
  after: LayoutRole | undefined,
  axis: "block" | "inline",
): number {
  if (before === undefined || after === undefined) return 0;

  if (before === "text" && after === "text") return 0;

  if (before === "text" && axis === "block") return LAYOUT_FLOOR.lead.steps;

  return LAYOUT_FLOOR.gap.steps;
}

export interface FlowItem {
  readonly node: ReactNode;
  readonly space: number;
}

export function flowItems(
  children: ReactNode,
  gap: number,
  axis: "block" | "inline",
): readonly FlowItem[] | undefined {
  const nodes = Children.toArray(children);

  const floors = nodes.map((node, index) =>
    index === 0
      ? 0
      : pairFloor(findEdgeRole(nodes[index - 1], "end"), findEdgeRole(node, "start"), axis),
  );

  if (floors.every((floor) => floor <= gap)) return undefined;

  return nodes.map((node, index) => ({
    node,
    space: index === 0 ? 0 : Math.max(gap, floors[index] ?? 0),
  }));
}

export function snapStep<Step extends number>(
  value: unknown,
  steps: readonly Step[],
  fallback: Step,
): Step {
  const wanted = typeof value === "number" ? value : Number(value);

  if (typeof value === "boolean" || value === null || !Number.isFinite(wanted)) return fallback;

  return steps.reduce((best, step) =>
    Math.abs(step - wanted) < Math.abs(best - wanted) ||
    (Math.abs(step - wanted) === Math.abs(best - wanted) && step > best)
      ? step
      : best,
  );
}
