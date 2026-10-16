import { expect, test } from "bun:test";
import { asId } from "@nyte-ai/schema";
import type { TreeNode } from "@nyte-ai/sdk";
import type { TreeDialog } from "../../src/model/dialogs/tree.ts";
import { renderDialog, rows } from "../ui/dialogs/harness.tsx";

function node(id: string, parent: string | null, kind: TreeNode["kind"], partKind: string | null, preview: string, active: boolean): TreeNode {
  return { id: asId(id), parent: parent === null ? null : asId(parent), depth: 0, branch: false, active, heads: [], kind, partKind, preview, at: 0, run: null };
}

const N = 40;
const NODES = Array.from({ length: N }, (_, i) =>
  node(`c${i}`, i === 0 ? null : `c${i - 1}`, i % 2 === 0 ? "user" : "part", i % 2 === 0 ? null : "text", `msg ${i}`, true),
);

const TREE: TreeDialog = {
  kind: "tree", id: "t1",
  tree: { kind: "ready", load: { view: { revision: null, tip: { kind: "commit", id: asId(`c${N - 1}`) }, nodes: NODES }, tip: asId(`c${N - 1}`) } },
  filter: "default", query: "", folded: new Set(), selected: null, composerEmpty: true,
};

test("click picks the clicked row", async () => {
  await using app = await renderDialog(TREE, { height: 32 });
  await app.renderOnce();
  await app.send({ kind: "key", name: "picker.previous" });
  await app.send({ kind: "key", name: "picker.next" });
  await app.renderOnce();
  const frame = app.frame();
  console.log(frame);
  for (const target of ["msg 31", "msg 35", "msg 38"]) {
    const y = rows(app.frame()).findIndex((r) => r.endsWith(target));
    app.dispatched.length = 0;
    await app.mockMouse.click(20, y);
    await app.renderOnce();
    console.log(target, y, JSON.stringify(app.dispatched));
  }
});
