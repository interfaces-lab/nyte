import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeModels } from "@nyte-ai/bench";
import type { FakeModels } from "@nyte-ai/bench";
import type { HostEvent } from "@nyte-ai/app/bridge.ts";
import { sdk } from "@nyte-ai/sdk";
import type { Connection, CredentialSource } from "@nyte-ai/sdk";
import { messagePortEnd, portFetch, servePort } from "../../shared/host-port.ts";
import type { BrowserAgent } from "../browser-agent.ts";
import { unusedBrowserAgent } from "../browser-stub.ts";
import { DesktopHost } from "../host.ts";
import type { DesktopHostDependencies } from "../host.ts";

export interface TestDesktop {
  readonly host: DesktopHost;
  readonly home: string;
  readonly fake: FakeModels;
  readonly events: HostEvent[];
  /** Connects as a window does, over a MessagePort the host serves; `credentials` replaces the endpoint's token. */
  connect(credentials?: CredentialSource): Promise<Connection>;
  close(): Promise<void>;
}

export async function testDesktop(
  overrides: Partial<DesktopHostDependencies> & { readonly agent?: BrowserAgent } = {},
): Promise<TestDesktop> {
  const { agent, ...dependencies } = overrides;
  const home =
    dependencies.home ?? (await realpath(await mkdtemp(join(tmpdir(), "nyte-desktop-"))));
  const fake = fakeModels();
  const events: HostEvent[] = [];

  const host = new DesktopHost({
    home,
    version: "0.0.0-test",
    models: fake.models,
    emitHostEvent: (event) => events.push(event),
    agent: agent ?? unusedBrowserAgent(),
    ...dependencies,
  });

  const [model] = fake.provider.getModels();

  if (model !== undefined)
    await (await host.host()).models.setDefault({ provider: fake.provider.id, id: model.id });

  const ports: MessagePort[] = [];

  return {
    host,
    home,
    fake,
    events,
    async connect(credentials) {
      const endpoint = await host.call(1, "host.endpoint", undefined);

      return sdk.connect({
        ...endpoint,
        ...(credentials === undefined ? {} : { credentials }),
        fetch: portFetch(async () => {
          const { port1, port2 } = new MessageChannel();
          ports.push(port1, port2);
          servePort(messagePortEnd(port1), (request) => host.fetch(request));

          return messagePortEnd(port2);
        }),
      });
    },
    close: async () => {
      for (const port of ports) port.close();
      await host.close();

      if (dependencies.home === undefined) await rm(home, { recursive: true, force: true });
    },
  };
}
