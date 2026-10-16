import { test } from "bun:test";
import type { Store } from "../../src/app/store.ts";
import { openTestHost } from "../fixture/host.ts";
import { startApp } from "../app/start.tsx";

const idle = (store: Store): boolean => store.screen().run.kind === "idle";

test("tree click in real app", async () => {
  await using fixture = await openTestHost();
  fixture.reply(
    { content: [{ type: "text", text: "Answer one." }] },
    { content: [{ type: "text", text: "Answer two." }] },
    { content: [{ type: "text", text: "Answer three." }] },
  );
  await using app = await startApp(fixture, { height: 40 } as never);
  await app.ready();
  for (const msg of ["first q", "second q", "third q"]) {
    await app.mockInput.typeText(msg);
    app.mockInput.pressEnter();
    await app.frame((f) => f.includes(msg));
    await app.state(idle);
    await new Promise((r) => setTimeout(r, 100));
    await app.state(idle);
  }
  await app.mockInput.typeText("/tree");
  app.mockInput.pressEnter();
  const frame = await app.frame((f) => f.includes("Session Tree") && f.includes("Answer three"));
  console.log(frame);
  const d = app.store.state().local.dialogs.at(-1) as any;
  console.log(JSON.stringify(d.tree.load.view.nodes.map((n: any) => [n.id.slice(0,6), n.parent?.slice(0,6), n.kind, n.partKind, n.preview, n.active]), null, 0), d.tree.load.tip);
  const lines = frame.split("\n");
  const y = lines.findIndex((l) => l.includes("user: second q"));
  console.log("click y", y);
  await app.mockMouse.click(10, y);
  await app.renderOnce();
  await new Promise((r) => setTimeout(r, 300));
  await app.renderOnce();
  console.log(app.renderer ? (await app.frame(() => true)) : "");
  console.log(JSON.stringify(app.store.state().local.notice ?? app.store.screen().notice ?? null));
});
