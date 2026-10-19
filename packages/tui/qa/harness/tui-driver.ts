import process from "node:process";
import { createInterface } from "node:readline";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { openPty } from "../pty.ts";

const LaunchSchema = Type.Object({
  bun: Type.String(),
  binary: Type.String(),
  args: Type.Array(Type.String()),
  cwd: Type.String(),
  env: Type.Record(Type.String(), Type.String()),
});

const CommandSchema = Type.Object({
  id: Type.Number(),
  kind: Type.String(),
  text: Type.Optional(Type.String()),
  pattern: Type.Optional(Type.String()),
  flags: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
});

type Command = Static<typeof CommandSchema>;

const launch = Value.Parse(LaunchSchema, JSON.parse(process.argv[2] ?? "{}"));

const pty = await openPty({
  binary: launch.bun,
  args: [launch.binary, ...launch.args],
  cwd: launch.cwd,
  env: launch.env,
  width: 120,
  height: 40,
});

const state = { ended: false };

const exited = pty.exited().then((code) => {
  state.ended = true;

  return code;
});

const reply = (message: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const matches = (command: Command, screen: string): boolean => {
  if (command.pattern !== undefined) return new RegExp(command.pattern, command.flags).test(screen);

  return screen.includes(command.text ?? "");
};

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === "") continue;
  const command = Value.Parse(CommandSchema, JSON.parse(line));

  switch (command.kind) {
    case "pid":
      reply({ id: command.id, ok: true, pid: pty.pid });
      break;
    case "screen":
      reply({ id: command.id, ok: true, screen: pty.screen().text });
      break;
    case "type":
      pty.type(command.text ?? "");
      reply({ id: command.id, ok: true });
      break;
    case "wait": {
      const deadline = performance.now() + (command.timeoutMs ?? 20_000);
      let found = false;

      while (performance.now() < deadline && !state.ended) {
        if (matches(command, pty.screen().text)) {
          found = true;
          break;
        }

        await Bun.sleep(25);
      }

      reply({
        id: command.id,
        ok: found || matches(command, pty.screen().text),
        screen: pty.screen().text,
      });
      break;
    }

    case "exited":
      await exited;
      reply({ id: command.id, ok: true, screen: pty.output() });
      break;
    case "close":
      await pty[Symbol.asyncDispose]();
      reply({ id: command.id, ok: true });
      process.exit(0);
      break;
    default:
      reply({ id: command.id, ok: false, error: `Unknown command ${command.kind}` });
  }
}
