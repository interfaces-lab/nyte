import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function swiftFiles(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return swiftFiles(path);
    return entry.name.endsWith(".swift") ? [path] : [];
  }));
  return nested.flat().sort();
}

export function blankLiterals(text) {
  let insideBlock = false;
  return text.split("\n").map((raw) => {
    const fences = raw.split('"""').length - 1;
    if (insideBlock) {
      if (fences % 2 === 1) insideBlock = false;
      return "";
    }
    if (fences % 2 === 1) {
      insideBlock = true;
      return raw.slice(0, raw.indexOf('"""')) + '""';
    }
    return raw.replace(/"(?:[^"\\]|\\.)*"/gu, '""');
  });
}
