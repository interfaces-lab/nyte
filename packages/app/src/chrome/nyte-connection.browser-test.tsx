import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ConnectBridge, ConnectView } from "../bridge.ts";
import { keys } from "../queries.ts";
import { RemoteAccess } from "./server-settings.tsx";

declare global {
  interface Window {
    connectFixture: ConnectBridge;
  }
}

type Linked = Extract<ConnectView, { kind: "linked" }>;

const wait = (duration: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, duration));

const tray = () => document.querySelector<HTMLElement>('[data-slot="popover-popup"]') ?? undefined;

const confirmation = () => document.querySelector<HTMLElement>('[role="alertdialog"]') ?? undefined;

const trayText = () => tray()?.textContent ?? "";

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let elapsed = 0; elapsed < 3_000; elapsed += 20) {
    if (condition()) return;
    await wait(20);
  }

  throw new Error(`Timed out waiting for ${what}: ${document.body.textContent ?? ""}`);
}

function check(condition: boolean, failure: string): void {
  if (!condition) throw new Error(`${failure}\n${document.body.textContent ?? ""}`);
}

function button(label: string, scope: ParentNode | undefined): HTMLButtonElement | undefined {
  return [...(scope ?? document).querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

async function press(label: string, scope: () => ParentNode | undefined): Promise<void> {
  await until(() => {
    const target = button(label, scope());

    return target !== undefined && target.getAttribute("aria-disabled") === null;
  }, `${label} to be pressable`);
  button(label, scope())?.click();
}

const statusMenu = () =>
  [...document.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.startsWith("Nyte account:"),
  );

async function menuItem(label: string): Promise<void> {
  statusMenu()?.click();
  await until(
    () =>
      [...document.querySelectorAll('[role="menuitem"]')].some(
        (item) => item.textContent?.trim() === label,
      ),
    `the ${label} menu item`,
  );
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.trim() === label)
    ?.click();
}

const toggle = () => tray()?.querySelector<HTMLElement>('[role="switch"]') ?? undefined;

const OWNER = { id: "user_owner", label: "owner@example.test" };

function linked(patch: Partial<Linked>): Linked {
  return {
    kind: "linked",
    account: { kind: "signed_in", label: "someone-else@example.test" },
    owner: OWNER,
    environment: {
      id: "0b8c9f3e-5d7a-4c1b-9e2f-3a4b5c6d7e8f",
      name: "Studio Mac",
      address: "https://connect.example.test/r/0b8c9f3e-5d7a-4c1b-9e2f-3a4b5c6d7e8f",
    },
    enabled: false,
    connection: { kind: "stopped" },
    lease: { kind: "stopped" },
    devices: [],
    ...patch,
  };
}

export async function run() {
  let view: ConnectView = { kind: "unavailable", reason: "not_configured" };
  const calls: string[] = [];
  let finishLink: (() => void) | undefined;

  window.connectFixture = {
    state: async () => view,
    link: () => {
      calls.push("link");

      return new Promise<ConnectView>((resolve) => {
        finishLink = () => resolve(view);
      });
    },
    cancel: async () => {
      calls.push("cancel");
    },
    setEnabled: async ({ enabled }) => {
      calls.push(`setEnabled:${String(enabled)}`);

      if (view.kind === "linked") view = { ...view, enabled };

      return view;
    },
    unlink: async () => {
      calls.push("unlink");
    },
    revokeDevice: async ({ deviceId }) => {
      calls.push(`revoke:${deviceId}`);
    },
    openAccount: async () => {
      calls.push("openAccount");
    },
    signOut: async () => {
      calls.push("signOut");
    },
  };

  const client = new QueryClient();

  // What the shell does on `remote_access_changed`.
  const changed = async (next: ConnectView) => {
    view = next;
    await client.invalidateQueries({ queryKey: keys.remoteAccess });
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

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

    // A build without the account service shows no row.
    await until(() => container.textContent?.includes("Manual setup") === true, "the page");
    await wait(100);
    check(!container.textContent.includes("Nyte account"), "An unconfigured build showed the row");

    // Signed out: the tray signs in and links in one press.
    await changed({
      kind: "unlinked",
      account: { kind: "signed_out" },
      linking: { kind: "idle" },
      notice: { kind: "none" },
    });
    await until(() => button("Link This Mac…", container) !== undefined, "the link entry");
    await press("Link This Mac…", () => container);
    await until(() => trayText().includes("Reach this Mac from your iPhone"), "the tray");
    await press("Sign In and Link…", tray);
    await until(() => calls.includes("link"), "link() to be called");

    await changed({
      kind: "unlinked",
      account: { kind: "signed_out" },
      linking: { kind: "waiting_for_account" },
      notice: { kind: "none" },
    });
    await until(() => trayText().includes("Finish signing in."), "the sign-in step");
    await press("Cancel", tray);
    await until(() => calls.includes("cancel"), "cancel() to be called");

    await changed({
      kind: "unlinked",
      account: { kind: "signed_out" },
      linking: { kind: "failed", reason: "cancelled" },
      notice: { kind: "none" },
    });
    finishLink?.();
    await until(() => button("Sign In and Link…", tray()) !== undefined, "linking again");
    check(tray()?.querySelector('[role="alert"]') === null, "A chosen cancel read as a failure");

    // A real failure says what happened; signed in, the button only links.
    await changed({
      kind: "unlinked",
      account: { kind: "signed_in", label: "someone-else@example.test" },
      linking: { kind: "failed", reason: "network" },
      notice: { kind: "none" },
    });
    await until(() => trayText().includes("Couldn’t reach Nyte."), "the network failure");
    await press("Link This Mac", tray);
    await changed({
      kind: "unlinked",
      account: { kind: "signed_in", label: "someone-else@example.test" },
      linking: { kind: "linking" },
      notice: { kind: "none" },
    });
    await until(() => trayText().includes("Linking this Mac…"), "the linking step");

    // Linked, the tray stays for its last step: access starts off.
    await changed(linked({ connection: { kind: "connected" } }));
    finishLink?.();
    await until(() => trayText().includes("Studio Mac is linked"), "the linked step");
    check(trayText().includes("owner@example.test"), "The owner is missing");
    check(toggle()?.getAttribute("aria-checked") === "false", "Remote access began on");
    toggle()?.click();
    await until(() => calls.includes("setEnabled:true"), "setEnabled({ enabled: true })");
    await press("Done", tray);
    await until(() => statusMenu() !== undefined, "the linked row");

    // A connected relay without a current lease admits no device.
    const phone = { id: "phone-1", name: "iPhone", createdAt: 0, authorized: false };
    await changed(
      linked({
        enabled: true,
        connection: { kind: "connected" },
        lease: { kind: "pending" },
        devices: [phone],
      }),
    );
    await until(() => statusMenu()?.textContent?.includes("Verifying…") === true, "pending");
    check(!container.textContent.includes("Reachable"), "A pending lease read as reachable");

    await changed(
      linked({
        enabled: true,
        connection: { kind: "connected" },
        lease: { kind: "lapsed", reason: "offline" },
        devices: [phone],
      }),
    );
    await until(() => container.textContent.includes("devices are refused"), "the lapsed lease");
    check(!container.textContent.includes("Reachable"), "A lapsed lease read as reachable");

    // Another instance took the link over; only the user can take it back.
    await changed(
      linked({
        enabled: true,
        connection: { kind: "failed", reason: "replaced" },
        lease: { kind: "current", expiresAt: Date.now() + 60_000 },
        devices: [{ ...phone, authorized: true }],
      }),
    );
    await until(
      () => container.textContent.includes("Turn remote access off, then on again."),
      "replaced",
    );
    check(statusMenu()?.textContent?.includes("Not reachable") === true, "Replaced read as live");
    check(!/tunnel|cloudflare|\/r\//i.test(statusMenu()?.textContent ?? ""), "The relay leaked");

    await changed(
      linked({
        enabled: true,
        connection: { kind: "connected" },
        lease: { kind: "current", expiresAt: Date.now() + 60_000 },
        devices: [{ ...phone, authorized: true }],
      }),
    );
    await until(() => statusMenu()?.textContent?.includes("Reachable") === true, "a current lease");
    check(!container.textContent.includes("someone-else@example.test"), "The session leaked");

    await press("Revoke iPhone", () => container);
    await until(() => calls.includes("revoke:phone-1"), "revokeDevice() for the phone");

    await menuItem("Turn Off Remote Access");
    await until(() => calls.includes("setEnabled:false"), "setEnabled({ enabled: false })");

    // Unlinking asks first and names what happens.
    await menuItem("Unlink This Mac…");
    await until(() => confirmation() !== undefined, "the unlink confirmation");
    check(
      confirmation()?.textContent?.includes("lose access to this Mac right away") === true,
      "The confirmation hides the consequence",
    );
    await press("Cancel", confirmation);
    await until(() => confirmation() === undefined, "the confirmation to close");
    check(!calls.includes("unlink"), "Cancel unlinked this Mac");

    await menuItem("Unlink This Mac…");
    await until(() => confirmation() !== undefined, "the unlink confirmation again");
    await press("Unlink This Mac", confirmation);
    await until(() => calls.includes("unlink"), "unlink() to be called");
    check(!calls.includes("signOut") && !calls.includes("openAccount"), "The session moved");

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

    check(!/token|jwt|secret/i.test(cached), "Something credential-shaped reached the cache");

    return "passed";
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}
