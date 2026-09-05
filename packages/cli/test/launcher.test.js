import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { ensureBinary, platformTarget, releaseAssetName } from "../src/launcher.js";

test("maps supported release targets", () => {
  assert.equal(platformTarget("darwin", "arm64"), "darwin-arm64");
  assert.equal(platformTarget("linux", "x64"), "linux-x64");
  assert.equal(platformTarget("win32", "x64"), undefined);
  assert.equal(releaseAssetName("v0.2.0", "darwin-arm64"), "nyte-v0.2.0-darwin-arm64");
});

test("downloads, verifies, and caches the native binary", async () => {
  const root = await mkdtemp(join(tmpdir(), "nyte-launcher-"));
  const fixture = await mkdtemp(join(tmpdir(), "nyte-release-"));
  try {
    const executable = join(fixture, "nyte");
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const archive = join(fixture, "release.tar.gz");
    await run("tar", ["-czf", archive, "-C", fixture, "nyte"]);
    const bytes = await readFile(archive);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const fetchFn = async (url) =>
      url.endsWith(".sha256") ? new Response(`${digest}  release.tar.gz\n`) : new Response(bytes);

    const binary = await ensureBinary({
      version: "0.2.0",
      platform: "darwin",
      arch: "arm64",
      root,
      fetchFn,
    });
    assert.equal(await readFile(binary, "utf8"), "#!/bin/sh\nexit 0\n");

    const cached = await ensureBinary({
      version: "0.2.0",
      platform: "darwin",
      arch: "arm64",
      root,
      fetchFn: async () => {
        throw new Error("cache miss");
      },
    });
    assert.equal(cached, binary);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(fixture, { recursive: true, force: true });
  }
});

test("rejects a mismatched checksum without keeping a binary", async () => {
  const root = await mkdtemp(join(tmpdir(), "nyte-launcher-"));
  try {
    const fetchFn = async (url) =>
      url.endsWith(".sha256") ? new Response("0".repeat(64)) : new Response("not an archive");
    await assert.rejects(
      ensureBinary({
        version: "0.2.0",
        platform: "linux",
        arch: "x64",
        root,
        fetchFn,
      }),
      /Checksum mismatch/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${String(code)}`));
    });
  });
}
