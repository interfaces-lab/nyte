import { spawnSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import manifest from "../package.json" with { type: "json" };

const root = new URL("../", import.meta.url);
const fixture = new URL(".fixtures/echo/", root);
await rm(fixture, { recursive: true, force: true });
await mkdir(fixture, { recursive: true });
for (const path of ["src", "workflows", "nitro.config.ts"]) {
  await cp(new URL(path, root), new URL(path, fixture), { recursive: true });
}
await writeFile(
  new URL("package.json", fixture),
  JSON.stringify({
    name: `${manifest.name}-fixture`,
    private: true,
    type: manifest.type,
    dependencies: manifest.dependencies,
    devDependencies: manifest.devDependencies,
  }),
);
// Copy the application fresh on every build; only model composition belongs to the fixture.
await cp(new URL("fixtures/echo.ts", root), new URL("src/models.ts", fixture));
await writeFile(
  new URL("tsconfig.json", fixture),
  JSON.stringify({
    extends: "../../tsconfig.json",
    include: ["src", "workflows", "nitro.config.ts"],
  }),
);
const build = spawnSync(
  "pnpm",
  [
    "--config.verify-deps-before-run=false",
    "exec",
    "nitro",
    "build",
    "--dir",
    fileURLToPath(fixture),
    "--preset",
    "vercel",
  ],
  { cwd: fileURLToPath(root), stdio: "inherit" },
);
if (build.error) throw build.error;
if (build.status !== 0) process.exitCode = build.status ?? 1;
else console.log(`Preview fixture built in ${fileURLToPath(fixture)}`);
