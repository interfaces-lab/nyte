import { describeOperations, isJson } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { asSdkError, encodeError } from "@nyte-ai/protocol";
import type { HostSocket } from "@nyte-ai/protocol";
import type { Connection, OperationDescription } from "@nyte-ai/sdk";
import { alignedRows, ansiEnabled, bold, dim } from "./cli-style.ts";

interface Output {
  readonly write: (text: string) => void;
  readonly error: (text: string) => void;
}

const USAGE =
  "Usage: nyte api <list | describe <operation> | call <operation> [json-input]> [--json] [--host-url <url>]. Run `nyte api --help`.";

/** Without `--host-url`, `list` and `describe` read this build's own table, so they need no running host. Returns the exit code. */
export async function apiCommand(input: {
  readonly args: readonly string[];
  readonly attach: (url: string) => Promise<Connection>;
  readonly connect: (hostUrl: string | undefined) => Promise<HostSocket>;
  readonly stdin: () => Promise<string>;
  readonly output: Output;
}): Promise<number> {
  const parsed = parseApiArgs(input.args);

  if (parsed.command === "call") {
    const text = parsed.input ?? (await input.stdin());
    const value = readInput(text.trim() === "" ? "{}" : text);
    const socket = await input.connect(parsed.hostUrl);

    try {
      return await socket.call(parsed.names[0] ?? "", value).then(
        (output) => {
          input.output.write(`${JSON.stringify(output, null, 2)}\n`);

          return 0;
        },
        (error: Error) => {
          input.output.error(JSON.stringify(encodeError(asSdkError(error)), null, 2));

          return 1;
        },
      );
    } finally {
      socket.close();
    }
  }

  const operations =
    parsed.hostUrl === undefined
      ? describeOperations(parsed.names)
      : await (await input.attach(parsed.hostUrl)).operations.describe(parsed.names);

  if (parsed.json) {
    input.output.write(
      `${JSON.stringify(parsed.command === "describe" ? operations[0] : operations, null, 2)}\n`,
    );

    return 0;
  }

  const color = ansiEnabled();

  if (parsed.command === "list") {
    const rows = operations.map((operation) => ({
      label: operation.name,
      detail: operation.summary,
    }));

    input.output.write(`${alignedRows(rows, color).join("\n")}\n`);

    return 0;
  }

  for (const operation of operations) input.output.write(`${describeLines(operation, color)}\n`);

  return 0;
}

function parseApiArgs(args: readonly string[]) {
  const command = args[0];
  const rest = args.slice(1);
  const positional: string[] = [];
  let json = false;
  let hostUrl: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === "--json") json = true;
    else if (arg === "--host-url") {
      hostUrl = rest[index + 1];

      if (hostUrl === undefined || hostUrl.startsWith("-"))
        throw new Error("--host-url needs the host's URL.");
      index += 1;
    } else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}. ${USAGE}`);
    else positional.push(arg);
  }

  if (command === "list" && positional.length === 0)
    return { command, names: undefined, json, hostUrl } as const;

  if (command === "describe" && positional.length === 1)
    return { command, names: positional, json, hostUrl } as const;

  if (command === "call" && (positional.length === 1 || positional.length === 2))
    return { command, names: positional.slice(0, 1), input: positional[1], json, hostUrl } as const;

  throw new Error(USAGE);
}

function readInput(text: string): Json {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`The input isn't JSON: ${text.slice(0, 80)}`);
  }

  if (!isJson(value)) throw new Error("The input isn't JSON.");

  return value;
}

function describeLines(operation: OperationDescription, color: boolean): string {
  const facts = [
    { label: "Operation", value: operation.name },
    { label: "Kind", value: operation.kind },
    { label: "Authority", value: operation.authority },
    { label: "Scope", value: operation.scope },
    ...(operation.capability === undefined
      ? []
      : [{ label: "Capability", value: operation.capability }]),
  ];

  return [
    operation.summary,
    "",
    ...facts.map((fact) => `${dim(`${fact.label}:`, color)} ${fact.value}`),
    "",
    bold("Input schema:", color),
    JSON.stringify(operation.input, null, 2),
    "",
    bold("Output schema:", color),
    JSON.stringify(operation.output, null, 2),
  ].join("\n");
}
