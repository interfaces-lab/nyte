import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Kbd } from "../renderer/src/components/ui.tsx";
import {
  clientActionAccelerator,
  clientActionAvailable,
  clientActionAriaShortcut,
  clientActionKeys,
  clientActions,
  clientActionShortcut,
  resolveClientAction,
} from "./client-actions.ts";

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
      resolveClientAction(
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

test("new chat keycaps use the platform binding that executes the action", () => {
  const mac = renderToStaticMarkup(<Kbd keys={clientActionKeys(clientActions.newChat, true)} />);
  const windows = renderToStaticMarkup(
    <Kbd keys={clientActionKeys(clientActions.newChat, false)} />,
  );
  expect(mac.replace(/<[^>]+>/g, "")).toBe("⌘N");
  expect(windows.replace(/<[^>]+>/g, "")).toBe("CtrlN");
  expect(clientActionShortcut(clientActions.settings, true)).toBe("⌘,");
  expect(clientActionShortcut(clientActions.settings, false)).toBe("Ctrl+,");
  expect(clientActionAccelerator(clientActions.settings)).toBe("CommandOrControl+,");
});

test("search rejects the other platform modifier and modified aliases", () => {
  expect(resolveClientAction(keyEvent({ key: "k", metaKey: true }), true, "workspace")?.id).toBe(
    "search",
  );
  expect(
    resolveClientAction(keyEvent({ key: "k", ctrlKey: true }), true, "workspace"),
  ).toBeUndefined();
  expect(
    resolveClientAction(keyEvent({ key: "k", metaKey: true }), false, "workspace"),
  ).toBeUndefined();
  expect(
    resolveClientAction(keyEvent({ key: "k", ctrlKey: true, shiftKey: true }), false, "workspace"),
  ).toBeUndefined();
});

test("settings and customize keep window navigation but do not split the workspace", () => {
  for (const stage of ["settings", "customize"] as const) {
    expect(resolveClientAction(keyEvent({ metaKey: true }), true, stage)?.id).toBe("new-chat");
    expect(resolveClientAction(keyEvent({ key: "[", metaKey: true }), true, stage)?.id).toBe(
      "back",
    );
    expect(resolveClientAction(keyEvent({ key: "d", metaKey: true }), true, stage)).toBeUndefined();
    expect(
      resolveClientAction(keyEvent({ key: "b", metaKey: true, altKey: true }), true, stage),
    ).toBeUndefined();
  }
  expect(
    resolveClientAction(keyEvent({ key: "b", metaKey: true }), true, "settings"),
  ).toBeUndefined();
  expect(resolveClientAction(keyEvent({ key: "b", metaKey: true }), true, "customize")?.id).toBe(
    "sidebar",
  );
});

test("consumed editor input and composition do not dispatch window actions", () => {
  expect(
    resolveClientAction(keyEvent({ ctrlKey: true, defaultPrevented: true }), false, "workspace"),
  ).toBeUndefined();
  expect(
    resolveClientAction(keyEvent({ metaKey: true, isComposing: true }), true, "workspace"),
  ).toBeUndefined();
});

test("Ghostty's consumed physical Backquote still opens or creates a terminal", () => {
  const event = keyEvent({ key: "~", code: "Backquote", ctrlKey: true, defaultPrevented: true });
  expect(resolveClientAction(event, true, "workspace")?.id).toBe("terminal");
  expect(resolveClientAction({ ...event, shiftKey: true }, false, "workspace")?.id).toBe(
    "new-terminal",
  );
  expect(resolveClientAction(event, true, "settings")).toBeUndefined();
  expect(resolveClientAction({ ...event, altKey: true }, true, "workspace")).toBeUndefined();
  expect(resolveClientAction({ ...event, metaKey: true }, true, "workspace")).toBeUndefined();
});

test("workbench retains its Shift alias", () => {
  expect(
    resolveClientAction(
      keyEvent({ key: "b", metaKey: true, altKey: true, shiftKey: true }),
      true,
      "workspace",
    )?.id,
  ).toBe("workbench");
});

test("palette-only settings stay discoverable while the native settings action is unavailable", () => {
  expect(
    Object.values(clientActions).flatMap((action) => ("palette" in action ? [action.label] : [])),
  ).toEqual([
    "New chat",
    "Open folder…",
    "Open home",
    "General settings",
    "Appearance",
    "Models",
    "Accounts",
    "Customize",
  ]);
  expect(clientActionAvailable(clientActions.settings, "settings")).toBe(false);
  expect(clientActionAvailable(clientActions.generalSettings, "settings")).toBe(true);
  expect(clientActionKeys(clientActions.generalSettings, true)).toEqual([]);
});

test("pane focus respects consumed input, composition and settings", () => {
  const event = keyEvent({ key: "F6" });
  expect(resolveClientAction(event, true, "workspace")?.id).toBe("focus-pane");
  expect(resolveClientAction({ ...event, shiftKey: true }, true, "workspace")?.id).toBe(
    "focus-pane",
  );
  expect(
    resolveClientAction({ ...event, defaultPrevented: true }, true, "workspace"),
  ).toBeUndefined();
  expect(resolveClientAction({ ...event, isComposing: true }, true, "workspace")).toBeUndefined();
  expect(resolveClientAction(event, true, "settings")).toBeUndefined();
});

test.each([true, false])("account Settings hint follows the active binding, mac=%s", (mac) => {
  for (const stage of ["workspace", "customize", "settings"] as const) {
    const shortcut = clientActionShortcut(clientActions.settings, mac, stage);
    const resolved = resolveClientAction(
      keyEvent({ key: ",", metaKey: mac, ctrlKey: !mac }),
      mac,
      stage,
    );
    expect(shortcut === "").toBe(resolved === undefined);
    expect(clientActionAvailable(clientActions.generalSettings, stage)).toBe(true);
    if (resolved !== undefined) expect(shortcut).toBe(mac ? "⌘," : "Ctrl+,");
  }
});
