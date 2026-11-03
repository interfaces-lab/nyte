import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

const output = resolve(process.argv[2] ?? resolve(here, "dist", "nyte-tailnet"));

const version =
  process.env["NYTE_RELEASE_VERSION"] ??
  JSON.parse(readFileSync(new URL("../host/package.json", import.meta.url), "utf8")).version;

execFileSync(
  "go",
  ["build", "-trimpath", `-ldflags=-s -w -X main.version=${version}`, "-o", output, "."],
  { cwd: here, stdio: "inherit", env: { ...process.env, CGO_ENABLED: "0" } },
);
