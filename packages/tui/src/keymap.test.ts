import { commandBindings } from "@opentui/keymap/extras";
import { expect, test } from "bun:test";
import { mountShell } from "./app/App.tsx";
import { readAuthPrompt } from "./auth-prompt.ts";
import { deliveryChoices } from "./lanes.ts";
import { DARK_THEME } from "./theme.ts";
import { BoxRenderable, MouseButton, TextareaRenderable, TextRenderable } from "@opentui/core";
import { createTestRenderer, ManualClock } from "@opentui/core/testing";
import { createChatKeymap, registerSelectionKeys } from "./keymap.ts";
import { InlineMenu } from "./picker.ts";
import type { Choice, MenuScreen } from "./picker.ts";
import { TreeSelector } from "./tree-selector.ts";
import { UsagePanel } from "./usage-panel.ts";
import { usageCard } from "./usage.ts";
import { sessionId } from "@nyte-ai/core";
import type { AccountUsage } from "@nyte-ai/host/usage";
import { createScrollAcceleration } from "./scrolling.ts";
import { openDiagnosticReport } from "./diagnostic-report.ts";
import { projectTree } from "@nyte-ai/client";
import type { SessionTree } from "@nyte-ai/client";

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

async function panelFixture(width = 80, height = 7) {
  const setup = await createTestRenderer({ width, height: 20, kittyKeyboard: true });
  const keymap = createChatKeymap(setup.renderer);
  const host = new BoxRenderable(setup.renderer, { width: "100%", height, flexShrink: 0 });
  setup.renderer.root.add(host);
  setup.renderer.root.add(
    new TextRenderable(setup.renderer, { content: "Outside panel", height: 1 }),
  );
  let next = 0;
  const errors: unknown[] = [];
  return {
    ...setup,
    host,
    errors,
    options: {
      renderer: setup.renderer,
      keymap,
      theme: DARK_THEME,
      nextId: (prefix = "panel") => `${prefix}-${String(next++)}`,
      onRows: () => {},
      onError: (cause: unknown) => {
        errors.push(cause);
      },
    },
  };
}

test.each([28, 80])(
  "loadable picker paints its shell before fetching and keeps search at width %s",
  async (width) => {
    const app = await panelFixture(width);
    const source = Promise.withResolvers<readonly Choice[]>();
    let frameAtLoad = "";
    let picked = "";
    const menu = new InlineMenu(app.options, {
      title: "Resume chat",
      choices: [],
      load: () => {
        frameAtLoad = app.captureCharFrame();
        return source.promise;
      },
      onSelect: (id) => {
        picked = id;
      },
      onCancel: () => menu.destroy(),
    });
    try {
      await app.renderOnce();
      expect(frameAtLoad).toBe("");
      app.host.add(menu.container);
      menu.focus();
      await app.renderOnce();
      expect(frameAtLoad).toContain("Resume chat");
      expect(frameAtLoad).toContain("type to filter");
      expect(frameAtLoad).toContain("Loading…");
      await app.mockInput.typeText("beta");
      source.resolve([
        { id: "alpha", label: "Alpha chat" },
        { id: "beta", label: "Beta chat" },
      ]);
      await app.waitForFrame((frame) => frame.includes("Beta chat"));
      expect(app.captureCharFrame()).not.toContain("Alpha chat");
      expect(app.captureCharFrame()).toContain("beta");
      app.mockInput.pressEnter();
      await app.renderOnce();
      expect(picked).toBe("beta");
      expect(app.errors).toEqual([]);
    } finally {
      menu.destroy();
      app.renderer.destroy();
    }
  },
);

test.each([false, true])(
  "closing a loading picker ignores late results, failure=%s",
  async (failure) => {
    const app = await panelFixture();
    const source = Promise.withResolvers<readonly Choice[]>();
    let closed = false;
    const menu = new InlineMenu(app.options, {
      title: "Resume chat",
      choices: [],
      load: () => source.promise,
      onSelect: () => {},
      onCancel: () => {
        closed = true;
        menu.destroy();
      },
    });
    app.host.add(menu.container);
    menu.focus();
    try {
      await app.renderOnce();
      await app.mockInput.typeText("pending");
      app.mockInput.pressEscape();
      await app.renderOnce();
      expect(closed).toBe(false);
      expect(menu.queryInput.value).toBe("");
      app.mockInput.pressEscape();
      await app.renderOnce();
      expect(closed).toBe(true);
      if (failure) source.reject(new Error("Late failure"));
      else source.resolve([{ id: "late", label: "Late chat" }]);
      await app.flush();
      expect(app.captureCharFrame()).not.toContain("Resume chat");
      expect(app.captureCharFrame()).not.toContain("Late chat");
      expect(app.errors).toEqual([]);
    } finally {
      menu.destroy();
      app.renderer.destroy();
    }
  },
);

test("replacing a loading picker clears its loading state and ignores the old failure", async () => {
  const app = await panelFixture();
  const old = Promise.withResolvers<readonly Choice[]>();
  const menu = new InlineMenu(app.options, {
    title: "Old screen",
    choices: [],
    load: () => old.promise,
    onSelect: () => {},
    onCancel: () => {},
  });
  app.host.add(menu.container);
  try {
    await app.renderOnce();
    menu.show({
      title: "New screen",
      choices: [],
      emptyLabel: "No saved chats",
      onSelect: () => {},
      onCancel: () => {},
    });
    old.reject(new Error("Superseded"));
    await app.flush();
    const frame = app.captureCharFrame();
    expect(frame).toContain("New screen");
    expect(frame).toContain("No saved chats");
    expect(frame).not.toContain("Loading…");
    expect(app.errors).toEqual([]);
  } finally {
    menu.destroy();
    app.renderer.destroy();
  }
});

test("picker scrolls within its allocated rows and can switch to a typed screen", async () => {
  const app = await panelFixture();
  let picked = "";
  const screen: MenuScreen = {
    title: "Choices",
    choices: Array.from({ length: 30 }, (_, index) => ({
      id: String(index),
      label: `Choice ${String(index).padStart(2, "0")}`,
    })),
    onSelect: (id) => {
      picked = id;
    },
    onCancel: () => {},
  };
  const menu = new InlineMenu(app.options, screen);
  app.host.add(menu.container);
  menu.focus();
  try {
    await app.flush();
    app.mockInput.pressArrow("up");
    await app.flush();
    expect(app.captureCharFrame()).toContain("Choice 29");
    expect(app.captureCharFrame().split("\n")[7]).toContain("Outside panel");
    app.host.height = 5;
    app.resize(28, 20);
    await app.flush();
    expect(app.captureCharFrame()).toContain("Choice 29");
    expect(app.captureCharFrame().split("\n")[5]).toContain("Outside panel");
    app.mockInput.pressEnter();
    await app.renderOnce();
    expect(picked).toBe("29");
    let answer = "";
    menu.show({
      ...screen,
      title: "Question",
      typed: {
        placeholder: "your answer",
        onSubmit: (text) => {
          answer = text;
        },
      },
    });
    await app.flush();
    await app.mockInput.typeText("custom answer");
    menu.setChoices(screen.choices);
    app.mockInput.pressEnter();
    await app.renderOnce();
    expect(answer).toBe("custom answer");
    expect(app.captureCharFrame()).toContain("Question");
    expect(app.errors).toEqual([]);
  } finally {
    menu.destroy();
    app.renderer.destroy();
  }
});

test("tree loads after paint, preserves search and draws branches inside its allocated rows", async () => {
  const app = await panelFixture(80, 9);
  const source = Promise.withResolvers<SessionTree>();
  let frameAtLoad = "";
  let picked = "";
  const tree = projectTree(
    [
      {
        oid: "root",
        commit: {
          kind: "commit",
          parent: null,
          at: 0,
          body: {
            kind: "message",
            message: { role: "user", content: "Root request", timestamp: 0 },
          },
          start: { kind: "none" },
        },
      },
      {
        oid: "left",
        commit: {
          kind: "commit",
          parent: "root",
          at: 1,
          body: {
            kind: "message",
            message: { role: "user", content: "Left branch", timestamp: 1 },
          },
          start: { kind: "none" },
        },
      },
      {
        oid: "right",
        commit: {
          kind: "commit",
          parent: "root",
          at: 2,
          body: {
            kind: "message",
            message: { role: "user", content: "Right branch", timestamp: 2 },
          },
          start: { kind: "none" },
        },
      },
    ],
    { tip: "right" },
  );
  const selector = new TreeSelector(
    {
      ...app.options,
      onSelect: (oid) => {
        picked = oid;
      },
      onCancel: () => selector.destroy(),
    },
    {
      load: () => {
        frameAtLoad = app.captureCharFrame();
        return source.promise;
      },
    },
  );
  app.host.add(selector.container);
  selector.focus();
  try {
    await app.renderOnce();
    expect(frameAtLoad).toContain("Session Tree");
    expect(frameAtLoad).toContain("type to filter");
    expect(frameAtLoad).toContain("Loading…");
    await app.mockInput.typeText("Left");
    source.resolve(tree);
    await app.waitForFrame((frame) => frame.includes("Left branch"));
    expect(app.captureCharFrame()).not.toContain("Right branch");
    app.mockInput.pressEnter();
    await app.renderOnce();
    expect(picked).toBe("left");
    app.mockInput.pressEscape();
    await app.flush();
    expect(app.captureCharFrame()).toContain("Right branch");
    expect(app.captureCharFrame()).toMatch(/[├└│]/u);
    expect(app.captureCharFrame().split("\n")[9]).toContain("Outside panel");
    selector.destroy();
    selector.update(tree);
    await app.flush();
    expect(app.captureCharFrame()).not.toContain("Session Tree");
    expect(app.errors).toEqual([]);
  } finally {
    selector.destroy();
    app.renderer.destroy();
  }
});

test("usage shares the bounded shell and keeps its report scrollable after data arrives", async () => {
  const app = await panelFixture(80, 13);
  const id = sessionId("usage");

  const accounts: readonly AccountUsage[] = [
    {
      provider: "anthropic",
      kind: "ready",
      limits: {
        providerId: "anthropic",
        observedAt: 0,
        windows: [{ id: "five_hour", usedPercent: 25 }],
      },
    },
  ];

  const panel = new UsagePanel(
    { ...app.options, newScrollAcceleration: () => createScrollAcceleration(false) },
    usageCard({ history: { kind: "loading" }, sessionId: id, accounts: [] }),
    () => panel.destroy(),
    () => {},
  );

  app.host.add(panel.container);
  panel.focus();

  try {
    await app.flush();
    expect(app.captureCharFrame()).toContain("Usage");
    expect(app.captureCharFrame()).toContain("Reading usage…");
    panel.update(usageCard({ history: { kind: "loading" }, sessionId: id, accounts }));
    await app.flush();
    expect(app.captureCharFrame()).toContain("25% used");
    expect(app.captureCharFrame()).toContain("Reading usage…");
    panel.update(
      usageCard({
        history: { kind: "failed", message: "History failed" },
        sessionId: id,
        accounts,
      }),
    );
    await app.flush();
    expect(app.captureCharFrame()).toContain("25% used");
    expect(app.captureCharFrame()).toContain("History failed");
    panel.update({
      accounts,
      workspace: { kind: "message", title: "Workspace", message: "No usage" },
      claudeCode: { kind: "message", message: "No local history" },
      codex: {
        kind: "message",
        message: Array.from({ length: 20 }, (_, index) => `Usage row ${String(index)}`).join("\n"),
      },
    });
    await app.flush();
    expect(app.captureCharFrame()).not.toContain("Reading usage…");

    for (let page = 0; page < 12; page++) app.mockInput.pressKey("\x1b[6~");
    await app.flush();
    expect(app.captureCharFrame()).toContain("Usage row 19");
    expect(app.captureCharFrame().split("\n")[13]).toContain("Outside panel");
    app.mockInput.pressEscape();
    await app.flush();
    panel.update(
      usageCard({ history: { kind: "failed", message: "Late error" }, sessionId: id, accounts }),
    );
    await app.flush();
    expect(app.captureCharFrame()).not.toContain("Late error");
  } finally {
    panel.destroy();
    app.renderer.destroy();
  }
});

test.each([28, 80])(
  "diagnostics share panel composition without losing overlay scrolling at width %s",
  async (width) => {
    const setup = await createTestRenderer({ width, height: 18, kittyKeyboard: true });
    const shell = await mountShell({
      renderer: setup.renderer,
      initialTheme: DARK_THEME,
      roles: deliveryChoices,
      openPath: () => undefined,
    });
    let closed = false;
    const report = openDiagnosticReport(
      shell,
      "Plugins",
      Array.from({ length: 30 }, (_, index) => `Plugin row ${String(index)}`),
      () => {
        closed = true;
      },
    );
    try {
      expect(report).toBeDefined();
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("Plugins");
      expect(setup.captureCharFrame()).toContain("Plugin row 0");
      setup.mockInput.pressArrow("down", { ctrl: true });
      await setup.flush();
      expect(setup.captureCharFrame()).toContain("Plugin row 29");
      setup.mockInput.pressEscape();
      await setup.flush();
      expect(closed).toBe(true);
      report?.update(["Late report"]);
      await setup.flush();
      expect(setup.captureCharFrame()).not.toContain("Late report");
    } finally {
      report?.destroy();
      setup.renderer.destroy();
    }
  },
);
