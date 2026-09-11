import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  placementInRect,
  SESSION_DRAG_ACTIVATION_DISTANCE,
} from "../src/renderer/src/layout/session-dnd-geometry.ts";

describe("session drag geometry", () => {
  test("uses an eight-pixel pointer activation threshold", () => {
    assert.equal(SESSION_DRAG_ACTIVATION_DISTANCE, 8);
  });

  test("reserves the central quarter only when an existing split can accept it", () => {
    const rect = { top: 0, left: 0, right: 400, bottom: 200, width: 400, height: 200 };
    assert.equal(placementInRect(rect, { x: 200, y: 100 }, true), "center");
    assert.equal(placementInRect(rect, { x: 200, y: 100 }, false), "left");
    assert.equal(placementInRect(rect, { x: 20, y: 100 }, true), "left");
    assert.equal(placementInRect(rect, { x: 380, y: 100 }, true), "right");
    assert.equal(placementInRect(rect, { x: 200, y: 10 }, true), "top");
    assert.equal(placementInRect(rect, { x: 200, y: 190 }, true), "bottom");
  });
});
