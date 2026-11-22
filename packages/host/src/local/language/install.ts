import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { findExecutable, run } from "../process/command.ts";
import { processExists } from "../process/machine.ts";
import { unpack, untar } from "./archive.ts";
import { INSTALL_FOLDER, PLATFORMS } from "./spec.ts";
import type { Install, Installed, NpmPackage, Project } from "./spec.ts";

const UNUSED_VERSION_MS = 30 * 24 * 60 * 60_000;

const TOOLCHAIN_DEADLINE_MS = 10 * 60_000;

const DOWNLOAD_DEADLINE_MS = 30 * 60_000;

const TEMPORARY = /^\.tmp-(\d+)-/;

const PROBE_DEADLINE_MS = 10_000;

export interface Installer {
  /** The pinned version of what `source` names, downloaded and verified unless its folder is there already; concurrent calls share one download. `report` hears the percent downloaded, null when the size is unknown. Rejects with the reason nothing was installed. */
  install(source: Install, report: (percent: number | null) => void): Promise<Installed>;
  /** Whether any version of the package is installed, which is how a user's earlier request for it is remembered. */
  holds(name: string): Promise<boolean>;
}

/** Installs pinned language servers under `cache`, one folder per package, version and platform, which exists only once complete. A version no launch has used for 30 days is removed when another version of its package installs. */
export function languageInstaller(cache: string): Installer {
  const running = new Map<string, Promise<void>>();

  return {
    async install(source, report) {
      const home = join(cache, source.package);
      const folder = join(home, `${source.version}-${process.platform}-${process.arch}`);
      const installed = locate(source, folder);

      const started =
        running.get(folder) ??
        fillFolder(home, folder, source, report).finally(() => running.delete(folder));

      running.set(folder, started);
      await started;

      return installed;
    },
    async holds(name) {
      const versions = await readdir(join(cache, name)).catch(() => []);

      return versions.some((version) => !TEMPORARY.test(version));
    },
  };
}

/** The size of the download for this platform, where the pin recorded it. */
export function downloadBytes(source: Install): number | null {
  return source.kind === "release" ? (platformAsset(source)?.bytes ?? null) : null;
}

export async function passesProbe(
  program: string,
  probe: readonly string[],
  folder: string,
): Promise<boolean> {
  const ran = await run(program, probe, { cwd: folder, timeoutMs: PROBE_DEADLINE_MS }).catch(
    () => null,
  );

  return ran?.code === 0;
}

export function openProject(root: string, installer: Installer | undefined): Project {
  const install: Project["install"] = async (source) =>
    installer === undefined ? null : installer.install(source, () => undefined);

  return {
    root,
    install,
    async tool(program, probe, source) {
      const found = await findExecutable(program);

      if (found !== null && (await passesProbe(found, probe, root))) {
        return { path: found, pinned: false };
      }

      const installed = await install(source).catch(() => null);

      return installed === null ? null : { path: installed.path, pinned: true };
    },
  };
}

async function fillFolder(
  home: string,
  folder: string,
  source: Install,
  report: (percent: number | null) => void,
): Promise<void> {
  if ((await stat(folder).catch(() => null)) !== null) {
    const now = new Date();
    await utimes(folder, now, now).catch(() => undefined);

    return;
  }

  await mkdir(home, { recursive: true });
  await removeAbandoned(home);
  const temporary = join(home, `.tmp-${process.pid}-${randomUUID()}`);
  await mkdir(temporary);

  try {
    await fill(source, temporary, report);
    await rename(temporary, folder).catch(async (error: unknown) => {
      if ((await stat(folder).catch(() => null)) === null) throw error;
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  await removeUnused(home, folder);
}

function locate(source: Install, folder: string): Installed {
  if (source.kind === "npm") {
    return { kind: "script", path: join(folder, source.entry), folder, env: {} };
  }

  if (source.kind === "toolchain") {
    return {
      kind: "binary",
      path: join(folder, process.platform === "win32" ? `${source.bin}.exe` : source.bin),
      folder,
      env: placeEnv(source.env, folder),
    };
  }

  return { kind: "binary", path: join(folder, findAsset(source).bin), folder, env: {} };
}

function platformAsset(source: Extract<Install, { kind: "release" }>) {
  const platform = PLATFORMS.find((name) => name === `${process.platform}-${process.arch}`);

  return platform === undefined ? undefined : source.assets[platform];
}

function findAsset(source: Extract<Install, { kind: "release" }>) {
  const asset = platformAsset(source);

  if (asset === undefined) {
    throw new Error(`Nyte has no download of it for ${process.platform} on ${process.arch}.`);
  }

  return asset;
}

async function fill(
  source: Install,
  folder: string,
  report: (percent: number | null) => void,
): Promise<void> {
  if (source.kind === "release") {
    const asset = findAsset(source);
    const file = join(folder, ".download");
    await download(asset.url, file, asset.sha256, report);
    await unpack(file, asset.format, folder, asset.bin);
    await rm(file);
    await chmod(join(folder, asset.bin), 0o755);

    return;
  }

  if (source.kind === "npm") {
    const wanted = source.packages.filter(
      (entry) =>
        (entry.os === undefined || entry.os.includes(process.platform)) &&
        (entry.cpu === undefined || entry.cpu.includes(process.arch)),
    );

    let done = 0;

    await Promise.all(
      wanted.map(async (entry) => {
        await addPackage(entry, folder);
        done += 1;
        report(Math.floor((done / wanted.length) * 100));
      }),
    );

    return;
  }

  const program = await findExecutable(source.program);

  if (program === null) {
    throw new Error(`Installing it needs ${source.program}, which is not on PATH.`);
  }

  report(null);

  const ran = await run(
    program,
    source.arguments.map((argument) => argument.replaceAll(INSTALL_FOLDER, folder)),
    { cwd: folder, env: placeEnv(source.env, folder), timeoutMs: TOOLCHAIN_DEADLINE_MS },
  );

  if (ran.code !== 0) {
    throw new Error(
      `${source.program} ${source.arguments[0] ?? ""} failed: ${ran.stderr.trim().split("\n").at(-1) ?? ""}`,
    );
  }
}

function placeEnv(
  env: Readonly<Record<string, string>>,
  folder: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(env).map((entry) => [entry[0], entry[1].replaceAll(INSTALL_FOLDER, folder)]),
  );
}

async function addPackage(entry: NpmPackage, folder: string): Promise<void> {
  const response = await request(entry.url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const separator = entry.integrity.indexOf("-");
  const digest = createHash(entry.integrity.slice(0, separator)).update(bytes).digest("base64");

  if (digest !== entry.integrity.slice(separator + 1)) {
    throw new Error(
      `${entry.url} does not match its pinned ${entry.integrity.slice(0, separator)}.`,
    );
  }

  await untar([gunzipSync(bytes)], join(folder, entry.path), 1);
}

async function download(
  url: string,
  file: string,
  sha256: string,
  report: (percent: number | null) => void,
): Promise<void> {
  const response = await request(url);

  if (response.body === null) throw new Error(`${url} answered nothing.`);
  const total = Number(response.headers.get("content-length") ?? 0);
  const hash = createHash("sha256");
  const handle = await open(file, "w");
  let received = 0;
  let reported: number | null = -1;

  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      await handle.write(chunk);
      received += chunk.byteLength;
      const percent = total > 0 ? Math.floor((received / total) * 100) : null;

      if (percent !== reported) report(percent);
      reported = percent;
    }
  } finally {
    await handle.close();
  }

  if (hash.digest("hex") !== sha256) throw new Error(`${url} does not match its pinned sha256.`);
}

async function request(url: string): Promise<Response> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_DEADLINE_MS),
  }).catch((error: unknown) => {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;

    throw new Error(
      `${new URL(url).host} could not be reached: ${cause instanceof Error ? cause.message : String(cause)}.`,
    );
  });

  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);

  return response;
}

async function removeAbandoned(home: string): Promise<void> {
  await Promise.all(
    (await readdir(home)).map(async (name) => {
      const owner = TEMPORARY.exec(name)?.[1];

      if (owner !== undefined && !processExists(Number(owner))) {
        await rm(join(home, name), { recursive: true, force: true });
      }
    }),
  );
}

async function removeUnused(home: string, keep: string): Promise<void> {
  const cutoff = Date.now() - UNUSED_VERSION_MS;

  await Promise.all(
    (await readdir(home)).map(async (name) => {
      const path = join(home, name);
      const found =
        TEMPORARY.test(name) || path === keep ? null : await stat(path).catch(() => null);

      if (found !== null && found.mtimeMs < cutoff) {
        await rm(path, { recursive: true, force: true });
      }
    }),
  );
}
