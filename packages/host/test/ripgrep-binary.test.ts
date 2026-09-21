import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const sourceUrl = pathToFileURL(join(import.meta.dirname, "../src/ripgrep/binary.ts")).href;

function run(
  executable: string,
  arguments_: readonly string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executable, arguments_, { ...options, encoding: "utf8" }, (error, stdout) => {
      if (error === null) resolve(stdout);
      else reject(error);
    });
  });
}

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "nyte-ripgrep-"));
  directories.push(directory);
  return directory;
}

function findProgram(names: readonly string[]): string | undefined {
  for (const directory of (process.env.PATH ?? process.env.Path ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    for (const name of names) {
      const candidate = join(directory, name);
      try {
        accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // Keep searching PATH.
      }
    }
  }
  return undefined;
}

async function executable(options: {
  path: string;
  version?: string;
  stall?: boolean;
  incompatibleSibling?: string;
}): Promise<void> {
  const { path, version = "12.0.0", stall = false, incompatibleSibling } = options;
  await mkdir(dirname(path), { recursive: true });
  if (process.platform !== "win32") {
    const delay = stall ? "while true; do :; done\n" : "";
    const siblingCheck =
      incompatibleSibling === undefined
        ? ""
        : `directory=\${0%/*}\nif [ -e "$directory/${incompatibleSibling}" ]; then printf '%s\\n' 'ripgrep 11.0.0'; exit 0; fi\n`;
    await writeFile(
      path,
      `#!/bin/sh\n${delay}${siblingCheck}printf '%s\\n' 'ripgrep ${version}'\n`,
      { mode: 0o755 },
    );
    return;
  }

  const powershell = findProgram(["powershell.exe", "pwsh.exe"]);
  if (powershell === undefined) throw new Error("PowerShell is required for Windows test fixtures");
  const source = `${path}.cs`;
  const siblingCheck =
    incompatibleSibling === undefined
      ? ""
      : `if (System.IO.File.Exists(System.IO.Path.Combine(AppContext.BaseDirectory, ${JSON.stringify(incompatibleSibling)}))) { Console.WriteLine("ripgrep 11.0.0"); return 0; }`;
  await writeFile(
    source,
    [
      "using System;",
      "using System.Threading;",
      "public static class Program {",
      "  public static int Main() {",
      stall ? "    Thread.Sleep(30000);" : "",
      `    ${siblingCheck}`,
      `    Console.WriteLine("ripgrep ${version}");`,
      "    return 0;",
      "  }",
      "}",
    ].join("\n"),
  );
  const quotedSource = source.replaceAll("'", "''");
  const quotedPath = path.replaceAll("'", "''");
  try {
    await run(powershell, [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath '${quotedSource}') -OutputAssembly '${quotedPath}' -OutputType ConsoleApplication`,
    ]);
  } finally {
    await rm(source, { force: true });
  }
}

async function harness(directory: string, body: string): Promise<string> {
  const path = join(directory, "harness.mjs");
  await writeFile(
    path,
    `import { createRipgrepResolver, resolveRipgrep } from ${JSON.stringify(sourceUrl)};\n${body}\n`,
  );
  return path;
}

async function runHarness(
  path: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  return run(process.execPath, ["--no-warnings", "--experimental-strip-types", path], options);
}

function archivePlatform(): string | undefined {
  const key = `${process.arch}-${process.platform}`;
  if (key === "arm64-darwin") return "aarch64-apple-darwin";
  if (key === "x64-darwin") return "x86_64-apple-darwin";
  if (key === "arm64-linux") return "aarch64-unknown-linux-gnu";
  if (key === "x64-linux") return "x86_64-unknown-linux-musl";
  if (key === "arm64-win32") return "aarch64-pc-windows-msvc";
  if (key === "ia32-win32") return "i686-pc-windows-msvc";
  if (key === "x64-win32") return "x86_64-pc-windows-msvc";
  return undefined;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("resolveRipgrep", () => {
  it("accepts ripgrep 12 from the first absolute PATH entry instead of forcing the pinned version", async () => {
    const directory = await fixture();
    const name = process.platform === "win32" ? "rg.exe" : "rg";
    const system = join(directory, "system", name);
    const cached = join(directory, "home", "bin", name);
    await executable({ path: system });
    await executable({ path: cached, version: "15.1.0" });
    const script = await harness(
      directory,
      "globalThis.fetch = async () => { throw new Error('unexpected download'); };\nconsole.log(await resolveRipgrep());",
    );

    const stdout = await runHarness(script, {
      env: { ...process.env, NYTE_HOME: join(directory, "home"), PATH: dirname(system) },
    });
    expect(stdout.trim()).toBe(system);
  });

  it("skips an incompatible PATH binary and uses the next compatible one", async () => {
    const directory = await fixture();
    const name = process.platform === "win32" ? "rg.exe" : "rg";
    const incompatible = join(directory, "old", name);
    const compatible = join(directory, "current", name);
    await executable({ path: incompatible, version: "11.0.2" });
    await executable({ path: compatible });
    const script = await harness(
      directory,
      "globalThis.fetch = async () => { throw new Error('unexpected download'); };\nconsole.log(await resolveRipgrep());",
    );

    const stdout = await runHarness(script, {
      env: {
        ...process.env,
        NYTE_HOME: join(directory, "home"),
        PATH: `${dirname(incompatible)}${delimiter}${dirname(compatible)}`,
      },
    });
    expect(stdout.trim()).toBe(compatible);
  });

  it("ignores cwd and relative PATH entries before using a compatible cache", async () => {
    const directory = await fixture();
    const name = process.platform === "win32" ? "rg.exe" : "rg";
    const cwdExecutable = join(directory, "cwd", name);
    const cached = join(directory, "home", "bin", name);
    await executable({ path: cwdExecutable });
    await executable({ path: cached });
    const script = await harness(
      directory,
      "globalThis.fetch = async () => { throw new Error('unexpected download'); };\nconsole.log(await resolveRipgrep());",
    );

    const stdout = await runHarness(script, {
      cwd: dirname(cwdExecutable),
      env: { ...process.env, NYTE_HOME: join(directory, "home"), PATH: `.${delimiter}` },
    });
    expect(stdout.trim()).toBe(cached);
  });

  it("bounds version probes before trying the next candidate", async () => {
    const directory = await fixture();
    const name = process.platform === "win32" ? "rg.exe" : "rg";
    const stalled = join(directory, "stalled", name);
    const cached = join(directory, "home", "bin", name);
    await executable({ path: stalled, stall: true });
    await executable({ path: cached });
    const script = await harness(
      directory,
      "globalThis.fetch = async () => { throw new Error('unexpected download'); };\nconsole.log(await resolveRipgrep());",
    );

    const stdout = await runHarness(script, {
      env: { ...process.env, NYTE_HOME: join(directory, "home"), PATH: dirname(stalled) },
    });
    expect(stdout.trim()).toBe(cached);
  }, 10_000);

  const platform = archivePlatform();
  const tar = findProgram(["tar"]);
  const powershell = findProgram(["powershell.exe", "pwsh.exe"]);
  const windows = process.platform === "win32";
  const archiveTool = windows ? powershell : tar;
  it.skipIf(platform === undefined || archiveTool === undefined)(
    "verifies, selectively extracts, atomically caches, and memoizes an archive",
    async () => {
      if (platform === undefined || archiveTool === undefined)
        throw new Error("missing archive fixture tools");
      const directory = await fixture();
      const root = `ripgrep-15.1.0-${platform}`;
      const source = join(directory, "archive's source");
      const name = windows ? "rg.exe" : "rg";
      const extension = windows ? "zip" : "tar.gz";
      await executable({
        path: join(source, root, name),
        incompatibleSibling: "unexpected",
      });
      await writeFile(join(source, root, "unexpected"), "must not be extracted");
      const archive = join(directory, `${root}.${extension}`);
      if (windows) {
        await run(archiveTool, [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Compress-Archive -LiteralPath '${join(source, root).replaceAll("'", "''")}' -DestinationPath '${archive.replaceAll("'", "''")}'`,
        ]);
      } else {
        await run(archiveTool, ["-czf", archive, "-C", source, root]);
      }
      const archiveBytes = await readFile(archive);
      const digest = createHash("sha256").update(archiveBytes).digest("hex");
      const tools = join(directory, "tools");
      await mkdir(tools);
      if (!windows) {
        await symlink(archiveTool, join(tools, "tar"));
        const gzip = findProgram(["gzip"]);
        if (gzip !== undefined) await symlink(gzip, join(tools, "gzip"));
      }
      const expectedUrl = `https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/${root}.${extension}`;
      const script = await harness(
        directory,
        [
          "import { readFile, readdir } from 'node:fs/promises';",
          "let calls = 0;",
          "globalThis.fetch = async (url) => {",
          "  calls += 1;",
          "  if (url !== process.env.EXPECTED_URL) throw new Error(`unexpected URL: ${url}`);",
          "  const bytes = await readFile(process.env.ARCHIVE);",
          "  return new Response(new ReadableStream({ start(controller) {",
          "    controller.enqueue(bytes.subarray(0, 17));",
          "    controller.enqueue(bytes.subarray(17));",
          "    controller.close();",
          "  } }));",
          "};",
          "const resolveFixtureRipgrep = createRipgrepResolver(new Map([[process.env.PLATFORM_KEY, {",
          "  platform: process.env.ARCHIVE_PLATFORM,",
          "  extension: process.env.ARCHIVE_EXTENSION,",
          "  sha256: process.env.ARCHIVE_SHA256,",
          "}]]));",
          "const [first, second] = await Promise.all([resolveFixtureRipgrep(), resolveFixtureRipgrep()]);",
          "console.log(first);",
          "console.log(second);",
          "console.log(calls);",
          "console.log((await readdir(process.env.BIN)).sort().join(','));",
        ].join("\n"),
      );
      const home = join(directory, "home's cache");
      const target = join(home, "bin", name);
      await executable({ path: target, version: "11.0.2" });

      const stdout = await runHarness(script, {
        env: {
          ...process.env,
          ARCHIVE: archive,
          ARCHIVE_PLATFORM: platform,
          ARCHIVE_EXTENSION: extension,
          ARCHIVE_SHA256: digest,
          BIN: join(home, "bin"),
          EXPECTED_URL: expectedUrl,
          NYTE_HOME: home,
          PATH: windows ? dirname(archiveTool) : tools,
          PLATFORM_KEY: `${process.arch}-${process.platform}`,
        },
      });
      expect(stdout.trim().split(/\r?\n/)).toEqual([target, target, "1", name]);
      expect((await run(target, ["--version"])).trim()).toBe("ripgrep 12.0.0");
    },
    30_000,
  );

  it.each([
    { status: 200, length: undefined, error: "exceeds", streamed: true },
    { status: 200, length: "1", error: "exceeds", streamed: true },
    { status: 200, length: "67108864", error: "exceeds", streamed: false },
    { status: 503, length: undefined, error: "HTTP 503", streamed: false },
  ])("bounds and cancels rejected HTTP bodies: $status, length $length", async (scenario) => {
    const directory = await fixture();
    const home = join(directory, "home");
    const script = await harness(
      directory,
      [
        `const scenario = ${JSON.stringify(scenario)};`,
        "let sent = 0;",
        "let cancelled = false;",
        "let calls = 0;",
        "globalThis.fetch = async () => {",
        "  if (++calls > 1) return new Response(null, { status: 503 });",
        "  const body = new ReadableStream({",
        "    pull(controller) {",
        "      if (sent === 64) { controller.close(); return; }",
        "      sent += 1;",
        "      controller.enqueue(new Uint8Array(1024 * 1024));",
        "    },",
        "    cancel() { cancelled = true; },",
        "  }, { highWaterMark: 0 });",
        "  return new Response(body, { status: scenario.status, headers: scenario.length === undefined ? {} : { 'content-length': scenario.length } });",
        "};",
        "try { await resolveRipgrep(); } catch (error) { console.log(error.message); }",
        "console.log(cancelled);",
        "console.log(sent);",
        "try { await resolveRipgrep(); } catch (error) { console.log(error.message); }",
        "console.log(calls);",
      ].join("\n"),
    );
    const stdout = await runHarness(script, {
      env: { ...process.env, NYTE_HOME: home, PATH: "" },
    });
    const lines = stdout.trim().split(/\r?\n/);
    expect(lines[0]).toContain(scenario.error);
    expect(lines[1]).toBe("true");
    expect(Number(lines[2])).toBeLessThan(64);
    if (scenario.streamed) expect(Number(lines[2])).toBeGreaterThan(0);
    else expect(Number(lines[2])).toBe(0);
    expect(lines[3]).toContain("HTTP 503");
    expect(lines[4]).toBe("2");
    expect(await readdir(join(home, "bin"))).toEqual([]);
  });

  it.each(["empty", "interrupted"])("cleans up an %s download", async (kind) => {
    const directory = await fixture();
    const home = join(directory, "home");
    const script = await harness(
      directory,
      [
        kind === "empty"
          ? "globalThis.fetch = async () => new Response(null);"
          : "globalThis.fetch = async () => new Response(new ReadableStream({ pull(controller) { controller.error(new Error('connection lost')); } }));",
        "try { await resolveRipgrep(); } catch (error) { console.log(error.message); }",
      ].join("\n"),
    );
    const stdout = await runHarness(script, {
      env: { ...process.env, NYTE_HOME: home, PATH: "" },
    });
    expect(stdout).toContain(kind === "empty" ? "empty response" : "connection lost");
    expect(await readdir(join(home, "bin"))).toEqual([]);
  });

  it.each([
    { header: {}, downloads: false },
    { header: null, downloads: false },
    { header: { glibcVersionRuntime: "" }, downloads: false },
    { header: { glibcVersionRuntime: "2.39" }, downloads: true },
  ])(
    "only downloads the arm64 Linux glibc build with detected glibc: $header",
    async (scenario) => {
      const directory = await fixture();
      const script = await harness(
        directory,
        [
          "Object.defineProperty(process, 'platform', { value: 'linux' });",
          "Object.defineProperty(process, 'arch', { value: 'arm64' });",
          `process.report.getReport = () => ({ header: ${JSON.stringify(scenario.header)} });`,
          "let calls = 0;",
          "globalThis.fetch = async () => { calls += 1; return new Response(null, { status: 503 }); };",
          "try { await resolveRipgrep(); } catch (error) { console.log(error.message); }",
          "console.log(calls);",
        ].join("\n"),
      );
      const stdout = await runHarness(script, {
        env: { ...process.env, NYTE_HOME: join(directory, "home"), PATH: "" },
      });
      const lines = stdout.trim().split(/\r?\n/);
      expect(lines[0]).toContain(scenario.downloads ? "HTTP 503" : "requires glibc");
      expect(lines[1]).toBe(scenario.downloads ? "1" : "0");
    },
  );

  it.skipIf(process.platform === "win32").each(["PATH", "cache"])(
    "accepts compatible %s binaries on arm64 Linux musl without downloading",
    async (location) => {
      const directory = await fixture();
      const home = join(directory, "home");
      const binary = join(
        location === "PATH" ? join(directory, "system") : join(home, "bin"),
        "rg",
      );
      await executable({ path: binary });
      const script = await harness(
        directory,
        [
          "Object.defineProperty(process, 'platform', { value: 'linux' });",
          "Object.defineProperty(process, 'arch', { value: 'arm64' });",
          "process.report.getReport = () => ({ header: {} });",
          "globalThis.fetch = async () => { throw new Error('unexpected download'); };",
          "console.log(await resolveRipgrep());",
        ].join("\n"),
      );
      const stdout = await runHarness(script, {
        env: { ...process.env, NYTE_HOME: home, PATH: location === "PATH" ? dirname(binary) : "" },
      });
      expect(stdout.trim()).toBe(binary);
    },
  );

  it("rejects an archive whose SHA256 does not match the pinned release", async () => {
    const directory = await fixture();
    const home = join(directory, "home");
    const script = await harness(
      directory,
      [
        "globalThis.fetch = async () => new Response('tampered archive');",
        "try { await resolveRipgrep(); } catch (error) { console.log(error instanceof Error ? error.message : String(error)); }",
      ].join("\n"),
    );

    const stdout = await runHarness(script, {
      env: { ...process.env, NYTE_HOME: home, PATH: "" },
    });
    expect(stdout).toContain("expected SHA256");
    expect(stdout).toContain("received");
    expect(await readdir(join(home, "bin"))).toEqual([]);
  });

  it("deduplicates concurrent failures but retries after the shared resolution rejects", async () => {
    const directory = await fixture();
    const home = join(directory, "home");
    const script = await harness(
      directory,
      [
        "let calls = 0;",
        "globalThis.fetch = async () => {",
        "  calls += 1;",
        "  await new Promise((resolve) => setTimeout(resolve, 20));",
        "  return new Response('unavailable', { status: 503 });",
        "};",
        "const first = await Promise.allSettled([resolveRipgrep(), resolveRipgrep()]);",
        "for (const result of first) console.log(result.status === 'rejected' && result.reason instanceof Error ? result.reason.message : result.status);",
        "try { await resolveRipgrep(); } catch (error) { console.log(error instanceof Error ? error.message : String(error)); }",
        "console.log(calls);",
      ].join("\n"),
    );

    const stdout = await runHarness(script, {
      env: { ...process.env, NYTE_HOME: home, PATH: "" },
    });
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toContain("HTTP 503");
    expect(lines[1]).toBe(lines[0]);
    expect(lines[2]).toBe(lines[0]);
    expect(lines[3]).toBe("2");
    expect(await readdir(join(home, "bin"))).toEqual([]);
  });

  it("lets one caller cancel without cancelling the shared installation", async () => {
    const directory = await fixture();
    const script = await harness(
      directory,
      [
        "let calls = 0;",
        "globalThis.fetch = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 50)); return new Response('unavailable', { status: 503 }); };",
        "const shared = resolveRipgrep();",
        "const controller = new AbortController();",
        "const cancelled = resolveRipgrep(controller.signal).catch((error) => error instanceof Error ? error.message : String(error));",
        "controller.abort(new Error('cancelled'));",
        "console.log(await cancelled);",
        "try { await shared; } catch (error) { console.log(error instanceof Error ? error.message : String(error)); }",
        "console.log(calls);",
      ].join("\n"),
    );

    const stdout = await runHarness(script, {
      env: { ...process.env, NYTE_HOME: join(directory, "home"), PATH: "" },
    });
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("cancelled");
    expect(lines[1]).toContain("HTTP 503");
    expect(lines[2]).toBe("1");
  });
});
