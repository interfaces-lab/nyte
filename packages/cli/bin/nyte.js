#!/usr/bin/env node

import { launch } from "../src/launcher.js";

try {
  process.exitCode = await launch(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
