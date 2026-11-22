import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "@nyte-ai/schema";
import { Type } from "typebox";
import { run } from "../src/local/process/command.ts";

const USAGE = `Prints the pins a language server's install source needs.

  node packages/host/scripts/pin-language-server.ts release <url>...
      Downloads each URL and prints its url, sha256 and size.

  node packages/host/scripts/pin-language-server.ts npm <lock.json> <name@version>...
      Resolves the packages with npm and writes every tarball they need, with its
      integrity, to <lock.json>.`;

const Lockfile = compile(
  Type.Object({
    packages: Type.Record(
      Type.String(),
      Type.Object({
        resolved: Type.Optional(Type.String()),
        integrity: Type.Optional(Type.String()),
        link: Type.Optional(Type.Boolean()),
        os: Type.Optional(Type.Array(Type.String())),
        cpu: Type.Optional(Type.Array(Type.String())),
      }),
    ),
  }),
);

const [mode, ...rest] = process.argv.slice(2);

if (mode === "release" && rest.length > 0) await pinRelease(rest);
else if (mode === "npm" && rest.length > 1) await pinNpm(rest[0] ?? "", rest.slice(1));
else {
  console.error(USAGE);
  process.exitCode = 2;
}

async function pinRelease(urls: readonly string[]): Promise<void> {
  for (const url of urls) {
    const response = await fetch(url);

    if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    console.log(
      JSON.stringify({
        url,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
      }),
    );
  }
}

async function pinNpm(output: string, packages: readonly string[]): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), "nyte-pin-"));

  try {
    await writeFile(join(folder, "package.json"), JSON.stringify({ private: true }));

    const ran = await run(
      "npm",
      [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        ...packages,
      ],
      { cwd: folder },
    );

    if (ran.code !== 0) throw new Error(ran.stderr);
    const lock: unknown = JSON.parse(await readFile(join(folder, "package-lock.json"), "utf8"));

    if (!Lockfile.Check(lock)) throw new Error("npm wrote a lockfile this script cannot read.");

    const pinned = Object.entries(lock.packages)
      .flatMap((entry) => {
        const found = entry[1];

        return entry[0] === "" ||
          found.link === true ||
          found.resolved === undefined ||
          found.integrity === undefined
          ? []
          : [
              {
                path: entry[0],
                url: found.resolved,
                integrity: found.integrity,
                ...(found.os === undefined ? {} : { os: found.os }),
                ...(found.cpu === undefined ? {} : { cpu: found.cpu }),
              },
            ];
      })
      .toSorted((left, right) => left.path.localeCompare(right.path));

    await writeFile(output, `${JSON.stringify(pinned, null, 2)}\n`);
    console.log(`${pinned.length} packages pinned in ${output}`);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
