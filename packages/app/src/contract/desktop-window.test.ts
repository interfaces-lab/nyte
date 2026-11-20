import { expect, test } from "vitest";
import { windowOpening } from "./desktop-window.ts";
import type { DesktopWindow } from "./desktop-window.ts";

const workspace = { id: "w1", path: "/finder", name: "finder" };

const folder = JSON.stringify({ kind: "folder", workspace });

const file = JSON.stringify({ kind: "file", path: "/notes/today.md" });

test.each<{
  readonly name: string;
  readonly open: string | undefined;
  readonly reloaded: boolean;
  readonly opens: string | undefined;
  readonly workspace: typeof workspace | undefined;
}>([
  {
    name: "a window nothing opened",
    open: undefined,
    reloaded: false,
    opens: undefined,
    workspace: undefined,
  },
  {
    name: "the first page of a folder's window",
    open: folder,
    reloaded: false,
    opens: folder,
    workspace,
  },
  {
    name: "a reload of a folder's window",
    open: folder,
    reloaded: true,
    opens: undefined,
    workspace,
  },
  {
    name: "the first page of a loose file's window",
    open: file,
    reloaded: false,
    opens: file,
    workspace: undefined,
  },
  {
    name: "a reload of a loose file's window",
    open: file,
    reloaded: true,
    opens: undefined,
    workspace: undefined,
  },
])("a page of $name", (row) => {
  const window: DesktopWindow = {
    id: "w",
    app: "nyte",
    launch: undefined,
    open: row.open,
    reloaded: row.reloaded,
  };

  const opening = windowOpening(window);

  expect([opening.window.open, opening.workspace]).toEqual([row.opens, row.workspace]);
});
