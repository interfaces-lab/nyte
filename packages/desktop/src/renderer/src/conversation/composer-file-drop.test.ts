import { expect, test, vi } from "vitest";
import { dropHandlers } from "./composer-file-drop.ts";

test("rejected drops prevent navigation without attaching files", () => {
  for (const { disabled, dataTransfer } of [
    { disabled: false, dataTransfer: null },
    { disabled: false, dataTransfer: { types: ["text/plain"], files: [], dropEffect: "copy" } },
    {
      disabled: true,
      dataTransfer: { types: ["Files"], files: [new File(["x"], "a.png")], dropEffect: "copy" },
    },
  ]) {
    const onFiles = vi.fn();
    const handlers = dropHandlers({ disabled, onFiles });
    const over = Object.assign(new Event("dragover", { cancelable: true }), { dataTransfer });
    handlers.onDragOver(over);
    expect(over.defaultPrevented).toBe(true);
    if (dataTransfer !== null) expect(dataTransfer.dropEffect).toBe("none");

    const drop = Object.assign(new Event("drop", { cancelable: true }), { dataTransfer });
    handlers.onDrop(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(drop.cancelBubble).toBe(true);
    expect(onFiles).not.toHaveBeenCalled();
  }
});

test("accepted drops prevent navigation and attach every file once", () => {
  const files = [new File(["x"], "shot.png"), new File(["x"], "clip.mp4")];
  const dataTransfer = { types: ["Files"], files, dropEffect: "none" };
  const onFiles = vi.fn();
  const handlers = dropHandlers({ onFiles });
  const over = Object.assign(new Event("dragover", { cancelable: true }), { dataTransfer });
  handlers.onDragOver(over);
  expect(over.defaultPrevented).toBe(true);
  expect(dataTransfer.dropEffect).toBe("copy");

  const drop = Object.assign(new Event("drop", { cancelable: true }), { dataTransfer });
  handlers.onDrop(drop);
  expect(drop.defaultPrevented).toBe(true);
  expect(drop.cancelBubble).toBe(true);
  expect(onFiles).toHaveBeenCalledExactlyOnceWith(files);
});
