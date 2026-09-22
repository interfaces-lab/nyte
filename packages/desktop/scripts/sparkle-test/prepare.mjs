import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("This update test requires an Apple Silicon Mac.");
}

const desktop = fileURLToPath(new URL("../../", import.meta.url));

const directory = await mkdtemp(join(tmpdir(), "nyte-sparkle-test-"));

const feed = join(directory, "feed");

await mkdir(feed);

// A disposable archive key, outside both the app and the served directory.
const { privateKey, publicKey } = generateKeyPairSync("ed25519");

const privateJwk = privateKey.export({ format: "jwk" });

const publicJwk = publicKey.export({ format: "jwk" });

if (privateJwk.d === undefined || publicJwk.x === undefined) {
  throw new Error("Could not export the disposable Ed25519 key.");
}

const privateKeyFile = join(directory, "test-key");

await writeFile(privateKeyFile, Buffer.from(privateJwk.d, "base64url").toString("base64"), {
  mode: 0o600,
});

const env = {
  ...process.env,
  NYTE_UPDATE_TEST: "1",
  NYTE_SPARKLE_PUBLIC_KEY: Buffer.from(publicJwk.x, "base64url").toString("base64"),
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
};

function run(command, args) {
  const result = spawnSync(command, args, { cwd: desktop, env, stdio: "inherit" });

  if (result.error) throw result.error;

  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

console.log(`Building real Nyte update-test apps in ${directory}`);

console.log("Separate app identity and Nyte home. Ad-hoc signing; no Keychain or release changes.");

run("pnpm", ["build"]);

const sparkleCli = "node_modules/electron-sparkle/dist/cli.js";

for (const version of ["1.0.0", "1.0.1"]) {
  const output = join(directory, version);
  run("node", [
    "node_modules/electron-builder/out/cli/cli.js",
    "--config",
    "electron-builder.config.ts",
    "--mac",
    "--arm64",
    "--dir",
    "--publish",
    "never",
    `--config.directories.output=${output}`,
    `--config.extraMetadata.version=${version}`,
  ]);
  const appPath = join(output, "mac-arm64", "Nyte Update Test.app");
  run("node", [sparkleCli, "doctor", "--app", appPath]);

  if (version === "1.0.1") {
    run("ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      appPath,
      join(feed, "Nyte-Update-Test-1.0.1.zip"),
    ]);
  }
}

run("node", [
  sparkleCli,
  "generate-appcast",
  "--ed-key-file",
  privateKeyFile,
  "--download-url-prefix",
  "http://localhost:8917/",
  "--maximum-deltas",
  "0",
  feed,
]);

const appPath = join(directory, "1.0.0", "mac-arm64", "Nyte Update Test.app");

const serveScript = fileURLToPath(new URL("serve.mjs", import.meta.url));

console.log("\nBoth real-app builds passed Sparkle's structural and code-signature checks.");

console.log("The interactive update and relaunch still need testing.");

console.log(`\nStart the local feed:\nnode ${JSON.stringify(serveScript)} ${JSON.stringify(feed)}`);

console.log(`\nThen launch the old build:\nopen ${JSON.stringify(appPath)}`);

console.log("Choose Check for Updates… and install. About Nyte should show 1.0.1 after relaunch.");

console.log(
  "A second check should find no update. Logs: ~/Library/Application Support/Nyte Update Test/updates.log",
);

console.log(
  `Remove ${directory} after quitting the test app and stopping the feed. It contains the disposable private key.`,
);
