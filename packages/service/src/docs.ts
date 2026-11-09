import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@nyte-ai/core";
import { hostDocsPath } from "./host-endpoint.ts";

export type DocsFiles = Readonly<Record<string, string>>;

export function readCheckoutDocs(): DocsFiles {
  const root = fileURLToPath(new URL("../../docs/content/docs/", import.meta.url));

  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);

        return [relative(root, path).split(sep).join("/"), readFileSync(path, "utf8")];
      }),
  );
}

export async function syncDocs(files: DocsFiles): Promise<string> {
  const root = hostDocsPath();
  const entries = Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1));

  const digest = entries
    .reduce((hash, [name, text]) => hash.update(`${name}\0${text}\0`), createHash("sha256"))
    .digest("hex")
    .slice(0, 16);

  const folder = join(root, digest);

  if (!existsSync(folder)) {
    const staging = `${folder}.${process.pid}`;
    await rm(staging, { recursive: true, force: true });
    await Promise.all(
      entries.map(async ([name, text]) => {
        const path = join(staging, name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, text);
      }),
    );
    await rename(staging, folder);
  }

  const stale = (await readdir(root)).filter((name) => name !== digest);
  await Promise.all(stale.map((name) => rm(join(root, name), { recursive: true, force: true })));

  return folder;
}

export function docsPlugin(folder: string): Plugin<"core"> {
  return {
    id: "local-docs",
    contribute: {
      prompt: [
        {
          id: "docs",
          order: 3,
          text: `Nyte's documentation for this build is in ${folder}. When the user asks how Nyte itself works, read the relevant page there instead of guessing. Start with index.mdx; each folder's meta.json lists its pages, and a link such as /docs/configure/skills is configure/skills.mdx there, or configure/skills/index.mdx.`,
        },
      ],
    },
  };
}
