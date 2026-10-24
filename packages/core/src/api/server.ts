import type { Kernel } from "../contract/kernel.ts";
import type { ServerHost } from "../contract/server.ts";
import { driveInProcess } from "../drive/execution.ts";
import { applyBatch, heldReceipt } from "../engine/batches.ts";
import { leaseHold, releaseHold } from "../engine/holds.ts";
import { move } from "../engine/move.ts";
import { authenticateToken, redeemPairing } from "../engine/principals.ts";
import { sendReceipt } from "../engine/receipts.ts";
import { hostPrincipalsRef } from "../store/refs.ts";

/** Returns the {@link ServerHost} port over a composed kernel. */
export function createServerHost(kernel: Kernel): ServerHost {
  return {
    hostId: kernel.hostId,
    execution: kernel.execution,
    connect: (context) => kernel.handles.connection(context),
    connections: kernel.connections,
    authenticate: (token) => authenticateToken(kernel.store, token),
    redeem: (code) => redeemPairing(kernel, code),
    principalsRevision: async () =>
      (await kernel.store.refs.get(hostPrincipalsRef()))?.revision ?? null,
    onExternalCommit(listener) {
      kernel.externalCommits.add(listener);

      return () => {
        kernel.externalCommits.delete(listener);
      };
    },
    drive: (coverage) => driveInProcess(kernel, coverage),
    tick: (now) => kernel.waits.tick(now),
    onWake: (listener) => kernel.wakes.subscribe(listener),
    report: (row) => kernel.host.report(row),
    pluginRows: () => kernel.host.current().plugins,
    loaded: (plugin) => kernel.plugins.host.includes(plugin),
    wire: {
      move: (session, head, position, options) => move(kernel, session, head, position, options),
      hold: (session, head, message) => leaseHold(kernel, session, head, message),
      release: (session, head, message) => releaseHold(kernel, session, head, message),
      batch: (workspace, files, entries, id) =>
        applyBatch(kernel, { workspace }, files, entries, { id }),
      batchReceipt: (id) => heldReceipt(kernel, id),
      sendReceipt: (session, id) => sendReceipt(kernel, session, id),
      page: (id) => kernel.pages.page(id),
      holders: (id) => kernel.pages.holders(id),
      openPage: (request) => kernel.pages.open(request),
      job: (id) => kernel.jobs.get(id)?.view,
      async partDefinition(session, kind) {
        await kernel.plugins.runtime(session).ready;

        return kernel.partDefinitions.get(kind)?.definition;
      },
    },
  };
}
