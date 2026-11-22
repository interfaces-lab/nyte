import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compile } from "@nyte-ai/schema";
import { Type } from "typebox";

const PackageManifest = compile(Type.Object({ version: Type.String() }));

/** The nearest `node_modules/<name>` at or above `from`, with the version its manifest states; null when there is none or its manifest cannot be read. */
export async function findPackage(
  from: string,
  name: string,
): Promise<{ readonly folder: string; readonly version: string } | null> {
  const folder = join(from, "node_modules", name);

  if ((await stat(folder).catch(() => null)) !== null) return readPackage(folder);
  const parent = dirname(from);

  return parent === from ? null : findPackage(parent, name);
}

export async function readPackage(
  folder: string,
): Promise<{ readonly folder: string; readonly version: string } | null> {
  const text = await readFile(join(folder, "package.json"), "utf8").catch(() => null);

  if (text === null) return null;

  try {
    const manifest: unknown = JSON.parse(text);

    return PackageManifest.Check(manifest) ? { folder, version: manifest.version } : null;
  } catch {
    return null;
  }
}
