/**
 * Keeps the token surface deliberate. Every handle must point at a declared
 * custom property, and the set of properties and handles must match
 * `test/token-lock.json`, so adding a token is a reviewed diff. `lock:tokens` rewrites
 * the lock after an intended change.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readGroups } from "./tokens.mjs";

const packages = join(dirname(fileURLToPath(import.meta.url)), "../..");
const lockPath = join(packages, "ui/test/token-lock.json");
const tokenFiles = [
  "ui/src/theme.stylex.ts",
  "ui/src/roles.stylex.ts",
  "ui/src/tokens.stylex.ts",
  "app/src/theme/tokens.stylex.ts",
];
const handleFiles = [
  "ui/src/vars.stylex.ts",
  "ui/src/schema.stylex.ts",
  "app/src/theme/schema.stylex.ts",
];

const declared = new Set();
const groups = {};
for (const file of tokenFiles) {
  for (const [name, { values }] of await readGroups(join(packages, file))) {
    for (const property of Object.keys(values)) declared.add(property);
    groups[`${file} ${name}`] = Object.keys(values).sort();
  }
}

const problems = [];
const handles = {};
for (const file of handleFiles) {
  for (const [name, { values }] of await readGroups(join(packages, file))) {
    handles[`${file} ${name}`] = Object.keys(values).sort();
    for (const [key, value] of Object.entries(values)) {
      for (const [, property] of String(value).matchAll(/var\((--nyte-[\w-]+)/g)) {
        if (!declared.has(property))
          problems.push(`${file} ${name}.${key} reads undeclared ${property}`);
      }
    }
  }
}

const lock = JSON.stringify({ groups, handles });
if (process.argv.includes("--update"))
  writeFileSync(lockPath, `${JSON.stringify(JSON.parse(lock), null, 2)}\n`);
else if (JSON.stringify(JSON.parse(readFileSync(lockPath, "utf8"))) !== lock)
  problems.push(
    "The token surface changed. Review it, then run `pnpm --dir packages/ui lock:tokens`.",
  );

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`tokens: ${declared.size} properties, ${Object.values(handles).flat().length} handles`);
