import assert from "node:assert/strict";
import { afterEach, vi } from "vitest";
import { socketTest } from "../fixtures/desktop-host.ts";
import { cleanUp, fixture, desktop, view } from "../fixtures/connect-machine.ts";

afterEach(cleanUp);

socketTest(
  "showing the sign-in dialog while a link waits on it does not replace that request",
  async () => {
    const setup = await fixture();
    const { host } = await desktop(setup);
    setup.account.hold = true;
    const waiting = host.call(1, "host.connect.link", undefined);
    await vi.waitFor(() => assert.equal(setup.account.requests, 1));

    await host.call(1, "host.connect.openAccount", undefined);
    assert.equal(setup.account.focused, 1);
    assert.equal(setup.account.requests, 1);
    const current = await view(host);
    assert.ok(current.kind === "unlinked" && current.linking.kind === "waiting_for_account");

    await host.call(1, "host.connect.cancel", undefined);
    assert.equal((await waiting).kind, "unlinked");
  },
);
