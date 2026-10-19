import process from "node:process";
import { tryLockFile } from "@nyte-ai/connect/host";

const [path] = process.argv.slice(2);

if (path === undefined) throw new Error("Usage: node hold-relay.ts <path>");

const release = tryLockFile(path);

process.stdout.write(release === null ? "busy\n" : "held\n");

process.stdin.on("end", () => release?.());

process.stdin.resume();
