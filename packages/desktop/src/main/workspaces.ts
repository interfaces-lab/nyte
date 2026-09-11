/**
 * Where the desktop's user-scoped stores live. Trust decisions and the
 * workspace registry sit in `~/.nyte` beside the TUI's, so trusting or opening
 * a folder in one client is trusting or opening it in both. Core owns both
 * stores' formats. Desktop also remembers its last selected workspace here.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { nyteHome } from "@nyte-ai/host";
import { ModelPreferencesStore } from "./model-preferences.ts";

export function createModelPreferencesStore(): ModelPreferencesStore {
  return new ModelPreferencesStore(join(nyteHome(), "model-preferences.json"));
}

export async function readLastWorkspace(): Promise<string | null> {
  try {
    const value: unknown = JSON.parse(
      await readFile(join(nyteHome(), "desktop-workspace.json"), "utf8"),
    );
    return Value.Check(Type.String(), value) && isAbsolute(value) ? value : null;
  } catch {
    return null;
  }
}

export async function rememberWorkspace(path: string | null): Promise<void> {
  try {
    await mkdir(nyteHome(), { recursive: true, mode: 0o700 });
    await writeFile(join(nyteHome(), "desktop-workspace.json"), JSON.stringify(path));
  } catch {
    // A preference write must not prevent selecting a workspace in this window.
  }
}
