import { findExecutable, run } from "../process/command.ts";
import type { Installer } from "./install.ts";
import type { Project } from "./spec.ts";

const PROBE_DEADLINE_MS = 10_000;

export async function passesProbe(
  program: string,
  probe: readonly string[],
  folder: string,
): Promise<boolean> {
  const found = await findExecutable(program);

  if (found === null) return false;

  const ran = await run(found, probe, { cwd: folder, timeoutMs: PROBE_DEADLINE_MS }).catch(
    () => null,
  );

  return ran?.code === 0;
}

export function openProject(root: string, installer: Installer | undefined): Project {
  const install: Project["install"] = async (source) =>
    installer === undefined ? null : installer.install(source, () => undefined);

  return {
    root,
    install,
    async tool(program, probe, source) {
      const found = await findExecutable(program);

      if (found !== null && (await passesProbe(found, probe, root))) {
        return { path: found, pinned: false };
      }

      const installed = await install(source).catch(() => null);

      return installed === null ? null : { path: installed.path, pinned: true };
    },
  };
}
