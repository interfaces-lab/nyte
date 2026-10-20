import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";

const desktopRoot = join(import.meta.dirname, "..");

for (const part of ["preload", "renderer"]) {
  if (!existsSync(join(desktopRoot, "out", part))) {
    process.stderr.write(`out/${part} is missing. Run pnpm --dir packages/desktop build first.\n`);
    process.exit(1);
  }
}

const result = spawnSync(
  "pnpm",
  ["exec", "electron-vite", "build", "--mode", "e2e", "--ignoreConfigWarning"],
  { cwd: desktopRoot, stdio: "inherit" },
);

if (result.status !== 0) process.exit(result.status ?? 1);

await mkdir(join(desktopRoot, "out-e2e"), { recursive: true });

for (const part of ["preload", "renderer"]) {
  const link = join(desktopRoot, "out-e2e", part);
  await rm(link, { recursive: true, force: true });
  await symlink(join("..", "out", part), link, "junction");
}
