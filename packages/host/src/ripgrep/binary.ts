/** Based on https://github.com/anomalyco/opencode/blob/0643a5638e0cd02234e73f176771527d7600faf7/packages/core/src/ripgrep/binary.ts */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { addAbortListener } from "node:events";
import { constants, existsSync } from "node:fs";
import { access, chmod, mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { isFileError } from "../paths.ts";

const VERSION = "15.1.0";

const MINIMUM_MAJOR_VERSION = 12;

const VERSION_PROBE_TIMEOUT_MS = 2_000;

const EXTRACTION_TIMEOUT_MS = 30_000;

const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;

const GlibcReport = Type.Object({
  header: Type.Object({ glibcVersionRuntime: Type.String({ minLength: 1 }) }),
});

type ArchiveConfig = {
  readonly platform: string;
  readonly extension: "tar.gz" | "zip";
  readonly sha256: string;
};

const ARCHIVES = new Map<string, ArchiveConfig>([
  [
    "arm64-darwin",
    {
      platform: "aarch64-apple-darwin",
      extension: "tar.gz",
      sha256: "378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715",
    },
  ],
  [
    "arm64-linux",
    {
      platform: "aarch64-unknown-linux-gnu",
      extension: "tar.gz",
      sha256: "2b661c6ef508e902f388e9098d9c4c5aca72c87b55922d94abdba830b4dc885e",
    },
  ],
  [
    "x64-darwin",
    {
      platform: "x86_64-apple-darwin",
      extension: "tar.gz",
      sha256: "64811cb24e77cac3057d6c40b63ac9becf9082eedd54ca411b475b755d334882",
    },
  ],
  [
    "x64-linux",
    {
      platform: "x86_64-unknown-linux-musl",
      extension: "tar.gz",
      sha256: "1c9297be4a084eea7ecaedf93eb03d058d6faae29bbc57ecdaf5063921491599",
    },
  ],
  [
    "arm64-win32",
    {
      platform: "aarch64-pc-windows-msvc",
      extension: "zip",
      sha256: "00d931fb5237c9696ca49308818edb76d8eb6fc132761cb2a1bd616b2df02f8e",
    },
  ],
  [
    "ia32-win32",
    {
      platform: "i686-pc-windows-msvc",
      extension: "zip",
      sha256: "725be85a1e8f92878a548f40ee4f6df64bc93b809586462b3c6d884e1de1e83a",
    },
  ],
  [
    "x64-win32",
    {
      platform: "x86_64-pc-windows-msvc",
      extension: "zip",
      sha256: "124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a",
    },
  ],
]);

async function isFile(path: string): Promise<boolean> {
  return existsSync(path) && (await stat(path)).isFile();
}

async function isExecutableFile(path: string): Promise<boolean> {
  if (!(await isFile(path))) return false;

  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);

    return true;
  } catch (cause) {
    if (isFileError(cause, ["EACCES", "EPERM"])) return false;
    throw cause;
  }
}

async function findInPath(
  name: string,
  accept: (candidate: string) => Promise<boolean>,
): Promise<string | undefined> {
  const path = process.env.PATH ?? process.env.Path ?? "";

  for (const directory of path.split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, name);

    if (await accept(candidate)) return candidate;
  }

  return undefined;
}

function findExecutable(name: string): Promise<string | undefined> {
  return findInPath(name, isExecutableFile);
}

function run(executable: string, arguments_: readonly string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      arguments_,
      {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        timeout,
        killSignal: "SIGKILL",
      },
      (error, stdout) => {
        if (error === null) resolve(stdout);
        else reject(error);
      },
    );
  });
}

async function isCompatibleRipgrep(path: string): Promise<boolean> {
  if (!(await isExecutableFile(path))) return false;

  try {
    const output = await run(path, ["--version"], VERSION_PROBE_TIMEOUT_MS);
    const version = /^ripgrep (\d+)\./.exec(output);

    return version !== null && Number(version[1]) >= MINIMUM_MAJOR_VERSION;
  } catch {
    return false;
  }
}

async function extract(
  archive: string,
  destination: string,
  executable: string,
  config: ArchiveConfig,
): Promise<void> {
  const member = `ripgrep-${VERSION}-${config.platform}/${process.platform === "win32" ? "rg.exe" : "rg"}`;
  await mkdir(dirname(executable), { recursive: true, mode: 0o700 });

  if (config.extension === "tar.gz") {
    const tar = await findExecutable("tar");

    if (tar === undefined) throw new Error("tar is required to install ripgrep");
    await run(tar, ["-xzf", archive, "-C", destination, "--", member], EXTRACTION_TIMEOUT_MS);

    return;
  }

  const powershell = (await findExecutable("powershell.exe")) ?? (await findExecutable("pwsh.exe"));

  if (powershell === undefined) throw new Error("PowerShell is required to install ripgrep");
  const quotedArchive = archive.replaceAll("'", "''");
  const quotedExecutable = executable.replaceAll("'", "''");
  const quotedMember = member.replaceAll("'", "''");
  await run(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "$global:ProgressPreference = 'SilentlyContinue'",
        "Add-Type -AssemblyName System.IO.Compression.FileSystem",
        `$zip = [System.IO.Compression.ZipFile]::OpenRead('${quotedArchive}')`,
        "try {",
        `  $entry = $zip.GetEntry('${quotedMember}')`,
        "  if ($null -eq $entry) { throw 'ripgrep archive did not contain its executable' }",
        `  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, '${quotedExecutable}', $false)`,
        "} finally { $zip.Dispose() }",
      ].join("\n"),
    ],
    EXTRACTION_TIMEOUT_MS,
  );
}

async function readArchive(response: Response, url: string): Promise<Buffer> {
  const reader = response.body?.getReader();

  try {
    if (!response.ok)
      throw new Error(`failed to download ripgrep from ${url}: HTTP ${response.status}`);

    if (Number(response.headers.get("content-length")) > MAX_ARCHIVE_BYTES)
      throw new Error(`ripgrep archive exceeds ${MAX_ARCHIVE_BYTES} bytes`);

    const chunks: Uint8Array[] = [];
    let size = 0;

    if (reader !== undefined) {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;
        size += value.byteLength;

        if (size > MAX_ARCHIVE_BYTES)
          throw new Error(`ripgrep archive exceeds ${MAX_ARCHIVE_BYTES} bytes`);
        chunks.push(value);
      }
    }

    if (size === 0) throw new Error(`failed to download ripgrep from ${url}: empty response`);

    return Buffer.concat(chunks, size);
  } finally {
    // Release rejected HTTP bodies without replacing the download error with a cancel error.
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}

async function installRipgrep(target: string, config: ArchiveConfig): Promise<string> {
  const directory = dirname(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(directory, ".ripgrep-"));

  try {
    const filename = `ripgrep-${VERSION}-${config.platform}.${config.extension}`;
    const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${filename}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    const bytes = await readArchive(response, url);

    const digest = createHash("sha256").update(bytes).digest("hex");

    if (digest !== config.sha256) {
      throw new Error(
        `failed to verify ripgrep archive ${filename}: expected SHA256 ${config.sha256}, received ${digest}`,
      );
    }

    const archive = join(temporary, filename);
    await writeFile(archive, bytes, { flag: "wx", mode: 0o600 });

    const executable = join(
      temporary,
      `ripgrep-${VERSION}-${config.platform}`,
      process.platform === "win32" ? "rg.exe" : "rg",
    );

    await extract(archive, temporary, executable, config);

    if (!(await isFile(executable))) {
      throw new Error(`ripgrep archive did not contain executable: ${executable}`);
    }

    if (process.platform !== "win32") await chmod(executable, 0o755);

    if (!(await isCompatibleRipgrep(executable))) {
      throw new Error(`ripgrep archive contained an incompatible executable: ${executable}`);
    }

    try {
      await rename(executable, target);
    } catch (cause) {
      if (!isFileError(cause, ["EEXIST", "EPERM"]) || !(await isCompatibleRipgrep(target))) {
        throw cause;
      }
    }

    return target;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function resolveBinary(archives: ReadonlyMap<string, ArchiveConfig>): Promise<string> {
  const executableName = process.platform === "win32" ? "rg.exe" : "rg";
  const system = await findInPath(executableName, isCompatibleRipgrep);

  if (system !== undefined) return system;

  const nyteHome = resolve(process.env.NYTE_HOME ?? join(homedir(), ".nyte"));
  const target = join(nyteHome, "bin", executableName);

  if (await isCompatibleRipgrep(target)) return target;
  await rm(target, { force: true });

  const platformKey = `${process.arch}-${process.platform}`;
  const config = archives.get(platformKey);

  if (config === undefined) throw new Error(`unsupported platform for ripgrep: ${platformKey}`);

  if (platformKey === "arm64-linux") {
    // The pinned release has only a glibc arm64 Linux build, not a musl build.
    if (!Value.Check(GlibcReport, process.report.getReport())) {
      throw new Error(
        "automatic ripgrep installation on arm64 Linux requires glibc; install ripgrep 12 or later on PATH for musl or unknown libc",
      );
    }
  }

  return installRipgrep(target, config);
}

type RipgrepResolver = (signal?: AbortSignal) => Promise<string>;

/** Build an isolated resolver. The package entrypoint uses the pinned official archive catalog. */
export function createRipgrepResolver(
  archives: ReadonlyMap<string, ArchiveConfig>,
): RipgrepResolver {
  let ripgrepPromise: Promise<string> | undefined;

  return async (signal?: AbortSignal): Promise<string> => {
    signal?.throwIfAborted();
    ripgrepPromise ??= resolveBinary(archives).catch((cause: unknown) => {
      ripgrepPromise = undefined;
      throw cause;
    });

    if (signal === undefined) return ripgrepPromise;

    // A cancelled search stops waiting without cancelling another search's shared installation.
    let subscription: ReturnType<typeof addAbortListener> | undefined;

    const aborted = new Promise<never>((_, reject) => {
      subscription = addAbortListener(signal, () => reject(signal.reason));
    });

    try {
      return await Promise.race([ripgrepPromise, aborted]);
    } finally {
      subscription?.[Symbol.dispose]();
    }
  };
}

/** Resolve a compatible system or Nyte-cached ripgrep, installing the pinned official binary when needed. */
export const resolveRipgrep = createRipgrepResolver(ARCHIVES);
