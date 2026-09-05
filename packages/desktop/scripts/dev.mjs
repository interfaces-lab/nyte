import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import electronMetadata from "electron/package.json" with { type: "json" };

export function prepareDevElectron() {
  if (process.platform !== "darwin") return electronPath;

  // macOS reads the bundle name, not app.setName(). Keep pnpm's Electron intact.
  const cache = join(
    import.meta.dirname,
    "../node_modules/.cache/nyte-electron",
    `${electronMetadata.version}-${process.arch}`,
  );
  const bundle = join(cache, "Nyte (Dev).app");
  const ready = join(cache, "ready");
  if (!existsSync(ready)) {
    mkdirSync(cache, { recursive: true });
    cpSync(join(dirname(electronPath), "../.."), bundle, {
      recursive: true,
      verbatimSymlinks: true,
    });
    const plist = join(bundle, "Contents/Info.plist");
    for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
      execFileSync("/usr/bin/plutil", ["-replace", key, "-string", "Nyte (Dev)", plist]);
    }
    execFileSync("/usr/bin/plutil", [
      "-replace",
      "CFBundleIdentifier",
      "-string",
      "ai.nyte.desktop.dev",
      plist,
    ]);
    execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bundle]);
    writeFileSync(ready, "");
  }
  return join(bundle, "Contents/MacOS/Electron");
}

if (import.meta.main) {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../bin/electron-vite.js", import.meta.resolve("electron-vite"))),
      "dev",
      ...process.argv.slice(2),
    ],
    { stdio: "inherit", env: { ...process.env, ELECTRON_EXEC_PATH: prepareDevElectron() } },
  );
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}
