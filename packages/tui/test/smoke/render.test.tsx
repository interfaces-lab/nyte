import { expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { render } from "../fixture/render.tsx";

test("render draws a Solid tree and redraws on a signal", async () => {
  const [label, setLabel] = createSignal("idle");
  await using app = await render(() => <text>status: {label()}</text>);

  expect(app.captureCharFrame()).toContain("status: idle");
  setLabel("working");
  await app.renderOnce();
  expect(app.captureCharFrame()).toContain("status: working");
});
