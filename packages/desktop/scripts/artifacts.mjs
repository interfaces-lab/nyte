import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Entries in `directory` written at or after `since` (epoch ms). Blockmaps and
// electron-builder's config dumps are skipped. A directory stands in for the
// app bundles inside it when it has any.
export function artifacts(directory, since) {
  const rows = [];

  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name.startsWith(".") || entry.name.startsWith("builder-")) continue;

    if (entry.name.endsWith(".blockmap")) continue;
    const path = join(directory, entry.name);
    const info = statSync(path);

    if (info.mtimeMs < since) continue;

    if (!entry.isDirectory()) {
      rows.push({ name: entry.name, size: info.size });
      continue;
    }

    const bundles = readdirSync(path).filter((name) => name.endsWith(".app"));

    if (bundles.length === 0) rows.push({ name: `${entry.name}/` });

    for (const bundle of bundles) rows.push({ name: join(entry.name, bundle) });
  }

  return rows;
}
