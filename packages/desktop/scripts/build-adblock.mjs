// Fetches EasyList and EasyPrivacy and writes them as one serialized engine to
// resources/adblock.bin. The app never fetches lists itself; this script is the
// only place a network request happens, and it runs at build time.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_VERSION, FiltersEngine } from "@ghostery/adblocker";
import { parseFilterLists } from "../src/main/adblock.ts";

const LISTS = [
  "https://easylist.to/easylist/easylist.txt",
  "https://easylist.to/easylist/easyprivacy.txt",
];
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(desktopRoot, "resources", "adblock.bin");
const force = process.argv.includes("--force");

async function fresh() {
  try {
    const info = await stat(output);
    if (Date.now() - info.mtimeMs > MAX_AGE_MS) return false;
    FiltersEngine.deserialize(await readFile(output));
    return true;
  } catch {
    return false;
  }
}

if (!force && (await fresh())) {
  process.stdout.write(`adblock: ${output} is current\n`);
} else {
  const texts = await Promise.all(
    LISTS.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      return response.text();
    }),
  );
  const engine = parseFilterLists(texts.join("\n"));
  await mkdir(dirname(output), { recursive: true });
  const bytes = engine.serialize();
  await writeFile(output, bytes);
  process.stdout.write(
    `adblock: wrote ${output} (${(bytes.byteLength / 1_024).toFixed(0)} KiB, engine ${String(ENGINE_VERSION)})\n`,
  );
}
