import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createTestRenderer } from "@opentui/core/testing";
import type { TestRendererSetup } from "@opentui/core/testing";
import type { Kit } from "../../src/app/context.tsx";
import { mountApp } from "../../src/app/main.tsx";
import type { MountedApp } from "../../src/app/main.tsx";
import type { Store } from "../../src/app/store.ts";
import { openCrashLog } from "../../src/effects/crash.ts";
import { hostPort } from "../../src/effects/host-port.ts";
import { systemClock } from "../../src/effects/local-ports.ts";
import type { Ports } from "../../src/effects/ports.ts";
import { until } from "../fixture/host.ts";
import type { TestHost } from "../fixture/host.ts";
import { fakeHost, fakePorts } from "../fixture/ports.ts";
import type { FakeTerminal } from "../fixture/ports.ts";

process.env["NYTE_SKIP_VERSION_CHECK"] = "1";

export interface AppHarness extends TestRendererSetup {
  readonly app: MountedApp;
  readonly store: Store;
  readonly fixture: TestHost;
  readonly terminal: FakeTerminal;
  readonly home: string;
  ready(): Promise<void>;
  frame(predicate: (frame: string) => boolean, timeout?: number): Promise<string>;
  state(predicate: (store: Store) => boolean, timeout?: number): Promise<void>;
}

export async function startApp(
  fixture: TestHost,
  options?: {
    readonly size?: { readonly width: number; readonly height: number };
    readonly kit?: (kit: Kit) => Kit;
  },
): Promise<AppHarness> {
  const setup = await createTestRenderer({
    width: options?.size?.width ?? 100,
    height: options?.size?.height ?? 32,
    kittyKeyboard: true,
  });

  const home = mkdtempSync(join(tmpdir(), "nyte-tui-app-"));

  const fakes = fakePorts(fakeHost());

  const ports: Ports = {
    ...fakes,
    host: hostPort(fixture.host, null),
    clock: systemClock,
    log: openCrashLog(home),
  };

  const app = await mountApp({
    renderer: setup.renderer,
    ports,
    cwd: home,
    drawPart: () => null,
    ...(options?.kit === undefined ? {} : { kit: options.kit }),
  });

  app.boot({ home, cwd: home, target: { kind: "new" }, model: null, effort: null });

  const frame = async (predicate: (frame: string) => boolean, timeout = 3_000) => {
    let last = "";

    try {
      return await until(async () => {
        await setup.renderOnce();
        last = setup.captureCharFrame();

        return predicate(last) ? last : undefined;
      }, timeout);
    } catch {
      throw new Error(`The screen never matched. Last frame:\n${last}`);
    }
  };

  const state = async (predicate: (store: Store) => boolean, timeout = 3_000) => {
    await until(async () => {
      await setup.renderOnce();

      return predicate(app.store) ? true : undefined;
    }, timeout);
  };

  const dispose = async (): Promise<void> => {
    await app.close();
    await setup.dispose();
    rmSync(home, { recursive: true, force: true });
  };

  return {
    ...setup,
    app,
    store: app.store,
    fixture,
    terminal: fakes.terminal,
    home,
    async ready() {
      await state(
        (store) => store.state().facts.phase.kind === "ready" && store.screen().blocked === null,
      );
      await setup.renderOnce();
    },
    frame,
    state,
    dispose,
    [Symbol.asyncDispose]: dispose,
  };
}
