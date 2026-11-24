import { asId } from "@nyte-ai/schema";
import { expect, test } from "vitest";
import { windowOpening } from "./desktop-window.ts";
import type { DesktopWindow } from "./desktop-window.ts";

const workspace = { id: asId<"workspace">("w1"), path: "/finder", name: "finder" };

const picked = { id: asId<"workspace">("w2"), path: "/picked", name: "picked" };

const folder = JSON.stringify({ kind: "folder", workspace });

const file = JSON.stringify({ kind: "file", path: "/notes/today.md" });

test.each<{
  readonly name: string;
  readonly open: string | undefined;
  readonly reloaded: boolean;
  readonly remembered: typeof workspace | null | undefined;
  readonly opens: string | undefined;
  readonly workspace: typeof workspace | undefined;
}>([
  {
    name: "a window nothing opened",
    open: undefined,
    reloaded: false,
    remembered: undefined,
    opens: undefined,
    workspace: undefined,
  },
  {
    name: "the first page of a folder's window",
    open: folder,
    reloaded: false,
    remembered: undefined,
    opens: folder,
    workspace,
  },
  {
    name: "a reload of a folder's window",
    open: folder,
    reloaded: true,
    remembered: undefined,
    opens: undefined,
    workspace,
  },
  {
    name: "the first page of a loose file's window",
    open: file,
    reloaded: false,
    remembered: undefined,
    opens: file,
    workspace: undefined,
  },
  {
    name: "a reload of a loose file's window",
    open: file,
    reloaded: true,
    remembered: undefined,
    opens: undefined,
    workspace: undefined,
  },
  {
    name: "a reload of a folder's window that moved to another folder",
    open: folder,
    reloaded: true,
    remembered: picked,
    opens: undefined,
    workspace: picked,
  },
  {
    name: "a reload of a folder's window that chose Home",
    open: folder,
    reloaded: true,
    remembered: null,
    opens: undefined,
    workspace: undefined,
  },
  {
    name: "the first page of a folder's window, whatever an earlier page showed",
    open: folder,
    reloaded: false,
    remembered: picked,
    opens: folder,
    workspace,
  },
])("a page of $name", (row) => {
  const window: DesktopWindow = {
    id: "w",
    app: "nyte",
    launch: undefined,
    open: row.open,
    reloaded: row.reloaded,
  };

  const opening = windowOpening(window, row.remembered);

  expect([opening.window.open, opening.workspace]).toEqual([row.opens, row.workspace]);
});
