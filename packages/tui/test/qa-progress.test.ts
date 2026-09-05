import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { BoxRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { TestRendererSetup } from "@opentui/core/testing";
import { DemoProgress } from "./qa/demo-progress.ts";

let setup: TestRendererSetup;

before(async () => {
  setup = await createTestRenderer({ width: 48, height: 12 });
});

after(() => setup.renderer.destroy());

void test("qa demo progress reserves space above the production app and reaches a full bar", async () => {
  const app = new BoxRenderable(setup.renderer, {
    id: "app",
    width: "100%",
    height: "100%",
  });
  setup.renderer.root.add(app);
  const progress = new DemoProgress(setup.renderer, app, 2);
  await setup.renderOnce();

  assert.match(setup.captureCharFrame(), /● QA  0\/2  Starting…/);
  assert.equal(app.screenY, 3);
  assert.equal(app.height, 9);

  progress.advance("Read src/server.ts");
  await setup.renderOnce();
  assert.match(setup.captureCharFrame(), /● QA  1\/2  Read src\/server\.ts/);

  progress.advance("Quit");
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  assert.match(frame, /● QA  2\/2  Quit/);
  assert.match(frame, /━{44}/u);
  assert.doesNotMatch(frame, /DEMOING|Preparing demo/);
});
