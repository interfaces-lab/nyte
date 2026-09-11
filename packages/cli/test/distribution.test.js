import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { ensureBinary, platformTarget, releaseAssetName } from "../src/launcher.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const cli = join(repo, "packages/cli");

async function checkDocs(root) {
  const physicalRoot = await realpath(root);
  const pending = [join(root, "README.md")];
  const visited = new Set();
  while (pending.length > 0) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    const text = await readFile(path, "utf8");
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      if (/^https?:\/\//u.test(match[1])) continue;
      const target = resolve(dirname(path), match[1]);
      const physicalTarget = await realpath(target);
      assert.ok(!relative(physicalRoot, physicalTarget).startsWith(".."), target);
      if (target.endsWith(".md")) pending.push(target);
    }
  }
}

test("npm pack ships a self-contained guide and working source examples", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "nyte-npm-pack-"));
  try {
    const source = join(fixture, "source");
    await mkdir(source);
    for (const path of ["package.json", "README.md", "docs", "bin", "src"]) {
      await cp(join(cli, path), join(source, path), { recursive: true });
    }
    await writeFile(join(fixture, "npmrc"), "");
    execFileSync("npm", ["pack", "--ignore-scripts", "--offline", "--pack-destination", fixture], {
      cwd: source,
      env: {
        ...process.env,
        npm_config_cache: join(fixture, "cache"),
        npm_config_userconfig: join(fixture, "npmrc"),
      },
      stdio: "pipe",
    });
    const archive = (await readdir(fixture)).find((name) => name.endsWith(".tgz"));
    assert.ok(archive);
    execFileSync("tar", ["-xzf", join(fixture, archive), "-C", fixture]);
    const packed = join(fixture, "package");
    await checkDocs(packed);
    await checkDocs(join(packed, "docs"));
    assert.equal(
      JSON.parse(await readFile(join(packed, "package.json"), "utf8")).version,
      JSON.parse(await readFile(join(cli, "package.json"), "utf8")).version,
    );

    const fakeBin = join(fixture, "fake-bin");
    await mkdir(fakeBin);
    await writeFile(join(fakeBin, "nyte"), '#!/bin/sh\nprintf "%s\\n" "$@"\ncat\n', {
      mode: 0o755,
    });
    const options = {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
      encoding: "utf8",
      input: "",
    };
    const examples = join(packed, "docs/examples");
    assert.equal(
      execFileSync("sh", [join(examples, "ask.sh"), "a $(literal) prompt", "--model"], options),
      "--print\n--\na $(literal) prompt\n--model\n",
    );
    const prompt = join(fixture, "prompt with spaces.txt");
    await writeFile(prompt, "Summarize this project.\n");
    assert.equal(
      execFileSync("sh", [join(examples, "prompt-file.sh"), prompt], options),
      "--print\nSummarize this project.\n",
    );
    await writeFile(join(fakeBin, "nyte"), "#!/bin/sh\nexit 7\n", { mode: 0o755 });
    assert.equal(spawnSync("sh", [join(examples, "ask.sh"), "prompt"], options).status, 7);
    assert.equal(spawnSync("sh", [join(examples, "prompt-file.sh"), prompt], options).status, 7);
    assert.equal(spawnSync("sh", [join(examples, "ask.sh")], options).status, 2);
    assert.equal(spawnSync("sh", [join(examples, "prompt-file.sh")], options).status, 2);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 30_000);

test("native assembly, npm cache, and installer retain matching docs without network access", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "nyte-native-pack-"));
  try {
    const binary = join(fixture, "fixture-binary");
    await writeFile(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const output = join(fixture, "release");
    const target = platformTarget();
    assert.ok(target);
    execFileSync("sh", [join(repo, "scripts/assemble-release.sh"), binary, output, target]);
    const metadata = JSON.parse(await readFile(join(cli, "package.json"), "utf8"));
    const asset = releaseAssetName(metadata.version, target);
    const archive = join(output, `${asset}.tar.gz`);
    execFileSync("tar", ["-xzf", archive, "-C", output]);
    assert.equal((await readFile(join(output, "VERSION"), "utf8")).trim(), metadata.version);
    await checkDocs(join(output, "docs"));
    assert.equal(await readFile(join(output, "nyte"), "utf8"), await readFile(binary, "utf8"));
    execFileSync("shasum", ["-a", "256", "-c", `${asset}.tar.gz.sha256`], { cwd: output });

    const cachedBinary = await ensureBinary({
      root: join(fixture, "cache"),
      version: metadata.version,
      fetchFn: async (url) =>
        new Response(await readFile(join(output, new URL(url).pathname.split("/").pop()))),
    });
    await checkDocs(join(dirname(cachedBinary), "docs"));

    const fakeBin = join(fixture, "fake-bin");
    await mkdir(fakeBin);
    // Replace only the download transport. The installer still checks the real checksum and extracts tar.
    await writeFile(
      join(fakeBin, "curl"),
      `#!/bin/sh
set -eu
case "$1" in
  -fsSLI) printf 200 ;;
  -fsSL) cp "$FIXTURE_RELEASE/\${4##*/}" "$3" ;;
  *) exit 99 ;;
esac
`,
      { mode: 0o755 },
    );
    const installDir = join(fixture, "custom prefix/bin");
    const installed = execFileSync(
      "sh",
      [
        join(repo, "packages/docs/public/install"),
        "--version",
        metadata.version,
        "--no-modify-path",
      ],
      {
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          FIXTURE_RELEASE: output,
          NYTE_INSTALL_DIR: installDir,
          GITHUB_ACTIONS: "false",
        },
        encoding: "utf8",
      },
    );
    const docs = resolve(installDir, "../share/nyte", metadata.version, "docs");
    await checkDocs(docs);
    assert.equal(await readFile(join(installDir, "nyte"), "utf8"), await readFile(binary, "utf8"));
    assert.ok(installed.includes(`/share/nyte/${metadata.version}/docs/README.md`));
    assert.ok(installed.includes("Checksum ok."));
    await writeFile(join(installDir, "nyte"), "existing executable\n");
    await writeFile(join(output, `${asset}.tar.gz.sha256`), `${"0".repeat(64)}  ${asset}.tar.gz\n`);
    const rejected = spawnSync(
      "sh",
      [
        join(repo, "packages/docs/public/install"),
        "--version",
        metadata.version,
        "--no-modify-path",
      ],
      {
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          FIXTURE_RELEASE: output,
          NYTE_INSTALL_DIR: installDir,
          GITHUB_ACTIONS: "false",
        },
        encoding: "utf8",
      },
    );
    assert.notEqual(rejected.status, 0);
    assert.ok(!rejected.stdout.includes("Installed nyte"));
    assert.equal(await readFile(join(installDir, "nyte"), "utf8"), "existing executable\n");
    await checkDocs(docs);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 30_000);

async function installerFixture(fixture) {
  const binary = join(fixture, "fixture-binary");
  await writeFile(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const output = join(fixture, "release");
  execFileSync("sh", [join(repo, "scripts/assemble-release.sh"), binary, output, platformTarget()]);
  const metadata = JSON.parse(await readFile(join(cli, "package.json"), "utf8"));
  const fakeBin = join(fixture, "fake-bin");
  await mkdir(fakeBin);
  await writeFile(
    join(fakeBin, "curl"),
    `#!/bin/sh
set -eu
case "$1" in
  -fsSLI) printf 200 ;;
  -fsSL) cp "$FIXTURE_RELEASE/\${4##*/}" "$3" ;;
  *) exit 99 ;;
esac
`,
    { mode: 0o755 },
  );
  const home = join(fixture, "home");
  await mkdir(home);
  const installDir = join(home, ".local/bin");
  await mkdir(installDir, { recursive: true });
  return {
    installDir,
    docs: join(home, ".local/share/nyte", metadata.version, "docs"),
    rc: join(home, ".bashrc"),
    run: (...args) =>
      spawnSync(
        "sh",
        [join(repo, "packages/docs/public/install"), "--version", metadata.version, ...args],
        {
          env: {
            ...process.env,
            HOME: home,
            SHELL: "/bin/bash",
            XDG_CONFIG_HOME: join(home, ".config"),
            ZDOTDIR: home,
            PATH: `${fakeBin}:${process.env.PATH}`,
            FIXTURE_RELEASE: output,
            NYTE_INSTALL_DIR: installDir,
            NYTE_NO_MODIFY_PATH: "",
            GITHUB_ACTIONS: "false",
          },
          encoding: "utf8",
        },
      ),
  };
}

test.each(["blocked share", "docs symlink", "document symlink", "conflicting document"])(
  "installer preserves the executable and outside bytes with %s",
  async (obstacle) => {
    const fixture = await mkdtemp(join(tmpdir(), "nyte-install-reject-"));
    try {
      const installer = await installerFixture(fixture);
      const executable = join(installer.installDir, "nyte");
      await writeFile(executable, "existing executable\n");
      const outside = join(fixture, "outside");
      await mkdir(outside);
      const sentinel = join(outside, "README.md");
      await writeFile(sentinel, "outside sentinel\n");
      if (obstacle === "blocked share") {
        await writeFile(resolve(installer.installDir, "../share"), "blocked\n");
      } else if (obstacle === "docs symlink") {
        await mkdir(dirname(installer.docs), { recursive: true });
        await symlink(outside, installer.docs);
      } else {
        await mkdir(installer.docs, { recursive: true });
        if (obstacle === "document symlink") {
          await symlink(sentinel, join(installer.docs, "README.md"));
        } else {
          await mkdir(join(installer.docs, "README.md"));
        }
      }
      const rejected = installer.run("--no-modify-path");
      assert.deepEqual(
        {
          failed: rejected.status !== 0,
          executable: await readFile(executable, "utf8"),
          outside: await readFile(sentinel, "utf8"),
          successReceipt: rejected.stdout.includes("Installed nyte"),
        },
        {
          failed: true,
          executable: "existing executable\n",
          outside: "outside sentinel\n",
          successReceipt: false,
        },
      );
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  },
  30_000,
);

test("installer appends PATH once and respects --no-modify-path in an isolated HOME", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "nyte-install-path-"));
  try {
    const installer = await installerFixture(fixture);
    const sentinel = "# shell rc sentinel\n";
    await writeFile(installer.rc, sentinel);
    const first = installer.run();
    assert.equal(first.status, 0, first.stderr);
    const expected = `${sentinel}\n# nyte\nexport PATH="${installer.installDir}:$PATH"\n`;
    assert.equal(await readFile(installer.rc, "utf8"), expected);
    const rerun = installer.run();
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.equal(await readFile(installer.rc, "utf8"), expected);
    await writeFile(installer.rc, sentinel);
    const skipped = installer.run("--no-modify-path");
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.equal(await readFile(installer.rc, "utf8"), sentinel);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 30_000);
