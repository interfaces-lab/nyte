import { join } from "node:path";
import process from "node:process";
import electronBinary from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";

export const electronExecutable = Value.Parse(Type.String(), electronBinary);

const PLATFORM_ENVIRONMENT = [
  "DISPLAY",
  "XAUTHORITY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "SystemRoot",
  "windir",
];

export function isolatedElectronEnvironment(directory: string) {
  const home = join(directory, "home");

  return {
    ...Object.fromEntries(
      PLATFORM_ENVIRONMENT.flatMap((name) => {
        const value = process.env[name];

        return value === undefined ? [] : [[name, value]];
      }),
    ),
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    TMPDIR: directory,
    TMP: directory,
    TEMP: directory,
  };
}
