import { statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { plugin } from "bun";
import { ensureSolidTransformPlugin } from "@opentui/solid/bun-plugin";
import { reloadingMount } from "./reload.ts";

if (process.env["NYTE_RELOAD"] !== "off")
  plugin({
    name: "nyte-reload",
    setup(build) {
      build.onLoad({ filter: /[/\\]tui[/\\]src[/\\]app[/\\]mount\.tsx$/u }, () => ({
        loader: "object",
        exports: { mountApp: reloadingMount },
      }));
    },
  });

ensureSolidTransformPlugin();

const invoked = process.env["INIT_CWD"] ?? process.cwd();

const named = process.argv[2];

const folder = named === undefined ? null : resolve(invoked, named);

if (folder !== null && statSync(folder, { throwIfNoEntry: false })?.isDirectory() === true) {
  process.argv.splice(2, 1);
  process.chdir(folder);
} else process.chdir(invoked);
