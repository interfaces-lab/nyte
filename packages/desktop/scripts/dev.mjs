import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import electronMetadata from "electron/package.json" with { type: "json" };
import { ACCOUNT_SCHEMES } from "../src/account/scheme.ts";

/**
 * A renamed copy of Electron's app bundle carrying the dev icon and URL scheme. Mission Control
 * reads the bundle icon, not the runtime Dock override, and a fresh path per artwork avoids
 * macOS's cached icon. An interrupted preparation retries from a clean copy, leaving pnpm's
 * Electron intact.
 */
export function prepareDevElectron() {
  if (process.platform !== "darwin") return electronPath;

  const icon = readFileSync(new URL("../build/icon.icns", import.meta.url));

  const fingerprint = createHash("sha256")
    .update(readFileSync(import.meta.filename))
    .update(ACCOUNT_SCHEMES.development)
    .update(icon)
    .digest("hex");

  const cache = join(
    import.meta.dirname,
    "../node_modules/.cache/nyte-electron",
    `${electronMetadata.version}-${process.arch}-${fingerprint}`,
  );

  const bundle = join(cache, "Nyte (Dev).app");
  const ready = join(cache, "ready");

  if (!existsSync(ready)) {
    mkdirSync(cache, { recursive: true });
    rmSync(bundle, { recursive: true, force: true });
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
    writeFileSync(join(bundle, "Contents/Resources/icon.icns"), icon);
    execFileSync("/usr/bin/plutil", [
      "-replace",
      "CFBundleIconFile",
      "-string",
      "icon.icns",
      plist,
    ]);
    execFileSync("/usr/bin/plutil", [
      "-replace",
      "CFBundleURLTypes",
      "-json",
      JSON.stringify([
        {
          CFBundleURLName: "Nyte Account",
          CFBundleURLSchemes: [ACCOUNT_SCHEMES.development],
        },
      ]),
      plist,
    ]);
    execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bundle]);
    writeFileSync(ready, "");
  }

  execFileSync(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", bundle],
  );

  return join(bundle, "Contents/MacOS/Electron");
}

if (import.meta.main) {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../bin/electron-vite.js", import.meta.resolve("electron-vite"))),
      "dev",
      "--watch",
      ...process.argv.slice(2),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NYTE_DB: process.env["NYTE_DB"] ?? join(homedir(), ".nyte", "nyte-dev.db"),
        ELECTRON_EXEC_PATH: prepareDevElectron(),
      },
    },
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
