import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import packageMetadata from "../package.json" with { type: "json" };

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "key-file": { type: "string" } },
});
if (process.platform !== "darwin" || positionals.length !== 1 || !positionals[0]) {
  throw new Error(
    "Usage on macOS: pnpm update:appcast <release.zip> [--key-file <private-key-file>]. Without --key-file, Sparkle uses its default Keychain key.",
  );
}
const archive = resolve(positionals[0]);
const version = packageMetadata.version;
if (basename(archive) !== `Nyte-${version}-mac-arm64.zip`) {
  throw new Error(`Expected Nyte-${version}-mac-arm64.zip from the current desktop version.`);
}
const directory = await mkdtemp(join(tmpdir(), "nyte-appcast-"));
const cli = fileURLToPath(new URL("../node_modules/electron-sparkle/dist/cli.js", import.meta.url));
try {
  // Stage just this release's ZIP so old archives or DMGs cannot enter the feed.
  await copyFile(archive, join(directory, basename(archive)));
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "generate-appcast",
      "--download-url-prefix",
      `https://github.com/interfaces-lab/nyte/releases/download/v${version}/`,
      "--maximum-deltas",
      "0",
      ...(values["key-file"] === undefined ? [] : ["--ed-key-file", resolve(values["key-file"])]),
      directory,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Sparkle appcast generation failed with exit code ${result.status}`);
  const appcast = join(directory, "appcast.xml");
  const generated = await readFile(appcast, "utf8");
  if (
    generated.match(/<sparkle:shortVersionString>([^<]+)<\/sparkle:shortVersionString>/u)?.[1] !==
      version ||
    !generated.includes('sparkle:edSignature="')
  ) {
    throw new Error(
      "The archive must contain the current desktop version and have an Ed25519 signature. No appcast was copied.",
    );
  }
  const output = join(dirname(archive), "appcast.xml");
  await copyFile(appcast, output);
  console.log(`Generated ${output}. Nothing was published.`);
  console.log(
    `Upload the ZIP to release v${version} first, then replace appcast.xml on the desktop-updates release.`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
