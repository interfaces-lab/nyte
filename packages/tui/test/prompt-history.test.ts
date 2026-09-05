import assert from "node:assert/strict";
import { afterAll, afterEach, beforeAll, beforeEach, describe, test } from "vitest";
import { TextareaRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { TestRendererSetup } from "@opentui/core/testing";
import { commandBindings } from "@opentui/keymap/extras";
import { CHAT_KEYBINDS } from "../src/constants.ts";
import { createChatKeymap } from "../src/keymap.ts";
import { browseHistory, PromptHistory } from "../src/prompt-history.ts";

/**
 * Up and Down are bound in the keymap and decline into the composer, so these
 * press the real keys at a real wrapped textarea: the row geometry under test
 * is OpenTUI's, not a stand-in for it.
 */
describe("prompt history over a wrapped draft", () => {
  let setup: TestRendererSetup;
  let keymap: ReturnType<typeof createChatKeymap>;
  let input: TextareaRenderable;
  let history: PromptHistory;
  let dispose: () => void;

  const COLUMNS = 20;
  /** Three words fill a row of `COLUMNS`, so this wraps to four rows with no newline in it. */
  const PARAGRAPH = Array.from({ length: 12 }, (_, index) => `word${String(index)}`).join(" ");

  const caretRow = (): number => input.scrollY + input.visualCursor.visualRow;

  const press = async (direction: "up" | "down"): Promise<void> => {
    setup.mockInput.pressArrow(direction);
    await setup.renderOnce();
  };

  /** Types the draft the way a paste lands: text in, caret after it. */
  const draft = async (text: string): Promise<number> => {
    input.setText(text);
    input.gotoBufferEnd();
    await setup.renderOnce();
    return input.cursorOffset;
  };

  beforeAll(async () => {
    setup = await createTestRenderer({ width: 40, height: 12, kittyKeyboard: true });
    keymap = createChatKeymap(setup.renderer);
  });

  beforeEach(async () => {
    for (const child of setup.renderer.root.getChildren()) child.destroyRecursively();
    // Shorter than the paragraph, so the top row scrolls out of view.
    input = new TextareaRenderable(setup.renderer, {
      id: "input",
      width: COLUMNS,
      maxHeight: 3,
      wrapMode: "word",
    });
    setup.renderer.root.add(input);
    input.focus();
    await setup.renderOnce();
    history = new PromptHistory();
    history.replace(["first", "second"]);
    dispose = keymap.registerLayer({
      enabled: () => true,
      commands: [
        {
          name: "chat.history.previous",
          category: "Chat",
          title: "Previous message you sent",
          run: () => browseHistory(input, history, "previous"),
        },
        {
          name: "chat.history.next",
          category: "Chat",
          title: "Next message you sent",
          run: () => browseHistory(input, history, "next"),
        },
      ],
      bindings: commandBindings({
        "chat.history.previous": CHAT_KEYBINDS["chat.history.previous"],
        "chat.history.next": CHAT_KEYBINDS["chat.history.next"],
      }),
    });
  });

  afterEach(() => {
    dispose();
  });

  afterAll(() => {
    setup.renderer.destroy();
  });

  test("up climbs the wrapped rows of a paragraph before it recalls anything", async () => {
    await draft(PARAGRAPH);
    assert.equal(caretRow(), 3);
    assert.ok(input.scrollY > 0, "the first row is scrolled out of view");

    await press("up");
    assert.equal(input.plainText, PARAGRAPH);
    assert.equal(caretRow(), 2);
    await press("up");
    assert.equal(caretRow(), 1);
    await press("up");
    assert.equal(caretRow(), 0);
    assert.notEqual(input.cursorOffset, 0);

    await press("up");
    assert.equal(input.plainText, PARAGRAPH, "the top row goes to the start first");
    assert.equal(input.cursorOffset, 0);

    await press("up");
    assert.equal(input.plainText, "second");
    assert.equal(input.cursorOffset, 0);
    await press("up");
    assert.equal(input.plainText, "first");
    await press("up");
    assert.equal(input.plainText, "first", "the oldest entry is where the walk ends");
  });

  test("down descends the rows, reaches the end, and only then leaves the draft", async () => {
    const end = await draft(PARAGRAPH);
    input.cursorOffset = 0;
    await setup.renderOnce();

    await press("down");
    assert.equal(caretRow(), 1);
    await press("down");
    assert.equal(caretRow(), 2);
    await press("down");
    assert.equal(caretRow(), 3);
    assert.notEqual(input.cursorOffset, end);

    await press("down");
    assert.equal(input.plainText, PARAGRAPH, "the bottom row goes to the end first");
    assert.equal(input.cursorOffset, end);

    await press("down");
    assert.equal(input.plainText, PARAGRAPH, "nothing newer than a draft that was never left");
    assert.equal(input.cursorOffset, end);
  });

  test("down walks forward through history and hands the stashed draft back", async () => {
    const end = await draft(PARAGRAPH);
    for (let presses = 0; presses < 6; presses += 1) await press("up");
    assert.equal(input.plainText, "first");
    assert.equal(input.cursorOffset, 0);

    // Turning around crosses the entry once; from then on each press is one
    // entry, since a recalled entry lands with the caret already at its end.
    await press("down");
    assert.equal(input.plainText, "first");
    assert.notEqual(input.cursorOffset, 0);
    await press("down");
    assert.equal(input.plainText, "second");
    await press("down");
    assert.equal(input.plainText, PARAGRAPH);
    assert.equal(input.cursorOffset, end, "the draft comes back with the caret where it was");
    await press("down");
    assert.equal(input.plainText, PARAGRAPH, "nothing newer than the draft");
  });

  test("newline-delimited lines still walk one at a time", async () => {
    await draft("one\ntwo");
    assert.equal(caretRow(), 1);

    await press("up");
    assert.equal(input.plainText, "one\ntwo");
    assert.equal(caretRow(), 0);
    await press("up");
    assert.equal(input.cursorOffset, 0);
    await press("up");
    assert.equal(input.plainText, "second");
  });

  test("an empty composer recalls at once and comes back empty", async () => {
    await draft("");

    await press("up");
    assert.equal(input.plainText, "second");
    await press("down");
    assert.equal(input.plainText, "second");
    await press("down");
    assert.equal(input.plainText, "");
  });

  test("the end of a wide-character entry is found in cells, not characters", async () => {
    history.replace(["日本語 first", "second"]);
    await draft("");

    await press("up");
    await press("up");
    assert.equal(input.plainText, "日本語 first");
    await press("down");
    assert.equal(input.plainText, "日本語 first");
    await press("down");
    assert.equal(input.plainText, "second");
  });
});
