import type { HostSocket, SocketClosed } from "@nyte-ai/protocol";

interface Output {
  readonly write: (text: string) => void;
  readonly error: (text: string) => void;
}

const USAGE =
  "Usage: nyte events [--scope <scope>]... [--json] [--host-url <url>]. Run `nyte events --help`.";

export async function eventsCommand(input: {
  readonly args: readonly string[];
  readonly connect: (hostUrl: string | undefined) => Promise<HostSocket>;
  readonly signal: AbortSignal;
  readonly output: Output;
}): Promise<number> {
  const parsed = parseEventsArgs(input.args);
  const socket = await input.connect(parsed.hostUrl);

  socket.onEvent((event) => {
    input.output.write(
      `${JSON.stringify(Object.fromEntries(Object.entries(event).filter((entry) => entry[0] !== "c" && entry[0] !== "type")))}\n`,
    );
  });

  await socket.call("events.subscribe", { scopes: parsed.scopes });

  const ended = await Promise.race([
    socket.closed,
    new Promise<null>((stopped) => {
      if (input.signal.aborted) stopped(null);
      else input.signal.addEventListener("abort", () => stopped(null), { once: true });
    }),
  ]);

  if (ended === null) {
    socket.close();

    return 0;
  }

  input.output.error(closedMessage(ended));

  return 1;
}

function closedMessage(closed: SocketClosed): string {
  return closed.reason === ""
    ? `The host closed the socket (${closed.code}).`
    : `The host closed the socket (${closed.code}): ${closed.reason}`;
}

function parseEventsArgs(args: readonly string[]) {
  const scopes: string[] = [];
  let hostUrl: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if (arg === "--json") continue;

    if ((arg !== "--scope" && arg !== "--host-url") || value === undefined || value.startsWith("-"))
      throw new Error(
        arg === "--scope" || arg === "--host-url" ? `${arg} needs a value. ${USAGE}` : USAGE,
      );

    if (arg === "--scope") scopes.push(value);
    else hostUrl = value;
    index += 1;
  }

  return { scopes: scopes.length === 0 ? ["host"] : scopes, hostUrl };
}
