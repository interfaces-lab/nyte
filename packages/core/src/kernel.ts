import { asSeq } from "@nyte-ai/schema";
import type { Activation, HostDescription, HostId, Revision, SessionId } from "@nyte-ai/schema";
import { createBus } from "./bus.ts";
import type { SessionBus } from "./bus.ts";
import type { HostState } from "./host-view.ts";
import type { StoreConnection } from "./store.ts";
import { createFoldCache } from "./watch.ts";
import type { FoldCache } from "./watch.ts";

/** Returns the in-process context every kernel operation closes over; later work orders add fields, none are removed. */
export interface Kernel {
  /** The host this kernel runs as. */
  readonly hostId: HostId;
  /** The open store. */
  readonly store: StoreConnection;
  /** Name, platform and version, as `HostView` carries them. */
  readonly description: HostDescription;
  /** Every session's live events, durable and transient. */
  readonly bus: SessionBus;
  /** The host-level fields `watchHost` yields. */
  readonly host: HostState;
  /** One shared fold per session per principal. */
  readonly folds: FoldCache;
  /** Each ref's latest revision as `publishSet` recorded it, by ref name; `project` stamps `SessionView.revision` from the head ref's. */
  readonly revisions: Map<string, Revision>;
  /** Returns whether this host serves a session's workspace; in memory, default `{ kind: "inactive" }`. */
  activation(session: SessionId): Activation;
  /** Sets a session's activation in memory and publishes an `activation` event to it. */
  setActivation(session: SessionId, activation: Activation): void;
}

/** Returns a kernel over an open store, with a fresh bus, fold cache and activation table. */
export function createKernel(input: {
  readonly hostId: HostId;
  readonly store: StoreConnection;
  readonly description: HostDescription;
  readonly host: HostState;
}): Kernel {
  const bus = createBus();
  const revisions = new Map<string, Revision>();
  const activations = new Map<SessionId, Activation>();
  const inactive: Activation = { kind: "inactive" };
  const activation = (session: SessionId): Activation => activations.get(session) ?? inactive;

  return {
    hostId: input.hostId,
    store: input.store,
    description: input.description,
    bus,
    host: input.host,
    folds: createFoldCache({ store: input.store, bus, revisions, activation }),
    revisions,
    activation,
    setActivation(session, value) {
      activations.set(session, value);
      bus.publish(session, {
        seq: asSeq(0),
        at: Date.now(),
        head: null,
        kind: "activation",
        activation: value,
      });
    },
  };
}
