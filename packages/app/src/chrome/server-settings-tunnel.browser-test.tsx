import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type {
  RemoteAccessState,
  RemoteDevice,
  RemotePairing,
  TunnelConnection,
} from "../bridge.ts";
import { keys } from "../queries.ts";
import { RemoteAccess } from "./server-settings.tsx";

declare global {
  interface Window {
    tunnelFixture: {
      state(): Promise<RemoteAccessState>;
      pair(input: { readonly name: string }): Promise<RemotePairing>;
    };
  }
}

const ADDRESS = "https://nyte.example.test";

const wait = (duration: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, duration));

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let elapsed = 0; elapsed < 3_000; elapsed += 20) {
    if (condition()) return;
    await wait(20);
  }

  throw new Error(`Timed out waiting for ${what}`);
}

const code = () => document.querySelector('[aria-label="Pairing code for the Nyte iOS app"]');

const nameField = () => document.querySelector<HTMLInputElement>('input[aria-label="Device name"]');

function pending(id: string): RemoteDevice {
  return {
    id,
    name: "Phone",
    createdAt: 0,
    state: { kind: "pending", expiresAt: Date.now() + 60_000 },
  };
}

export async function run() {
  let devices: readonly RemoteDevice[] = [];
  let connection: TunnelConnection = { kind: "connecting" };
  let expiresIn = 600_000;
  let made = 0;

  window.tunnelFixture = {
    state: async () => ({
      kind: "serving",
      reach: "cloudflare",
      address: ADDRESS,
      target: { kind: "home" },
      cloudflare: {
        kind: "configured",
        hostname: "nyte.example.test",
        port: 5182,
        cloudflaredInstalled: true,
        connection,
        devices,
      },
    }),
    pair: async () => {
      made += 1;

      return {
        deviceId: `device-${String(made)}`,
        address: ADDRESS,
        token: `secret-token-${String(made)}`,
        expiresAt: Date.now() + expiresIn,
      };
    },
  };

  const client = new QueryClient();
  const refresh = () => client.refetchQueries({ queryKey: keys.remoteAccess });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  async function addDevice(): Promise<void> {
    const field = nameField();

    if (field === null) throw new Error("No device name field");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, "Phone");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await until(() => field.value === "Phone", "the typed name");
    const submit = field.form?.querySelector<HTMLButtonElement>('button[type="submit"]');

    if (submit === null || submit === undefined) throw new Error("No Add Device button");
    await until(() => !submit.disabled, "Add Device to enable");
    submit.click();
    await until(() => code() !== null, "the pairing code");
  }

  try {
    flushSync(() =>
      root.render(
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <RemoteAccess active />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

    await until(
      () =>
        container.textContent?.includes("Devices can be added once the tunnel connects.") === true,
      "the connecting note",
    );

    if (nameField() !== null) throw new Error("Add Device showed before the tunnel connected");

    connection = { kind: "connected", connections: 1 };
    await refresh();
    await until(() => nameField() !== null, "Add Device once connected");

    // The list has not caught up with the new device: the code must stay.
    await addDevice();
    await wait(100);
    await refresh();
    await wait(50);

    if (code() === null) throw new Error("A stale device list dropped the new code");

    if (!container.textContent?.includes("Anyone with this code can connect as Phone"))
      throw new Error("The code's note does not say what it grants");

    if (container.textContent.includes("once")) throw new Error("The note implies a one-use code");

    devices = [pending("device-1")];
    await refresh();
    await wait(50);

    if (code() === null) throw new Error("The code left while its device was still waiting");

    devices = [{ ...pending("device-1"), state: { kind: "paired", pairedAt: 1 } }];
    await refresh();
    await until(() => code() === null, "a claimed code to leave");
    await until(() => nameField() !== null, "Add Device after a claim");

    // Listed, then gone because it was removed elsewhere.
    await addDevice();
    devices = [devices[0] ?? pending("device-1"), pending("device-2")];
    await refresh();
    await wait(50);
    devices = devices.filter((device) => device.id !== "device-2");
    await refresh();
    await until(() => code() === null, "a removed code to leave");

    // Never listed, but its time ran out.
    expiresIn = 200;
    await addDevice();
    await until(() => code() === null, "an expired code to leave");

    const cached = JSON.stringify([
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => [mutation.state.data, mutation.state.variables]),
    ]);

    if (cached.includes("secret-token")) throw new Error("A device token reached the query cache");

    return "passed";
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}
