import { ConnectViewSchema } from "@nyte-ai/connect";
import type { ConnectView } from "@nyte-ai/connect";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { SERVICE_ROUTES, ServiceEventSchema } from "./routes.ts";
import type { ServiceEvent } from "./routes.ts";

export interface LocalEndpoint {
  readonly url: string;
  readonly token: string;
}

export interface ServiceConnect {
  view(): Promise<ConnectView>;
  watch(signal: AbortSignal): AsyncIterable<ServiceEvent>;
  share(signal: AbortSignal): AsyncIterable<ServiceEvent>;
  unlink(): Promise<ConnectView>;
}

export function serviceConnect(endpoint: LocalEndpoint): ServiceConnect {
  const headers = { Authorization: `Bearer ${endpoint.token}` };
  const url = (path: string): URL => new URL(path, endpoint.url);

  const readView = async (response: Response): Promise<ConnectView> => {
    if (!response.ok) throw await refusal(response);

    return Value.Parse(ConnectViewSchema, await response.json());
  };

  return {
    view: async () => readView(await fetch(url(SERVICE_ROUTES.connect), { headers })),
    watch: (signal) => events(url(SERVICE_ROUTES.watch), headers, signal),
    share: (signal) => events(url(SERVICE_ROUTES.share), headers, signal),
    unlink: async () =>
      readView(await fetch(url(SERVICE_ROUTES.unlink), { method: "POST", headers })),
  };
}

async function* events(
  url: URL,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
): AsyncIterable<ServiceEvent> {
  const response = await fetch(url, { headers, signal });

  if (!response.ok || response.body === null) throw await refusal(response);
  const decoder = new TextDecoder();
  let buffered = "";

  try {
    for await (const chunk of response.body) {
      const lines = `${buffered}${decoder.decode(chunk, { stream: true })}`.split("\n");
      buffered = lines.pop() ?? "";

      for (const line of lines)
        if (line !== "") yield Value.Parse(ServiceEventSchema, JSON.parse(line));
    }
  } catch (cause) {
    if (signal.aborted) return;

    throw cause;
  }
}

const RefusalSchema = Type.Object({ message: Type.String() });

async function refusal(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);

  return new Error(
    Value.Check(RefusalSchema, body)
      ? body.message
      : `The Nyte host answered ${String(response.status)}.`,
  );
}
