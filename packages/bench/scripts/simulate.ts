import process from "node:process";
import { createInterface } from "node:readline";
import {
  CASSETTES,
  fakeModels,
  lastUserText,
  playCassette,
  readCommand,
  simulate,
  titleReply,
} from "../src/index.ts";

const [name] = process.argv.slice(2);

const cassette = Object.entries(CASSETTES).find(([key]) => key === name)?.[1];

if (name !== undefined && cassette === undefined) {
  process.stderr.write(`Usage: pnpm simulate [${Object.keys(CASSETTES).join(" | ")}]\n`);
  process.exit(1);
}

const player = cassette === undefined ? null : await playCassette({ cassette });

const models =
  player?.models ??
  fakeModels({
    fallback: (request) => ({
      content: [{ type: "text", text: titleReply(request) ?? `Echo: ${lastUserText(request)}` }],
    }),
  }).models;

const write = (line: unknown): void => {
  process.stdout.write(`${JSON.stringify(line)}\n`);
};

const simulation = await simulate({ models });

write({ kind: "ready", home: simulation.home, workspace: simulation.workspace });

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === "") continue;
  const read = readCommand(line);

  if (read.kind === "invalid") {
    write({ kind: "error", message: read.reason });
    continue;
  }

  try {
    write(await simulation.drive(read.command));
  } catch (error) {
    write({ kind: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

await simulation[Symbol.asyncDispose]();

await player?.close();
