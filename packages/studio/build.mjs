// Builds Nyte Studio.app: the Swift executables, the font the designs are set in, and an icon
// rendered from a Lune file by the app's own renderer.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

const debug = process.argv.includes("--debug");

const configuration = debug ? "debug" : "release";

const version =
  process.env["NYTE_RELEASE_VERSION"] ??
  JSON.parse(readFileSync(new URL("../host/package.json", import.meta.url), "utf8")).version;

const run = (command, args) => execFileSync(command, args, { cwd: here, stdio: "inherit" });

for (const product of ["NyteStudio", "lune"])
  run("swift", ["build", "--configuration", configuration, "--product", product]);

const built = execFileSync("swift", ["build", "--configuration", configuration, "--show-bin-path"], {
  cwd: here,
  encoding: "utf8",
}).trim();

const app = resolve(here, "dist", "Nyte Studio.app");

const contents = join(app, "Contents");

rmSync(app, { recursive: true, force: true });

mkdirSync(join(contents, "MacOS"), { recursive: true });

mkdirSync(join(contents, "Resources"), { recursive: true });

cpSync(join(built, "NyteStudio"), join(contents, "MacOS", "NyteStudio"));

cpSync(join(built, "lune"), join(contents, "MacOS", "lune"));

const font = "inter-latin-opsz-normal.woff2";

cpSync(
  join(here, "node_modules/@fontsource-variable/inter/files", font),
  join(contents, "Resources", font),
);

cpSync(join(here, "Resources", "lune-skill.md"), join(contents, "Resources", "lune-skill.md"));

const iconset = join(here, ".build", "icon.iconset");

rmSync(iconset, { recursive: true, force: true });

mkdirSync(iconset, { recursive: true });

for (const [points, scale] of [16, 32, 128, 256, 512].flatMap((size) => [
  [size, 1],
  [size, 2],
])) {
  const name = scale === 1 ? `icon_${points}x${points}.png` : `icon_${points}x${points}@2x.png`;

  run(join(contents, "MacOS", "lune"), [
    "render",
    "Resources/icon.lune",
    "--root",
    ".",
    "--scale",
    String((points * scale) / 1024),
    "--out",
    join(iconset, name),
  ]);
}

run("iconutil", ["--convert", "icns", "--output", join(contents, "Resources", "icon.icns"), iconset]);

writeFileSync(
  join(contents, "Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Nyte Studio</string>
  <key>CFBundleDisplayName</key><string>Nyte Studio</string>
  <key>CFBundleIdentifier</key><string>ai.nyte.studio</string>
  <key>CFBundleExecutable</key><string>NyteStudio</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>26.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.graphics-design</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>UTExportedTypeDeclarations</key>
  <array>
    <dict>
      <key>UTTypeIdentifier</key><string>ai.nyte.lune</string>
      <key>UTTypeDescription</key><string>Lune Design</string>
      <key>UTTypeConformsTo</key><array><string>public.xml</string><string>public.text</string></array>
      <key>UTTypeTagSpecification</key>
      <dict><key>public.filename-extension</key><array><string>lune</string></array></dict>
    </dict>
  </array>
</dict>
</plist>
`,
);

run("codesign", ["--force", "--sign", "-", join(contents, "MacOS", "lune")]);

run("codesign", ["--force", "--sign", "-", app]);

process.stdout.write(`${app}\n`);
