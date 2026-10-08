import { expect, test } from "vitest";
import {
  clientActionAccelerator,
  clientActionAvailable,
  clientActionAriaShortcut,
  clientActions,
  clientActionShortcut,
  resolveClientAction,
  resolveTabShortcut,
} from "./client-actions.ts";

const capabilities = { terminal: true, browser: true };

function resolveAction(
  event: Parameters<typeof resolveClientAction>[0],
  mac: boolean,
  stage: Parameters<typeof resolveClientAction>[2],
) {
  return resolveClientAction(event, mac, stage, capabilities);
}

function keyEvent(overrides: Partial<Parameters<typeof resolveClientAction>[0]> = {}) {
  return {
    key: "n",
    code: "KeyN",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    ...overrides,
  };
}

test.each([true, false])("displayed bindings resolve to their action, mac=%s", (mac) => {
  for (const action of Object.values(clientActions)) {
    if (!("chord" in action)) continue;
    const aria = clientActionAriaShortcut(action, mac).split("+");
    const key = aria.at(-1);
    expect(
      resolveAction(
        keyEvent({
          key,
          code: key === "`" ? "Backquote" : "",
          metaKey: aria.includes("Meta"),
          ctrlKey: aria.includes("Control"),
          altKey: aria.includes("Alt"),
          shiftKey: aria.includes("Shift"),
        }),
        mac,
        "workspace",
      )?.id,
    ).toBe(action.id);
  }
});

test("the native menu accelerator names the cross-platform binding", () => {
  expect(clientActionAccelerator(clientActions.settings)).toBe("CommandOrControl+,");
});

test("search rejects the other platform modifier and modified aliases", () => {
  expect(resolveAction(keyEvent({ key: "k", metaKey: true }), true, "workspace")?.id).toBe(
    "search",
  );
  expect(resolveAction(keyEvent({ key: "k", ctrlKey: true }), true, "workspace")).toBeUndefined();
  expect(resolveAction(keyEvent({ key: "k", metaKey: true }), false, "workspace")).toBeUndefined();
  expect(
    resolveAction(keyEvent({ key: "k", ctrlKey: true, shiftKey: true }), false, "workspace"),
  ).toBeUndefined();
});

test("settings and customize keep window navigation but do not split the workspace", () => {
  for (const stage of ["settings", "customize"] as const) {
    expect(resolveAction(keyEvent({ metaKey: true }), true, stage)?.id).toBe("new-chat");
    expect(resolveAction(keyEvent({ key: "[", metaKey: true }), true, stage)?.id).toBe("back");
    expect(resolveAction(keyEvent({ key: "d", metaKey: true }), true, stage)).toBeUndefined();
    expect(
      resolveAction(keyEvent({ key: "b", metaKey: true, altKey: true }), true, stage),
    ).toBeUndefined();
  }

  expect(resolveAction(keyEvent({ key: "b", metaKey: true }), true, "settings")).toBeUndefined();
  expect(resolveAction(keyEvent({ key: "b", metaKey: true }), true, "customize")?.id).toBe(
    "sidebar",
  );
});

test("consumed editor input and composition do not dispatch window actions", () => {
  expect(
    resolveAction(keyEvent({ ctrlKey: true, defaultPrevented: true }), false, "workspace"),
  ).toBeUndefined();
  expect(
    resolveAction(keyEvent({ metaKey: true, isComposing: true }), true, "workspace"),
  ).toBeUndefined();
});

test("Ghostty's consumed physical Backquote still opens or creates a terminal", () => {
  const event = keyEvent({ key: "~", code: "Backquote", ctrlKey: true, defaultPrevented: true });
  expect(resolveAction(event, true, "workspace")?.id).toBe("terminal");
  expect(resolveAction({ ...event, shiftKey: true }, false, "workspace")?.id).toBe("new-terminal");
  expect(resolveAction(event, true, "settings")).toBeUndefined();
  expect(resolveAction({ ...event, altKey: true }, true, "workspace")).toBeUndefined();
  expect(resolveAction({ ...event, metaKey: true }, true, "workspace")).toBeUndefined();
});

test("workbench retains its Shift alias", () => {
  expect(
    resolveAction(
      keyEvent({ key: "b", metaKey: true, altKey: true, shiftKey: true }),
      true,
      "workspace",
    )?.id,
  ).toBe("workbench");
});

test("pane focus respects consumed input, composition and settings", () => {
  const event = keyEvent({ key: "F6" });
  expect(resolveAction(event, true, "workspace")?.id).toBe("focus-pane");
  expect(resolveAction({ ...event, shiftKey: true }, true, "workspace")?.id).toBe("focus-pane");
  expect(resolveAction({ ...event, defaultPrevented: true }, true, "workspace")).toBeUndefined();
  expect(resolveAction({ ...event, isComposing: true }, true, "workspace")).toBeUndefined();
  expect(resolveAction(event, true, "settings")).toBeUndefined();
});

test.each([true, false])("account Settings hint follows the active binding, mac=%s", (mac) => {
  for (const stage of ["workspace", "customize", "settings"] as const) {
    const shortcut = clientActionShortcut(clientActions.settings, mac, stage, capabilities);
    const resolved = resolveAction(keyEvent({ key: ",", metaKey: mac, ctrlKey: !mac }), mac, stage);
    expect(shortcut === "").toBe(resolved === undefined);
    expect(clientActionAvailable(clientActions.generalSettings, stage, capabilities)).toBe(true);

    if (resolved !== undefined) expect(shortcut).toBe(mac ? "⌘," : "Ctrl+,");
  }
});

test("tab shortcuts pick by position and step with wrap keys", () => {
  expect(resolveTabShortcut(keyEvent({ key: "9", code: "Digit9", metaKey: true }), true)).toEqual({
    kind: "activate-index",
    index: 8,
  });
  expect(
    resolveTabShortcut(keyEvent({ key: "Tab", code: "Tab", ctrlKey: true, shiftKey: true }), true),
  ).toEqual({ kind: "cycle-tab", step: -1 });
  expect(
    resolveTabShortcut(
      keyEvent({ key: "ArrowRight", code: "ArrowRight", metaKey: true, altKey: true }),
      true,
    ),
  ).toEqual({ kind: "cycle-tab", step: 1 });
  expect(resolveTabShortcut(keyEvent({ key: "1", code: "Digit1", ctrlKey: true }), true)).toBe(
    undefined,
  );
});
