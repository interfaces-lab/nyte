import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { acceptedImageFiles, carriesFiles, dropHandlers } from "./composer-file-drop.ts";

function file(name: string, type: string): File {
  return new File(["x"], name, { type });
}

function dragEvent(args: { readonly types: readonly string[]; readonly files?: readonly File[] }) {
  let prevented = false;
  let stopped = false;
  const transfer = {
    types: args.types,
    files: args.files ?? [],
    dropEffect: "none",
  };
  return {
    dataTransfer: transfer,
    preventDefault: (): void => {
      prevented = true;
    },
    stopPropagation: (): void => {
      stopped = true;
    },
    prevented: () => prevented,
    stopped: () => stopped,
  };
}

describe("composer file drop", () => {
  test("carriesFiles is true only when the drag lists Files", () => {
    assert.equal(carriesFiles(dragEvent({ types: ["Files"] })), true);
    assert.equal(carriesFiles(dragEvent({ types: ["text/plain"] })), false);
    assert.equal(
      carriesFiles({ dataTransfer: null, preventDefault() {}, stopPropagation() {} }),
      false,
    );
  });

  test("acceptedImageFiles keeps gif jpeg png webp", () => {
    assert.deepEqual(
      acceptedImageFiles({
        files: [
          file("a.png", "image/png"),
          file("b.pdf", "application/pdf"),
          file("c.webp", "image/webp"),
          file("d.gif", "image/gif"),
          file("e.jpg", "image/jpeg"),
        ],
      }).map((item) => item.name),
      ["a.png", "c.webp", "d.gif", "e.jpg"],
    );
  });

  test("dropHandlers ignore tab drags and disabled drops", () => {
    const received: string[] = [];
    const handlers = dropHandlers({
      onFiles: (files) => {
        received.push(...files.map((item) => item.name));
      },
    });
    const tab = dragEvent({ types: ["text/plain"] });
    handlers.onDragOver(tab);
    handlers.onDrop(tab);
    assert.equal(tab.prevented(), false);
    assert.equal(received.length, 0);

    const disabled = dropHandlers({
      disabled: true,
      onFiles: (files) => {
        received.push(...files.map((item) => item.name));
      },
    });
    const blocked = dragEvent({ types: ["Files"], files: [file("a.png", "image/png")] });
    disabled.onDrop(blocked);
    assert.equal(blocked.prevented(), false);
    assert.equal(received.length, 0);
  });

  test("dropHandlers prevent navigation and pass accepted images", () => {
    const received: string[] = [];
    const handlers = dropHandlers({
      onFiles: (files) => {
        received.push(...files.map((item) => item.name));
      },
    });
    const event = dragEvent({
      types: ["Files"],
      files: [file("shot.png", "image/png"), file("notes.txt", "text/plain")],
    });
    handlers.onDragOver(event);
    handlers.onDrop(event);
    assert.equal(event.prevented(), true);
    assert.equal(event.stopped(), true);
    assert.equal(event.dataTransfer.dropEffect, "copy");
    assert.deepEqual(received, ["shot.png"]);
  });
});
