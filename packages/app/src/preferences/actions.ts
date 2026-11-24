import { SdkError } from "@nyte-ai/sdk";
import type { Json } from "@nyte-ai/sdk";
import { isJson, isJsonObject } from "@nyte-ai/schema";
import type { ActionDeclaration } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { TSchema } from "typebox";
import { preferences } from "./index.ts";

interface NamedPreference {
  readonly schema: TSchema;
  readonly get: () => Json;
  readonly accept: (value: Json) => boolean;
}

/**
 * The preferences a caller reads and sets by name, each as the action `setting.<name>`. Input `{}`
 * reads the value and `{ value }` sets it; both answer `{ value }` with the value now.
 *
 * What the app remembers about its own layout is left out, and so is every switch that guards
 * links, developer tools or remote control: none of those changes without the user at the app.
 */
export const SETTING_ACTIONS = {
  "setting.startup": preferences.startupDestination,
  "setting.running.message": preferences.runningMessage,
  "setting.theme": preferences.theme,
  "setting.themes": preferences.themes,
  "setting.tint.hue": preferences.tintHue,
  "setting.tint.intensity": preferences.tintIntensity,
  "setting.pointer.cursors": preferences.pointerCursors,
  "setting.font.ui": preferences.uiFont,
  "setting.font.ui.size": preferences.uiFontSize,
  "setting.font.code": preferences.codeFont,
  "setting.font.code.size": preferences.codeFontSize,
  "setting.font.smoothing": preferences.fontSmoothing,
  "setting.transparency.reduce": preferences.reduceTransparency,
  "setting.tool.calls": preferences.toolCalls,
  "setting.code.wrap": preferences.codeBlockWordWrap,
  "setting.chat.width": preferences.chatWidth,
  "setting.terminal.scrollback": preferences.terminalScrollback,
  "setting.terminal.cursor.style": preferences.terminalCursorStyle,
  "setting.terminal.cursor.blink": preferences.terminalCursorBlink,
  "setting.editor.line.numbers": preferences.fileLineNumbers,
  "setting.editor.wrap": preferences.fileWordWrap,
  "setting.editor.blame": preferences.fileGitBlame,
  "setting.editor.autosave": preferences.fileAutoSave,
  "setting.editor.format": preferences.fileFormatOnSave,
  "setting.editor.outline": preferences.fileOutline,
  "setting.editor.panel": preferences.editorSidePanel,
  "setting.changes.layout": preferences.changesLayout,
  "setting.changes.whitespace": preferences.changesIgnoreWhitespace,
  "setting.changes.wrap": preferences.changesWordWrap,
} satisfies Record<`setting.${string}`, NamedPreference>;

export function namesSettingAction(name: string): name is keyof typeof SETTING_ACTIONS {
  return Object.hasOwn(SETTING_ACTIONS, name);
}

/** Reads the preference behind `name`, after setting it when `input` holds a `value`. Throws `invalid` for a value the preference does not take. */
export function runSettingAction(name: keyof typeof SETTING_ACTIONS, input: Json): Json {
  const preference: NamedPreference = SETTING_ACTIONS[name];

  if (!isJsonObject(input) || Object.keys(input).some((key) => key !== "value")) {
    throw new SdkError("invalid", `${name} takes { value }, or {} to read.`);
  }

  if (input.value !== undefined && !preference.accept(input.value)) {
    throw new SdkError("invalid", `That is not a value ${name} takes.`);
  }

  return { value: preference.get() };
}

/** Each setting action as a client declares it to the host. */
export function settingDeclarations(): readonly ActionDeclaration[] {
  return Object.entries(SETTING_ACTIONS).map((entry) => {
    const input: unknown = JSON.parse(
      JSON.stringify(
        Type.Object({ value: Type.Optional(entry[1].schema) }, { additionalProperties: false }),
      ),
    );

    if (!isJson(input)) throw new Error(`The schema of ${entry[0]} is not JSON.`);

    return {
      name: entry[0],
      summary: "Reads this preference of the app, or sets it when `value` is given.",
      input,
    };
  });
}
