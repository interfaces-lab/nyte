import { memoryStore } from "@nyte-ai/core";
import { expect, it } from "vitest";
import canvas from "../src/canvas.ts";
import { fakeModels, open, until } from "./fake-models.ts";

const box = { kind: "rect", x: 0, y: 0, width: 10, height: 10, label: "box" } as const;

const circle = { kind: "ellipse", x: 5, y: 5, width: 4, height: 4 } as const;

const line = { kind: "line", x: 0, y: 0, width: 10, height: 0, label: "edge" } as const;

it("draws a new canvas from the tool, then adds shapes through its draw action, by a person and by the tool", async () => {
  const fake = fakeModels();

  fake.reply(
    { content: [{ type: "toolCall", id: "d1", name: "canvas_draw", arguments: { shapes: [box] } }] },
    { content: [{ type: "text", text: "Drawn." }] },
  );

  await using host = await open(fake, [canvas]);
  const session = await host.sessions.create();
  await (await session.send("Draw a box.")).settled();

  const drawn = await until(async () => (await session.view()).parts.find((part) => part.partKind === "canvas"));

  expect(drawn).toMatchObject({ placement: { kind: "panel" }, state: { shapes: [box] }, owner: "canvas" });
  expect(await session.part(drawn.id).act("draw", { shapes: [circle] })).toEqual({ kind: "ok", output: undefined });

  fake.reply(
    { content: [{ type: "toolCall", id: "d2", name: "canvas_draw", arguments: { canvas: drawn.id, shapes: [line] } }] },
    { content: [{ type: "text", text: "Added." }] },
  );
  await (await session.send("Add an edge.")).settled();

  const after = (await session.view()).parts.find((part) => part.id === drawn.id);

  expect(after).toMatchObject({ state: { shapes: [box, circle, line] }, version: 3 });
});

it("draws on a canvas from a cold host sharing the store, which resolves the canvas's owner (§48h)", async () => {
  const store = memoryStore();
  const fake = fakeModels();

  fake.reply(
    { content: [{ type: "toolCall", id: "d1", name: "canvas_draw", arguments: { shapes: [box] } }] },
    { content: [{ type: "text", text: "Drawn." }] },
  );

  await using warm = await open(fake, [canvas], { store });
  const session = await warm.sessions.create();
  await (await session.send("Draw a box.")).settled();
  const drawn = await until(async () => (await session.view()).parts.find((part) => part.partKind === "canvas"));

  await using cold = await open(fakeModels(), [canvas], { store, execution: { kind: "admit-only" } });

  expect(await cold.session(session.id).part(drawn.id).act("draw", { shapes: [circle] })).toEqual({ kind: "ok", output: undefined });
  expect((await cold.session(session.id).view()).parts.find((part) => part.id === drawn.id)).toMatchObject({ state: { shapes: [box, circle] } });
});
