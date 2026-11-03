import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeModels } from "@nyte-ai/bench";
import type { FakeModels } from "@nyte-ai/bench";
import type { HostEvent } from "@nyte-ai/app/contract/bridge.ts";
import type { Authority } from "@nyte-ai/schema";
import { TOKEN } from "@nyte-ai/core/server";
import { desktopSettingsPlugin } from "@nyte-ai/plugin/core/desktop-settings";
import { sdk } from "@nyte-ai/sdk";
import type { Connection, CredentialSource, Host, Listener } from "@nyte-ai/sdk";
import { HOST_PORT_ORIGIN, messagePortEnd, portFetch, servePort } from "../../shared/host-port.ts";
import { DesktopHost } from "../desktop-host.ts";
import type { DesktopHostDependencies } from "../desktop-host.ts";

export interface TestDesktop {
  readonly host: DesktopHost;
  readonly served: Host;
  readonly home: string;
  readonly fake: FakeModels;
  readonly events: HostEvent[];
  connect(credentials?: CredentialSource): Promise<Connection>;
  close(): Promise<void>;
}

export async function testDesktop(
  overrides: Partial<DesktopHostDependencies> = {},
): Promise<TestDesktop> {
  const home = overrides.home ?? (await realpath(await mkdtemp(join(tmpdir(), "nyte-desktop-"))));
  const fake = fakeModels();
  const events: HostEvent[] = [];
  const served = await sdk.open({ home, models: fake.models, plugins: [desktopSettingsPlugin] });
  const authority = new Set<Authority>(["participant", "owner", "maintenance"]);

  const listener: Listener = await served.listen({
    transport: { kind: "fetch" },
    auth: { kind: "custom", authorize: () => ({ principal: TOKEN, authority }) },
  });

  const [model] = fake.provider.getModels();

  if (model !== undefined)
    await served.models.setDefault({ provider: fake.provider.id, id: model.id });

  const host = new DesktopHost({
    home,
    open: () =>
      sdk.connect({
        url: HOST_PORT_ORIGIN,
        credentials: { kind: "custom", headers: () => ({}) },
        fetch: (url, init) => listener.fetch(new Request(url, init)),
      }),
    emitHostEvent: (event) => events.push(event),
    ...overrides,
  });

  const ports: MessagePort[] = [];

  return {
    host,
    served,
    home,
    fake,
    events,
    async connect(credentials) {
      const endpoint = await host.call(1, "host.endpoint", undefined);

      return sdk.connect({
        ...endpoint,
        credentials: credentials ?? endpoint.credentials,
        fetch: portFetch(async () => {
          const { port1, port2 } = new MessageChannel();
          ports.push(port1, port2);
          servePort(messagePortEnd(port1), (request) => listener.fetch(request));

          return messagePortEnd(port2);
        }),
      });
    },
    close: async () => {
      for (const port of ports) port.close();
      await host.close();
      await listener.close();
      await served.close();

      if (overrides.home === undefined) await rm(home, { recursive: true, force: true });
    },
  };
}
