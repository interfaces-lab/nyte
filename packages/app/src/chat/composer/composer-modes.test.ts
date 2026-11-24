import { expect, test } from "vitest";
import type { CommandInfo, SettingInfo } from "@nyte-ai/sdk";
import type { ComposerEditorHandle } from "./composer-editor.tsx";
import { modeTriggers, readModes, runModeTrigger } from "./composer-modes.tsx";
import type { ComposerModes } from "./composer-modes.tsx";

function modeSetting(id: string, title: string, icon: string): SettingInfo {
  return {
    id,
    owner: "modes",
    scope: "chat",
    title,
    schema: { type: "boolean" },
    choices: null,
    value: false,
    from: "default",
    mode: { icon },
  };
}

function commandInfo(name: string, side: CommandInfo["side"] = "core"): CommandInfo {
  return {
    name,
    owner: side === "client" ? "" : "plugin",
    side,
    title: name,
    description: `${name} command`,
    takesText: false,
    completes: false,
  };
}

const DEBUG = modeSetting("mode.debug", "Debug", "bug");

const AUTORESEARCH = modeSetting("mode.autoresearch", "Autoresearch", "flask");

const NON_MODE: SettingInfo = {
  id: "verbose",
  owner: "plugin",
  scope: "chat",
  title: "Verbose",
  schema: { type: "boolean" },
  choices: null,
  value: false,
  from: "default",
};

const COMPACT = commandInfo("compact", "client");

function fakeEditor(initial: string) {
  let content = initial;

  const handle: ComposerEditorHandle = {
    readElement: () => null,
    focus: () => undefined,
    read: () => ({
      text: content,
      references: [],
      parts: content === "" ? [] : [{ kind: "text", text: content }],
    }),
    readDocument: () => ({
      text: content,
      selectionStart: content.length,
      selectionEnd: content.length,
    }),
    replaceText: (start, end, replacement) => {
      content = `${content.slice(0, start)}${replacement}${content.slice(end)}`;
    },
    insertReference: () => undefined,
    dropReferences: () => undefined,
    attachFiles: async () => undefined,
  };

  return { handle, text: () => content };
}

interface TriggerRow {
  readonly name: string;
  readonly chosen?: Readonly<Record<string, boolean>>;
  readonly commands?: readonly CommandInfo[];
  readonly text: string;
  readonly triggers: readonly string[];
  readonly ran: boolean;
  readonly set: Readonly<Record<string, boolean>> | undefined;
  readonly remaining: string;
}

const ROWS: readonly TriggerRow[] = [
  {
    name: "/debug turns Debug on and sends nothing",
    text: "/debug",
    triggers: ["debug", "autoresearch"],
    ran: true,
    set: { "mode.debug": true, "mode.autoresearch": false },
    remaining: "",
  },
  {
    name: "/debug again turns it off",
    chosen: { "mode.debug": true },
    text: "/debug",
    triggers: ["debug", "autoresearch"],
    ran: true,
    set: { "mode.debug": false, "mode.autoresearch": false },
    remaining: "",
  },
  {
    name: "/debug turns Autoresearch off",
    chosen: { "mode.autoresearch": true },
    text: "/debug",
    triggers: ["debug", "autoresearch"],
    ran: true,
    set: { "mode.debug": true, "mode.autoresearch": false },
    remaining: "",
  },
  {
    name: "text after the word stays in the composer, and the word is removed",
    text: "  /debug investigate the crash",
    triggers: ["debug", "autoresearch"],
    ran: true,
    set: { "mode.debug": true, "mode.autoresearch": false },
    remaining: "investigate the crash",
  },
  {
    name: "a plugin command with the same name keeps the word",
    commands: [commandInfo("debug")],
    text: "/debug",
    triggers: ["autoresearch"],
    ran: false,
    set: undefined,
    remaining: "/debug",
  },
  {
    name: "a non-mode command isn't caught",
    commands: [COMPACT],
    text: "/compact",
    triggers: ["debug", "autoresearch"],
    ran: false,
    set: undefined,
    remaining: "/compact",
  },
];

test.each(ROWS)("$name", (row) => {
  let written: Readonly<Record<string, boolean>> | undefined;

  const modes: ComposerModes = {
    modes: readModes([DEBUG, AUTORESEARCH, NON_MODE], row.chosen),
    set: (values) => {
      written = values;
    },
  };

  const triggers = modeTriggers(modes, row.commands ?? []);

  expect(triggers.map((trigger) => trigger.name)).toEqual(row.triggers);

  const editor = fakeEditor(row.text);

  const ran = runModeTrigger({
    modes,
    triggers,
    editor: editor.handle,
    text: row.text,
  });

  expect(ran).toBe(row.ran);
  expect(written).toEqual(row.set);
  expect(editor.text()).toBe(row.remaining);
});
