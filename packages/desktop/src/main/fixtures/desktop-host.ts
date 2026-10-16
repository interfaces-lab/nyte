import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeModels } from "@nyte-ai/host/bench";
import type { FakeModels } from "@nyte-ai/host/bench";
import type { HostEvent } from "@nyte-ai/app/bridge.ts";
import type { BrowserAgent } from "../browser-agent.ts";
import { unusedBrowserAgent } from "../browser-stub.ts";
import { DesktopHost } from "../host.ts";
import type { DesktopHostDependencies } from "../host.ts";

export interface TestDesktop {
  readonly host: DesktopHost;
  readonly home: string;
  readonly fake: FakeModels;
  readonly events: HostEvent[];
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
    models: fake.models,
    rendererOrigin: "nyte://app",
    emitHostEvent: (event) => events.push(event),
    openExternal: () => undefined,
    revealPath: () => undefined,
    showContextMenu: () => Promise.resolve(undefined),
    confirmExternal: () => Promise.resolve("cancel"),
    pickFolder: async () => undefined,
    listFonts: async () => ({ sans: [], monospace: [] }),
    browser: {
      menu: async () => undefined,
      perform: async () => undefined,
      open: () => {
        throw new Error("Browser panels are not used in this test");
      },
      navigate: () => undefined,
      close: () => undefined,
      captureFrame: () => Promise.resolve(undefined),
      find: () => Promise.resolve({ active: 0, total: 0 }),
      cancelDownload: () => undefined,
      login: () => undefined,
      history: async () => [],
      forgetHistory: async () => undefined,
      focusPage: () => undefined,
      settingsChanged: () => undefined,
      setBounds: () => undefined,
      retain: () => undefined,
      release: () => undefined,
      warm: async () => undefined,
      releaseWindow: () => undefined,
      agent: agent ?? unusedBrowserAgent(),
    },
    ...dependencies,
  });

  const [model] = fake.provider.getModels();

  if (model !== undefined)
    await (await host.host()).models.setDefault({ provider: fake.provider.id, id: model.id });

  return {
    host,
    home,
    fake,
    events,
    close: async () => {
      await host.close();

      if (dependencies.home === undefined) await rm(home, { recursive: true, force: true });
    },
  };
}
