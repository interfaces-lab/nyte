import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ConnectBridge, ConnectView } from "../bridge.ts";
import { keys } from "../queries.ts";
import { nyte } from "../nyte.ts";
import { ConnectButton } from "./connect-dialog.tsx";
import { RemoteAccess } from "./server-settings.tsx";

declare global {
  interface Window {
    connectFixture: ConnectBridge;
  }
}

type Linked = Extract<ConnectView, { kind: "linked" }>;

const wait = (duration: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, duration));

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]') ?? undefined;

const confirmation = () => document.querySelector<HTMLElement>('[role="alertdialog"]') ?? undefined;

const dialogText = () => dialog()?.textContent ?? "";

const chip = () =>
  [...document.querySelectorAll("button")].find((candidate) => {
    const label = candidate.textContent ?? "";

    return label.includes("Nyte account:") || label === "Link This Mac…";
  });

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

const compact = () =>
  document.querySelector<HTMLButtonElement>(
    'button[aria-label^="Nyte account:"], button[aria-label="Link This Mac…"]',
  ) ?? undefined;

const compactLabel = () => compact()?.getAttribute("aria-label");

const toggle = () => dialog()?.querySelector<HTMLElement>('[role="switch"]') ?? undefined;

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
            <ConnectButton connect={nyte.host.connect} active compact />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

    // A build without the account service says so and offers nothing to press.
    await until(() => chip()?.textContent?.includes("Unavailable") === true, "the chip");
    check(container.textContent?.includes("Manual setup") === true, "Manual options lost a label");
    chip()?.click();
    await until(() => dialogText().includes("isn’t set up for Nyte accounts"), "the reason");
    check(button("Sign In and Link…", dialog()) === undefined, "An unconfigured build linked");
    check(compact() === undefined, "The compact entry showed for a build without accounts");
    await press("Close", dialog);
    await until(() => dialog() === undefined, "the dialog to close");

    // Signed out: one press opens the sign-in dialog and links.
    await changed({
      kind: "unlinked",
      account: { kind: "signed_out" },
      linking: { kind: "idle" },
      notice: { kind: "none" },
    });
    await until(() => chip()?.textContent === "Link This Mac…", "the link call to action");
    await until(() => compactLabel() === "Link This Mac…", "the compact link entry");
    chip()?.click();
    await press("Sign In and Link…", dialog);
    await until(() => calls.includes("link"), "link() to be called");

    await changed({
      kind: "unlinked",
      account: { kind: "signed_out" },
      linking: { kind: "waiting_for_account" },
      notice: { kind: "none" },
    });
    await until(() => dialogText().includes("Waiting for sign-in…"), "waiting");
    check(chip()?.textContent?.includes("Linking…") === true, "The chip hid a link in progress");
    check(compactLabel() === "Nyte account: Linking…", "The compact entry hid the link");
    await press("Sign In", dialog);
    await until(() => calls.includes("openAccount"), "openAccount() while waiting");
    await press("Cancel", dialog);
    await until(() => calls.includes("cancel"), "cancel() to be called");

    await changed({
      kind: "unlinked",
      account: { kind: "signed_out" },
      linking: { kind: "failed", reason: "cancelled" },
      notice: { kind: "none" },
    });
    finishLink?.();
    await until(() => button("Sign In and Link…", dialog()) !== undefined, "linking again");
    check(dialog()?.querySelector('[role="alert"]') === null, "A chosen cancel read as a failure");

    // A real failure says what happened; a signed-in account is the one that links.
    await changed({
      kind: "unlinked",
      account: { kind: "signed_in", label: "someone-else@example.test" },
      linking: { kind: "failed", reason: "network" },
      notice: { kind: "none" },
    });
    await until(() => dialogText().includes("Couldn’t reach Nyte."), "the network failure");
    check(
      dialogText().includes("This Mac links to this account."),
      "The linking account is unclear",
    );
    await press("Link This Mac", dialog);
    await changed({
      kind: "unlinked",
      account: { kind: "signed_in", label: "someone-else@example.test" },
      linking: { kind: "linking" },
      notice: { kind: "none" },
    });
    await until(() => dialogText().includes("Linking this Mac…"), "the linking status");

    // Linked to an owner other than the signed-in account, and off by default.
    await changed(linked({ connection: { kind: "connected" } }));
    finishLink?.();
    await until(() => dialogText().includes("This Mac is linked as Studio Mac."), "the link");
    check(dialogText().includes("owner@example.test"), "The owner is missing");
    check(dialogText().includes("someone-else@example.test"), "The signed-in account is missing");
    check(toggle()?.getAttribute("aria-checked") === "false", "Remote access began on");
    check(chip()?.textContent?.includes("Off") === true, "The chip hides that access is off");

    toggle()?.click();
    await until(() => calls.includes("setEnabled:true"), "setEnabled({ enabled: true })");
    await until(() => toggle()?.getAttribute("aria-checked") === "true", "the toggle to stay on");

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
    await until(() => dialogText().includes("Verifying…"), "the pending lease");
    check(!/Reachable|Connected/.test(dialogText()), "A pending lease read as reachable");
    check(chip()?.textContent?.includes("Verifying…") === true, "The chip overstated access");
    check(compactLabel() === "Nyte account: Verifying…", "The compact entry overstated access");

    await changed(
      linked({
        enabled: true,
        connection: { kind: "connected" },
        lease: { kind: "lapsed", reason: "offline" },
        devices: [phone],
      }),
    );
    await until(() => dialogText().includes("devices are refused"), "the lapsed lease");
    check(!dialogText().includes("Reachable"), "A lapsed lease read as reachable");

    // Another instance took the link over; only the user can take it back.
    await changed(
      linked({
        enabled: true,
        connection: { kind: "failed", reason: "replaced" },
        lease: { kind: "current", expiresAt: Date.now() + 60_000 },
        devices: [{ ...phone, authorized: true }],
      }),
    );
    await until(() => dialogText().includes("Turn remote access off, then on again."), "replaced");
    check(chip()?.textContent?.includes("Not reachable") === true, "A replaced link read as live");
    check(!/tunnel|cloudflare|\/r\//i.test(dialogText()), "The relay leaked into the dialog");

    await changed(
      linked({
        enabled: true,
        connection: { kind: "connected" },
        lease: { kind: "current", expiresAt: Date.now() + 60_000 },
        devices: [{ ...phone, authorized: true }],
      }),
    );
    await until(() => chip()?.textContent?.includes("Reachable") === true, "a current lease");
    check(compactLabel() === "Nyte account: Reachable", "The compact entry missed the lease");

    // The compact entry opens the same dialog.
    await press("Done", dialog);
    await until(() => dialog() === undefined, "the chip's dialog to close");
    compact()?.click();
    await until(() => button("Revoke iPhone", dialog()) !== undefined, "the compact dialog");

    await press("Revoke iPhone", dialog);
    await until(() => calls.includes("revoke:phone-1"), "revokeDevice() for the phone");

    // Signing out leaves the link alone; the dialog can sign in again.
    check(button("Manage Account…", dialog()) === undefined, "Offered account management");
    await press("Sign Out", dialog);
    await until(() => calls.includes("signOut"), "signOut() to be called");
    check(!calls.includes("unlink"), "Signing out unlinked this Mac");
    await changed(
      linked({
        account: { kind: "signed_out" },
        enabled: true,
        connection: { kind: "connected" },
        lease: { kind: "current", expiresAt: Date.now() + 60_000 },
        devices: [{ ...phone, authorized: true }],
      }),
    );
    await until(() => dialogText().includes("Not signed in"), "the signed-out account");
    check(dialogText().includes("Reachable"), "Signing out turned remote access off");
    await press("Sign In…", dialog);
    await until(
      () => calls.filter((call) => call === "openAccount").length === 2,
      "openAccount() to sign in",
    );

    // Unlinking asks first and names what happens.
    await press("Unlink This Mac…", dialog);
    await until(() => confirmation() !== undefined, "the unlink confirmation");
    check(
      confirmation()?.textContent?.includes("lose access to this Mac right away") === true,
      "The confirmation hides the consequence",
    );
    await press("Cancel", confirmation);
    await until(() => confirmation() === undefined, "the confirmation to close");
    check(!calls.includes("unlink"), "Cancel unlinked this Mac");

    await press("Unlink This Mac…", dialog);
    await until(() => confirmation() !== undefined, "the unlink confirmation again");
    await press("Unlink This Mac", confirmation);
    await until(() => calls.includes("unlink"), "unlink() to be called");

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
