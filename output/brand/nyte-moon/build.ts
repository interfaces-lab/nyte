import { readFileSync, writeFileSync } from "node:fs";
const tpl = readFileSync("/tmp/nyte-cube-template.html", "utf8");
let bundle = readFileSync("/tmp/pretext.bundle.js", "utf8").trim();
const m = bundle.match(/export\{([^}]*)\};?\s*$/);
if (!m) throw new Error("no export clause");
const pairs = m[1].split(",").map((p) => p.trim().split(" as "));
bundle =
  bundle.slice(0, m.index) +
  "const __pretext={" +
  pairs.map(([local, name]) => `${name}:${local}`).join(",") +
  "};";
const slice = (path: string, from: number, to: number) =>
  readFileSync(path, "utf8")
    .split("\n")
    .slice(from - 1, to)
    .join("\n");
const source = [
  slice("packages/core/src/kernel/README.md", 1, 60),
  slice("packages/core/src/kernel/names.ts", 1, 70),
  slice("packages/core/src/kernel/lease.ts", 1, 60),
  slice("packages/core/src/kernel/effects.ts", 1, 120),
  slice("packages/core/src/kernel/step.ts", 1, 80),
].join("\n\n");
const html = tpl
  .replace("__PRETEXT__", () => bundle)
  .replace("__SOURCE__", () => JSON.stringify(source));
writeFileSync("output/brand/nyte-moon/index.html", html);
console.log("wrote", html.length, "bytes");
