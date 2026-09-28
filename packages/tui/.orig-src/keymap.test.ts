import { commandBindings } from "@opentui/keymap/extras";
import { expect, test } from "bun:test";
import { mountShell } from "./app/App.tsx";
import { readAuthPrompt } from "./auth-prompt.ts";
import { deliveryChoices } from "./lanes.ts";
import { DARK_THEME } from "./theme.ts";
import { MouseButton, TextareaRenderable, TextRenderable } from "@opentui/core";
import { createTestRenderer, ManualClock } from "@opentui/core/testing";
import { createChatKeymap, registerSelectionKeys } from "./keymap.ts";

test("Ctrl+C copies highlighted text without passing through to cancellation", async () => {
  const setup = await createTestRenderer({ width: 60, height: 12, kittyKeyboard: true });
  const keymap = createChatKeymap(setup.renderer);
  const writes: string[] = [];
  const unregister = registerSelectionKeys(keymap, setup.renderer, {
    copy: (text) => {
      writes.push(text);
    },
    copyOnSelect: () => false,
  });
  try {
    const text = new TextRenderable(setup.renderer, { content: "ABCD-1234", selectable: true });
    setup.renderer.root.add(text);
    await setup.renderOnce();
    setup.renderer.startSelection(text, text.x, text.y);
    setup.renderer.updateSelection(text, text.x + 8, text.y, { finishDragging: true });
    await setup.renderOnce();
    expect(setup.renderer.getSelection()?.getSelectedText()).toBe("ABCD-1234");
    let cancelled = false;
    setup.renderer.keyInput.on("keypress", (event) => {
      if (!event.defaultPrevented) cancelled = true;
    });
    setup.mockInput.pressKey("c", { ctrl: true });
    await setup.renderOnce();
    expect(writes).toEqual(["ABCD-1234"]);
    expect(cancelled).toBe(false);
  } finally {
    unregister();
    setup.renderer.destroy();
  }
});

test("Ctrl+C copies during an auth prompt and cancels only after selection is cleared", async () => {
  const setup = await createTestRenderer({ width: 60, height: 20 });
  const shell = await mountShell({
    renderer: setup.renderer,
    initialTheme: DARK_THEME,
    roles: deliveryChoices,
    openPath: () => undefined,
  });
  const writes: string[] = [];
  const unregister = registerSelectionKeys(shell.keymap, setup.renderer, {
    copy: (text) => {
      writes.push(text);
    },
    copyOnSelect: () => false,
  });
  const controller = new AbortController();
  let cancelled = false;
  const prompt = readAuthPrompt(
    shell,
    { type: "text", message: "Enter authorization code" },
    controller.signal,
  ).catch(() => {
    cancelled = true;
  });
  try {
    const text = new TextRenderable(setup.renderer, { content: "ABCD-1234", selectable: true });
    setup.renderer.root.add(text);
    await setup.renderOnce();
    setup.renderer.startSelection(text, text.x, text.y);
    setup.renderer.updateSelection(text, text.x + 8, text.y, { finishDragging: true });
    await setup.renderOnce();
    setup.mockInput.pressKey("c", { ctrl: true });
    await setup.renderOnce();
    expect(writes).toEqual(["ABCD-1234"]);
    expect(cancelled).toBe(false);
    setup.renderer.clearSelection();
    await setup.renderOnce();
    setup.mockInput.pressKey("c", { ctrl: true });
    await prompt;
    expect(cancelled).toBe(true);
  } finally {
    controller.abort();
    await prompt;
    unregister();
    setup.renderer.destroy();
  }
});

test("copy-on-select copies on mouse release and Ctrl+C falls through after clearing", async () => {
  const setup = await createTestRenderer({ width: 60, height: 12, kittyKeyboard: true });
  const keymap = createChatKeymap(setup.renderer);
  const writes: string[] = [];
  const unregister = registerSelectionKeys(keymap, setup.renderer, {
    copy: (text) => {
      writes.push(text);
    },
    copyOnSelect: () => true,
  });
  try {
    const text = new TextRenderable(setup.renderer, { content: "ABCD-1234", selectable: true });
    setup.renderer.root.add(text);
    await setup.renderOnce();
    await setup.mockMouse.drag(text.x, text.y, text.x + 8, text.y);
    await setup.renderOnce();
    expect(writes).toEqual(["ABCD-1234"]);
    let reachedApp = false;
    const offApp = keymap.registerLayer({
      commands: [
        {
          name: "cancel",
          run: () => {
            reachedApp = true;
          },
        },
      ],
      bindings: commandBindings({ cancel: "ctrl+c" }),
    });
    setup.mockInput.pressKey("c", { ctrl: true });
    await setup.renderOnce();
    expect(setup.renderer.getSelection()).toBeNull();
    expect(writes).toEqual(["ABCD-1234"]);
    expect(reachedApp).toBe(true);
    offApp();
  } finally {
    unregister();
    setup.renderer.destroy();
  }
});

test("Escape dismisses a nonempty selection before reaching app bindings", async () => {
  const setup = await createTestRenderer({ width: 60, height: 12, kittyKeyboard: true });
  const keymap = createChatKeymap(setup.renderer);
  const unregister = registerSelectionKeys(keymap, setup.renderer, {
    copy: () => {
      throw new Error("Escape must not copy");
    },
    copyOnSelect: () => false,
  });
  try {
    const text = new TextRenderable(setup.renderer, { content: "ABCD-1234", selectable: true });
    setup.renderer.root.add(text);
    await setup.renderOnce();
    await setup.mockMouse.drag(text.x, text.y, text.x + 8, text.y);
    let reachedApp = false;
    setup.renderer.keyInput.on("keypress", (event) => {
      if (!event.defaultPrevented) reachedApp = true;
    });
    setup.mockInput.pressEscape();
    await setup.renderOnce();
    expect(setup.renderer.getSelection()).toBeNull();
    expect(reachedApp).toBe(false);
    setup.mockInput.pressEscape();
    await setup.renderOnce();
    expect(reachedApp).toBe(true);
  } finally {
    unregister();
    setup.renderer.destroy();
  }
});

async function selectionFixture(copyOnSelect: boolean) {
  const setup = await createTestRenderer({
    width: 40,
    height: 8,
    kittyKeyboard: true,
    clock: new ManualClock(),
  });
  const keymap = createChatKeymap(setup.renderer);
  const writes: string[] = [];
  const unregister = registerSelectionKeys(keymap, setup.renderer, {
    copy: (text) => {
      writes.push(text);
    },
    copyOnSelect: () => copyOnSelect,
  });
  const text = new TextRenderable(setup.renderer, {
    content: "alpha beta gamma",
    selectable: true,
  });
  setup.renderer.root.add(text);
  return {
    ...setup,
    text,
    writes,
    dispose() {
      unregister();
      setup.renderer.destroy();
    },
  };
}

test.each([false, true])(
  "right-click copies only in manual mode, copyOnSelect=%s",
  async (mode) => {
    const app = await selectionFixture(mode);
    try {
      await app.renderOnce();
      await app.mockMouse.drag(6, 0, 9, 0);
      expect(app.writes).toEqual(mode ? ["beta"] : []);
      await app.mockMouse.click(7, 0, MouseButton.RIGHT);
      expect(app.writes).toEqual(["beta"]);
      expect(app.renderer.getSelection()?.getSelectedText()).toBe("beta");
      await app.mockMouse.click(7, 0, MouseButton.RIGHT);
      expect(app.writes).toEqual(mode ? ["beta"] : ["beta", "beta"]);
    } finally {
      app.dispose();
    }
  },
);

test.each([6, 17])("copy-on-select preserves word and line clicks at column %s", async (column) => {
  const app = await selectionFixture(true);
  try {
    await app.renderOnce();
    await app.mockMouse.click(column, 0);
    expect(app.writes).toEqual([]);
    await app.mockMouse.click(column, 0);
    expect(app.writes).toEqual(column === 6 ? ["beta"] : []);
    await app.mockMouse.click(column, 0);
    expect(app.writes).toEqual(column === 6 ? ["beta", "alpha beta gamma"] : ["alpha beta gamma"]);
    expect(app.renderer.getSelection()?.getSelectedText()).toBe("alpha beta gamma");
  } finally {
    app.dispose();
  }
});

test.each([false, true])(
  "editor selection copies and remains editable, copyOnSelect=%s",
  async (mode) => {
    const app = await selectionFixture(mode);
    const editor = new TextareaRenderable(app.renderer, {
      width: 40,
      height: 1,
      initialValue: "draft",
    });
    app.renderer.root.add(editor);
    editor.focus();
    try {
      await app.renderOnce();
      app.mockInput.pressKey("END");
      app.mockInput.pressArrow("left", { shift: true });
      app.mockInput.pressCtrlC();
      // Non-Latin Kitty key with Latin base-layout C.
      app.mockInput.pressKey("\x1b[1089::99;5u");
      expect(app.writes).toEqual(["t", "t"]);
      expect(app.renderer.getSelection()?.getSelectedText()).toBe("t");
      app.mockInput.pressArrow("left", { shift: true });
      expect(app.renderer.getSelection()?.getSelectedText()).toBe("ft");
      app.mockInput.pressKey("x");
      expect(editor.plainText).toBe("drax");
      expect(app.renderer.hasSelection).toBe(false);
    } finally {
      app.dispose();
    }
  },
);

test.each(["escape", "c"])("an empty selection lets %s reach the app", async (key) => {
  const app = await selectionFixture(false);
  try {
    await app.renderOnce();
    await app.mockMouse.click(6, 0);
    let reachedApp = false;
    app.renderer.keyInput.on("keypress", (event) => {
      if (!event.defaultPrevented) reachedApp = true;
    });
    app.mockInput.pressKey(key, { ctrl: key === "c" });
    expect(app.writes).toEqual([]);
    expect(reachedApp).toBe(true);
    expect(app.renderer.hasSelection).toBe(false);
  } finally {
    app.dispose();
  }
});
