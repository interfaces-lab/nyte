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

const capabilities = { browser: true };

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

const ghostty = keyEvent({ key: "~", code: "Backquote", ctrlKey: true, defaultPrevented: true });

const paneFocus = keyEvent({ key: "F6" });

test.each<{
  readonly name: string;
  readonly event: Parameters<typeof resolveClientAction>[0];
  readonly mac: boolean;
  readonly stage: Parameters<typeof resolveClientAction>[2];
  readonly expected: string | undefined;
}>([
  {
    name: "search takes Command on mac",
    event: keyEvent({ key: "k", metaKey: true }),
    mac: true,
    stage: "workspace",
    expected: "search",
  },
  {
    name: "search rejects Control on mac",
    event: keyEvent({ key: "k", ctrlKey: true }),
    mac: true,
    stage: "workspace",
    expected: undefined,
  },
  {
    name: "search rejects Meta off mac",
    event: keyEvent({ key: "k", metaKey: true }),
    mac: false,
    stage: "workspace",
    expected: undefined,
  },
  {
    name: "search rejects a Shift alias off mac",
    event: keyEvent({ key: "k", ctrlKey: true, shiftKey: true }),
    mac: false,
    stage: "workspace",
    expected: undefined,
  },
  ...(["settings", "customize"] as const).flatMap((stage) => [
    {
      name: `${stage} keeps new chat`,
      event: keyEvent({ metaKey: true }),
      mac: true,
      stage,
      expected: "new-chat",
    },
    {
      name: `${stage} keeps search`,
      event: keyEvent({ key: "k", metaKey: true }),
      mac: true,
      stage,
      expected: "search",
    },
    {
      name: `${stage} does not split the workspace`,
      event: keyEvent({ key: "d", metaKey: true }),
      mac: true,
      stage,
      expected: undefined,
    },
    {
      name: `${stage} keeps the sidebar`,
      event: keyEvent({ key: "b", metaKey: true }),
      mac: true,
      stage,
      expected: "sidebar",
    },
    {
      name: `${stage} does not toggle the workbench`,
      event: keyEvent({ key: "b", metaKey: true, altKey: true }),
      mac: true,
      stage,
      expected: undefined,
    },
  ]),
  {
    name: "consumed editor input does not dispatch",
    event: keyEvent({ ctrlKey: true, defaultPrevented: true }),
    mac: false,
    stage: "workspace",
    expected: undefined,
  },
  {
    name: "composition does not dispatch",
    event: keyEvent({ metaKey: true, isComposing: true }),
    mac: true,
    stage: "workspace",
    expected: undefined,
  },
  {
    name: "Ghostty's consumed physical Backquote still opens a terminal",
    event: ghostty,
    mac: true,
    stage: "workspace",
    expected: "terminal",
  },
  {
    name: "Ghostty's consumed physical Backquote with Shift still creates a terminal",
    event: { ...ghostty, shiftKey: true },
    mac: false,
    stage: "workspace",
    expected: "new-terminal",
  },
  {
    name: "Ghostty's Backquote does nothing in settings",
    event: ghostty,
    mac: true,
    stage: "settings",
    expected: undefined,
  },
  {
    name: "Ghostty's Backquote with Alt does nothing",
    event: { ...ghostty, altKey: true },
    mac: true,
    stage: "workspace",
    expected: undefined,
  },
  {
    name: "Ghostty's Backquote with Meta does nothing",
    event: { ...ghostty, metaKey: true },
    mac: true,
    stage: "workspace",
    expected: undefined,
  },
  {
    name: "workbench retains its Shift alias",
    event: keyEvent({ key: "b", metaKey: true, altKey: true, shiftKey: true }),
    mac: true,
    stage: "workspace",
    expected: "workbench",
  },
  {
    name: "F6 focuses a pane",
    event: paneFocus,
    mac: true,
    stage: "workspace",
    expected: "focus-pane",
  },
  {
    name: "Shift+F6 also focuses a pane",
    event: { ...paneFocus, shiftKey: true },
    mac: true,
    stage: "workspace",
    expected: "focus-pane",
  },
  {
    name: "pane focus respects consumed input",
    event: { ...paneFocus, defaultPrevented: true },
    mac: true,
    stage: "workspace",
    expected: undefined,
  },
  {
    name: "pane focus respects composition",
    event: { ...paneFocus, isComposing: true },
    mac: true,
    stage: "workspace",
    expected: undefined,
  },
  {
    name: "pane focus is off in settings",
    event: paneFocus,
    mac: true,
    stage: "settings",
    expected: undefined,
  },
])("$name", (row) => {
  expect(resolveAction(row.event, row.mac, row.stage)?.id).toBe(row.expected);
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
