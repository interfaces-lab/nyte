import { answersOnce, namesOperation } from "@nyte-ai/protocol";
import type { HostSocket } from "@nyte-ai/protocol";
import { describeOperations, isJson, OPERATIONS } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import type { Connection, OperationDescription } from "@nyte-ai/sdk";
import { CliError } from "./cli/errors.ts";
import { formatRows, formatTable, printable } from "./cli/format.ts";
import { parseCommandArgs, readAction } from "./cli/options.ts";
import type { Output } from "./cli/output.ts";
import { hostFailure, readHostUrl } from "./host-socket.ts";

/** Without `--host-url`, `list` and `describe` read this build's own table, so they need no running host. Returns the exit code. */
export async function apiCommand(input: {
  readonly args: readonly string[];
  readonly attach: (url: string) => Promise<Connection>;
  readonly connect: (hostUrl: string | undefined) => Promise<HostSocket>;
  readonly stdin: () => Promise<string>;
  readonly output: Output;
  /** Columns on stdout, for shortening summaries in a terminal. */
  readonly width: number;
}): Promise<number> {
  const parsed = parseApiArgs(input.args);
  const output = input.output;

  if (parsed.command === "call") {
    const op = parsed.operation;

    if (parsed.hostUrl === undefined) knownCall(op);

    const value =
      parsed.input === undefined
        ? await readStdinInput(op, input)
        : readJson(parsed.input, "the input argument");

    const socket = await input.connect(parsed.hostUrl);

    try {
      output.json(await socket.call(op, value).catch(hostFailure(`call ${op}`)));

      return 0;
    } finally {
      socket.close();
    }
  }

  const names = parsed.command === "describe" ? [parsed.operation] : undefined;

  if (parsed.hostUrl === undefined && parsed.command === "describe")
    knownOperation(parsed.operation);

  const operations =
    parsed.hostUrl === undefined
      ? describeOperations(names)
      : await (
          await input.attach(parsed.hostUrl)
        ).operations
          .describe(names)
          .catch(
            hostFailure(
              parsed.command === "describe" ? `describe ${parsed.operation}` : "list operations",
            ),
          );

  if (parsed.json) {
    output.json(parsed.command === "describe" ? (operations[0] ?? null) : operations);

    return 0;
  }

  if (parsed.command === "list") {
    const rows = operations.map((operation) => [operation.name, printable(operation.summary)]);
    const lines = formatTable(["Operation", "Summary"], rows, output.mode.stdout, input.width);
    output.result(`${lines.join("\n")}\n`);

    return 0;
  }

  for (const operation of operations) output.result(`${describeLines(operation, output)}\n`);

  return 0;
}

function parseApiArgs(args: readonly string[]) {
  const found = readAction("api", args);
  const command = found.action;
  const operands = { list: 0, describe: 1, call: 2 }[command];
  const parsed = parseCommandArgs("api", found.args, operands, command);
  const json = parsed.has("json");
  const hostUrl = readHostUrl("api", parsed.value("host-url"));
  const operation = parsed.positionals[0];

  if (command === "list") return { command, json, hostUrl } as const;

  if (operation === undefined)
    throw new CliError("missing_input", `Name the operation to ${command}.`, {
      next: [{ label: "See the options", argv: ["nyte", "api", command, "--help"] }],
    });

  if (command === "describe") return { command, operation, json, hostUrl } as const;

  return { command, operation, input: parsed.positionals[1], json, hostUrl } as const;
}

/** This build's table, checked before any request so a typo needs no host. `--host-url` skips it: that host may serve a newer table. */
function knownCall(op: string): void {
  knownOperation(op);

  if (namesOperation(op) && !answersOnce(op))
    throw new CliError(
      "invalid_arguments",
      `Can't call ${op}: it's a ${OPERATIONS[op].kind}, and call takes one answer.`,
      { next: [{ label: "See how it answers", argv: ["nyte", "api", "describe", op] }] },
    );
}

function knownOperation(op: string): void {
  if (!namesOperation(op))
    throw new CliError("not_found", `Couldn't find operation ${op}.`, {
      next: [{ label: "See every operation", argv: ["nyte", "api", "list"] }],
    });
}

/** A terminal stdin is someone typing, not a payload, so the input has to come as the argument. */
async function readStdinInput(
  op: string,
  input: { readonly stdin: () => Promise<string>; readonly output: Output },
): Promise<Json> {
  if (input.output.mode.tty.stdin)
    throw new CliError("missing_input", `Can't call ${op} without its input.`, {
      next: [
        { label: "Pass the input as JSON", argv: ["nyte", "api", "call", op, "<JSON>"] },
        { label: "See its input schema", argv: ["nyte", "api", "describe", op] },
      ],
    });

  const text = await input.stdin();

  return text.trim() === "" ? {} : readJson(text, "stdin");
}

function readJson(text: string, source: string): Json {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new CliError("invalid_arguments", `Can't read ${source} as JSON.`, {
      details: [{ label: "Parser", value: error instanceof Error ? error.message : String(error) }],
    });
  }

  if (!isJson(value)) throw new CliError("invalid_arguments", `Can't read ${source} as JSON.`);

  return value;
}

/** The answer on stdout: the summary, the facts as rows, then both schemas. Summaries from `--host-url` are remote text. */
function describeLines(operation: OperationDescription, output: Output): string {
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
    printable(operation.summary),
    "",
    ...formatRows(facts, output.mode.stdout),
    "",
    "Input schema",
    JSON.stringify(operation.input, null, 2),
    "",
    "Output schema",
    JSON.stringify(operation.output, null, 2),
  ].join("\n");
}
