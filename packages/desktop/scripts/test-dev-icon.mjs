import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

// Only import the preparer in a plain Node subprocess. Never start Electron or Vite.
await test(
  "macOS dev bundle icon and cache",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "nyte-dev-icon-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const directory of ["scripts", "build", "node_modules"]) {
      mkdirSync(join(root, directory));
    }
    const script = join(root, "scripts/dev.mjs");
    const icon = join(root, "build/icon.icns");
    copyFileSync(new URL("./dev.mjs", import.meta.url), script);
    copyFileSync(new URL("../build/icon.icns", import.meta.url), icon);
    symlinkSync(
      dirname(fileURLToPath(import.meta.resolve("electron/package.json"))),
      join(root, "node_modules/electron"),
      "dir",
    );
    const runner = join(root, "prepare.mjs");
    writeFileSync(
      runner,
      'import { prepareDevElectron } from "./scripts/dev.mjs";\nprocess.stdout.write(prepareDevElectron());\n',
    );
    const originalPlist = join(dirname(electronPath), "../Info.plist");
    const originalPlistContents = readFileSync(originalPlist);
    const originalIconName = execFileSync(
      "/usr/bin/plutil",
      ["-extract", "CFBundleIconFile", "raw", "-o", "-", originalPlist],
      { encoding: "utf8" },
    ).trim();
    const originalIcon = join(dirname(electronPath), "../Resources", originalIconName);
    const originalIconContents = readFileSync(originalIcon);

    function prepare() {
      return execFileSync(process.execPath, [runner], { encoding: "utf8", timeout: 120_000 });
    }

    function verify(executable) {
      assert.ok(existsSync(executable));
      assert.notEqual(executable, electronPath);
      const bundle = join(dirname(executable), "../..");
      const plist = JSON.parse(
        execFileSync(
          "/usr/bin/plutil",
          ["-convert", "json", "-o", "-", join(bundle, "Contents/Info.plist")],
          { encoding: "utf8" },
        ),
      );
      assert.equal(plist.CFBundleName, "Nyte (Dev)");
      assert.equal(plist.CFBundleDisplayName, "Nyte (Dev)");
      assert.equal(plist.CFBundleIdentifier, "ai.nyte.desktop.dev");
      assert.equal(plist.CFBundleIconFile, "icon.icns");
      assert.deepEqual(
        readFileSync(join(bundle, "Contents/Resources", plist.CFBundleIconFile)),
        readFileSync(icon),
      );
      // Resource verification fails if the icon or plist was changed after signing.
      execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
      assert.deepEqual(readFileSync(originalPlist), originalPlistContents);
      assert.deepEqual(readFileSync(originalIcon), originalIconContents);
    }

    const executable = prepare();
    await t.test("embeds the icon in a signed bundle without changing installed Electron", () => {
      verify(executable);
    });

    await t.test("reuses the prepared bundle when inputs are unchanged", () => {
      const signature = join(dirname(executable), "../_CodeSignature/CodeResources");
      const modified = statSync(signature).mtimeMs;
      assert.equal(prepare(), executable);
      assert.equal(statSync(signature).mtimeMs, modified);
      verify(executable);
    });

    await t.test("prepares a fresh bundle when the icon changes", () => {
      assert.notDeepEqual(readFileSync(icon), originalIconContents);
      writeFileSync(icon, originalIconContents);
      const changed = prepare();
      assert.notEqual(changed, executable);
      verify(changed);
    });

    await t.test("prepares a fresh bundle when the preparer changes", () => {
      const before = prepare();
      appendFileSync(script, "\n// Changed preparer fixture.\n");
      const changed = prepare();
      assert.notEqual(changed, before);
      verify(changed);
    });
  },
);
