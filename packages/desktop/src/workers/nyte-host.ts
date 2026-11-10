import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { serveHost } from "@nyte-ai/service/serve-host";

const USAGE = "Usage: ELECTRON_RUN_AS_NODE=1 Nyte nyte-host.js [--log] [--tailnet <path>]";

delete process.env.ELECTRON_RUN_AS_NODE;

process.chdir(homedir());

const args = process.argv.slice(2);

const tailnetAt = args.indexOf("--tailnet");

const tailnet =
  tailnetAt === -1 ? join(process.resourcesPath, "nyte-tailnet") : args[tailnetAt + 1];

if (
  tailnet === undefined ||
  (tailnetAt === -1 ? args : args.toSpliced(tailnetAt, 2)).some((arg) => arg !== "--log")
)
  throw new Error(USAGE);

const stop = new AbortController();

for (const ending of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.once(ending, () => stop.abort());

void serveHost({
  entry: new URL("./host-worker.js", import.meta.url),
  log: args.includes("--log"),
  whenTaken: "wait",
  tailnet,
  supervisor: process.platform === "darwin" ? "launchd" : null,
  signal: stop.signal,
  output: { write: (text) => void process.stdout.write(text) },
  listening: (host) => `${JSON.stringify({ type: "listening", ...host })}\n`,
});
