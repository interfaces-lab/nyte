import { decodeOutput } from "@nyte-ai/protocol";
import type { HostSocket } from "@nyte-ai/protocol";
import { isJson } from "@nyte-ai/schema";
import type { ClientRow, Json } from "@nyte-ai/schema";
import { CliError } from "./cli/errors.ts";
import { formatTable, printable } from "./cli/format.ts";
import { parseCommandArgs, readAction } from "./cli/options.ts";
import type { Output } from "./cli/output.ts";
import { hostFailure, readHostUrl } from "./host-socket.ts";

const LISTED = 5;

const SEE_ACTIONS = { label: "See what each client offers", argv: ["nyte", "action", "list"] };

interface Input {
  readonly args: readonly string[];
  readonly connect: (hostUrl: string | undefined) => Promise<HostSocket>;
  readonly output: Output;
  readonly width: number;
}

export async function actionCommand(input: Input): Promise<number> {
  const found = readAction("action", input.args);

  if (found.action === "list") {
    const parsed = parseCommandArgs("action", found.args, 0, "list");
    const hostUrl = readHostUrl("action", parsed.value("host-url"));
    const socket = await input.connect(hostUrl);

    try {
      showList(await readClients(socket), parsed.has("json"), input);
    } finally {
      socket.close();
    }

    return 0;
  }

  const parsed = parseCommandArgs("action", found.args, Number.POSITIVE_INFINITY, "run");
  const action = parsed.positionals[0];

  if (action === undefined) {
    throw new CliError("missing_input", "Name the action to run.", { next: [SEE_ACTIONS] });
  }

  const given = readFields(action, parsed.positionals.slice(1));
  const hostUrl = readHostUrl("action", parsed.value("host-url"));
  const socket = await input.connect(hostUrl);

  try {
    const target = chooseClient(await readClients(socket), action, parsed.value("client"));

    const result = await socket
      .call("client.perform", { client: target.id, action, input: given })
      .catch(hostFailure(`run ${action}`));

    if (parsed.has("json")) input.output.json(result);
    else {
      if (result !== null) input.output.result(`${JSON.stringify(result)}\n`);
      input.output.status("done", `Ran ${action}`);
      input.output.rows([{ label: "Client", value: `${printable(target.name)} ${target.id}` }]);
    }

    return 0;
  } finally {
    socket.close();
  }
}

async function readClients(socket: HostSocket): Promise<readonly ClientRow[]> {
  return decodeOutput(
    "clients.read",
    await socket.call("clients.read", {}).catch(hostFailure("list the connected clients")),
  );
}

function showList(clients: readonly ClientRow[], json: boolean, input: Input): void {
  const offering = clients.filter((client) => client.actions.length > 0);

  if (json) {
    input.output.json(
      offering.map((client) => ({
        client: client.id,
        name: client.name,
        kind: client.kind,
        actions: client.actions,
      })),
    );

    return;
  }

  if (offering.length === 0) {
    input.output.say("No connected client offers an action. Open the Nyte app to get its actions.");

    return;
  }

  const rows = offering.flatMap((client) =>
    client.actions.map((action) => [
      client.id,
      printable(client.name),
      printable(action.name),
      printable(action.summary),
    ]),
  );

  input.output.result(
    `${formatTable(["Client", "Name", "Action", "Summary"], rows, input.output.mode.stdout, input.width).join("\n")}\n`,
  );
}

function readFields(action: string, fields: readonly string[]): Json {
  return Object.fromEntries(
    fields.map((field) => {
      const split = field.indexOf("=");

      if (split < 1) {
        throw new CliError("invalid_arguments", `Can't read ${field} as KEY=VALUE.`, {
          next: [{ label: "See how input is passed", argv: ["nyte", "action", "run", "--help"] }],
        });
      }

      return [field.slice(0, split), readValue(field.slice(split + 1))];
    }),
  );
}

function readValue(text: string): Json {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return text;
  }

  return isJson(value) ? value : text;
}

function chooseClient(
  clients: readonly ClientRow[],
  action: string,
  named: string | undefined,
): ClientRow {
  const offering = clients.filter((client) =>
    client.actions.some((offered) => offered.name === action),
  );

  if (named !== undefined) {
    const chosen = offering.find((client) => client.id === named);

    if (chosen !== undefined) return chosen;

    throw new CliError(
      "not_found",
      clients.some((client) => client.id === named)
        ? `Can't run ${action}: client ${named} doesn't offer it.`
        : `Couldn't find a connected client ${named}.`,
      { next: [SEE_ACTIONS] },
    );
  }

  const only = offering[0];

  if (only === undefined) {
    throw new CliError("not_found", `Couldn't find a connected client that offers ${action}.`, {
      next: [SEE_ACTIONS],
    });
  }

  if (offering.length === 1) return only;

  throw new CliError(
    "missing_input",
    `Can't run ${action} without --client: ${String(offering.length)} clients offer it.`,
    {
      details: [
        ...offering
          .slice(0, LISTED)
          .map((client) => ({ label: printable(client.name), value: client.id })),
        ...(offering.length > LISTED
          ? [{ label: "", value: `and ${String(offering.length - LISTED)} more` }]
          : []),
      ],
      next: [
        { label: "Name the client", argv: ["nyte", "action", "run", action, "--client", "<ID>"] },
      ],
    },
  );
}
