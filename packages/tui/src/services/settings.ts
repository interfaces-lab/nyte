import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import type { Json } from "@nyte-ai/sdk";
import { isJsonObject } from "@nyte-ai/schema";
import { serial } from "@nyte-ai/schema/serial";
import { toJson } from "../json.ts";
import { errorMessage } from "../lib/format.ts";
import { parseSettingsFile } from "../lib/settings-schema.ts";
import type { ResolvedSettings, SettingsFile, SettingsPatch } from "../lib/settings-schema.ts";

/** A settings file left out of the merge, and why. */
export interface SettingsProblem {
  readonly path: string;
  readonly reason: string;
}

/** The merged settings, and each file that failed to parse and was left out of them. */
export interface SettingsRead {
  readonly settings: ResolvedSettings;
  readonly invalid: readonly SettingsProblem[];
}

/** What the TUI tells the user about settings files left out of a read. */
export function ignoredSettingsText(invalid: readonly SettingsProblem[]): string {
  return invalid.map((problem) => `Ignored ${problem.path}: ${problem.reason}`).join("\n");
}

type FileRead =
  | { readonly kind: "read"; readonly file: SettingsFile }
  | { readonly kind: "invalid"; readonly problem: SettingsProblem };

function defaultSettingsPath(): string {
  const home = process.env["NYTE_HOME"] ?? join(homedir(), ".nyte");

  return join(home, "settings.json");
}

function projectSettingsPath(cwd: string): string {
  return join(cwd, ".nyte", "settings.json");
}

function readSettings(path: string): FileRead {
  if (!existsSync(path)) return { kind: "read", file: {} };

  try {
    const text = readFileSync(path, "utf8");
    let parsed: Json;

    try {
      parsed = toJson(JSON.parse(text));
    } catch {
      return { kind: "invalid", problem: { path, reason: "invalid JSON" } };
    }

    return { kind: "read", file: parseSettingsFile(parsed) };
  } catch (cause) {
    return { kind: "invalid", problem: { path, reason: errorMessage(cause) } };
  }
}

function mergeSettings(global: SettingsFile, project: SettingsFile): ResolvedSettings {
  const resolved: ResolvedSettings = {
    autoUpdate: project.autoUpdate ?? global.autoUpdate ?? false,
    theme: project.theme ?? global.theme ?? "auto",
    copyOnSelect: project.copyOnSelect ?? global.copyOnSelect ?? process.platform !== "win32",
    scrollAcceleration: project.scrollAcceleration ?? global.scrollAcceleration ?? false,
    followUp: project.followUp ?? global.followUp ?? "steer",
  };

  const editor = global.externalEditor;
  const thinkingLevel = project.thinkingLevel ?? global.thinkingLevel;
  const withEditor = editor === undefined ? resolved : { ...resolved, externalEditor: editor };

  return thinkingLevel === undefined ? withEditor : { ...withEditor, thinkingLevel };
}

async function writeSettingsPatch(path: string, patch: SettingsPatch): Promise<void> {
  const text = existsSync(path) ? await readFile(path, "utf8") : "{}";
  const current = toJson(JSON.parse(text));
  const merged = { ...(isJsonObject(current) ? current : {}), ...patch };
  const temporary = `${path}.${String(process.pid)}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export class FileSettingsStore {
  private readonly globalPath: string;
  private readonly writes = serial();

  constructor(globalPath: string = defaultSettingsPath()) {
    this.globalPath = globalPath;
  }

  /** Reads both files at once, so the first frame can draw with them; a file that fails to parse contributes nothing. Never throws. */
  read(cwd: string): SettingsRead {
    const global = readSettings(this.globalPath);
    const project = readSettings(projectSettingsPath(cwd));

    return {
      settings: mergeSettings(
        global.kind === "read" ? global.file : {},
        project.kind === "read" ? project.file : {},
      ),
      invalid: [global, project].flatMap((read) => (read.kind === "invalid" ? [read.problem] : [])),
    };
  }

  /** Resolves once every write queued so far has settled. */
  settled(): Promise<void> {
    return this.writes.settled();
  }

  /** Writes `patch` into the global file; refuses while that file doesn't parse, so a fix by hand isn't overwritten. */
  updateGlobal(patch: SettingsPatch): Promise<void> {
    return this.writes.run(async () => {
      const current = readSettings(this.globalPath);

      if (current.kind === "invalid")
        throw new Error(`Fix ${current.problem.path} first: ${current.problem.reason}`);
      await writeSettingsPatch(this.globalPath, patch);
    });
  }
}
