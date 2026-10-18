import process from "node:process";
import { sqliteStore } from "../../src/sqlite.ts";

const [path] = process.argv.slice(2);

if (path === undefined) throw new Error("Usage: node hold-store.ts <path>");

await sqliteStore({ path }).open();

process.stdout.write("held\n");

process.stdin.on("close", () => process.exit(0));
process.stdin.resume();
