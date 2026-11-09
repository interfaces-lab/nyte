import { expect, test } from "vitest";
import { routeOpenedPath } from "./open-with.ts";
import type { OpenRoute } from "./open-with.ts";

const windows = [
  { window: 1, root: "/work/app" },
  { window: 2, root: "/work/app/packages/ui" },
  { window: 3, root: "/notes" },
];

test.each<{
  readonly name: string;
  readonly path: string;
  readonly folder: boolean;
  readonly route: OpenRoute;
}>([
  {
    name: "a folder gets a new window, even inside a window's root",
    path: "/work/app/src",
    folder: true,
    route: { kind: "new-window" },
  },
  {
    name: "a file goes to the window whose root holds it",
    path: "/notes/today.md",
    folder: false,
    route: { kind: "window", window: 3 },
  },
  {
    name: "the deepest root wins",
    path: "/work/app/packages/ui/src/button.tsx",
    folder: false,
    route: { kind: "window", window: 2 },
  },
  {
    name: "a file beside a nested root stays with the outer root",
    path: "/work/app/packages/core/index.ts",
    folder: false,
    route: { kind: "window", window: 1 },
  },
  {
    name: "a root's name as a prefix doesn't hold a sibling folder's file",
    path: "/work/application/readme.md",
    folder: false,
    route: { kind: "new-window" },
  },
  {
    name: "a file outside every root gets a new window",
    path: "/tmp/scratch.txt",
    folder: false,
    route: { kind: "new-window" },
  },
])("$name", ({ path, folder, route }) => {
  expect(routeOpenedPath({ path, folder }, windows)).toEqual(route);
});
