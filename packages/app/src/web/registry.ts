/**
 * A registry host as this browser controls it. The host exposes folders by
 * opaque id and starts roots durably by request id; which folder this
 * browser is working in is this browser's own state, kept per host identity
 * and principal, never a cursor on the host that another client could move.
 * Trust is the host owner's consent to a folder as it is right now: the id,
 * canonical path and directory identity the owner saw are echoed back.
 */
import { NyteWireError } from "@nyte-ai/client";
import type { NyteClient } from "@nyte-ai/client";
import type {
  RegisteredWorkspace,
  StartInput,
  StartReceipt,
  WorkspaceInfo,
  WorkspaceSelection,
} from "@nyte-ai/protocol";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type {
  HostState,
  OpenWorkspaceOutcome,
  RootStartOutcome,
  RootStarts,
  TrustConsent,
} from "../bridge.ts";
import { errorMessage } from "../errors.ts";
import type { StartJournal } from "./start-journal.ts";

/** Who this browser is to the host: its identity, and the principal the host named this browser. */
export interface HostBinding {
  readonly hostId: string;
  readonly principal: string;
}

const Selected = Type.Object(
  { id: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

type Selected = Static<typeof Selected>;

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** What scoping a listing needs of it: each item's folder. */
interface SessionsPage {
  readonly items: readonly { readonly workspace: { readonly cwd: string } }[];
}

function selectionKey(binding: HostBinding): string {
  return `nyte:workspace:${binding.hostId}:${binding.principal}`;
}

export function readSelection(
  storage: SessionStorageLike,
  binding: HostBinding,
): Selected | undefined {
  try {
    const text = storage.getItem(selectionKey(binding));
    const value: unknown = text === null ? undefined : JSON.parse(text);

    return Value.Check(Selected, value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function workspaceInfo(row: RegisteredWorkspace): WorkspaceInfo {
  return {
    path: row.path,
    name: row.name,
    lastOpenedAt: row.registeredAt,
    available: row.trust.kind !== "unavailable",
  };
}

/**
 * The outcome of selecting a registered row. A folder the host will not serve
 * until it is trusted is not selected yet: the owner is asked with what was
 * shown, and the grant selects it.
 */
function opened(row: RegisteredWorkspace, hostId: string): OpenWorkspaceOutcome {
  switch (row.trust.kind) {
    case "none":
    case "changed":
      return {
        kind: "needs_trust",
        path: row.path,
        consent: { hostId, id: row.id, path: row.path, identity: row.identity },
      };
    case "unavailable":
      return { kind: "failed", message: `${row.path} is not available on the host right now.` };
    case "granted":
    case "policy":
      return { kind: "opened", workspace: workspaceInfo(row), needsTrust: false };
    default: {
      const _exhaustive: never = row.trust;

      return _exhaustive;
    }
  }
}

function refused(receipt: Extract<StartReceipt, { kind: "refused" }>): string {
  switch (receipt.reason) {
    case "workspace_unknown":
      return "This folder is no longer registered on the host.";
    case "workspace_untrusted":
      return "Trust this folder on the host before starting a chat in it.";
    case "workspace_unavailable":
      return "This folder is not available on the host right now.";
    case "model_unknown":
      return "The host does not offer the selected model.";
    case "deleted":
      return "This chat was deleted.";
    default: {
      const _exhaustive: never = receipt.reason;

      return _exhaustive;
    }
  }
}

/** A host refuses folder administration to anyone but an owner; say how to become one. */
function administrationRefused(cause: unknown): string {
  return cause instanceof NyteWireError && cause.code === "forbidden"
    ? "Only an admin can add or trust folders on this host. Restart it with `nyte serve --account --device-admin`, then connect this browser as an admin."
    : errorMessage(cause);
}

export interface RegistryController {
  readonly binding: HostBinding;
  /** The selected folder's id as this browser last chose it; no host round trip. */
  selectedId(): string | undefined;
  state(): Promise<HostState>;
  list(): Promise<readonly WorkspaceInfo[]>;
  /** Register (an owner) or find (anyone) the folder at `path` on the host, then select it here. */
  open(input: { readonly path: string }): Promise<OpenWorkspaceOutcome>;
  /** The owner's consent to the folder exactly as it was shown; without that snapshot nothing is granted. */
  trust(input: {
    readonly path: string;
    readonly consent?: TrustConsent;
  }): Promise<OpenWorkspaceOutcome>;
  /** Remove the folder from the host's registry (an owner); a folder with live work stays. */
  forget(input: { readonly path: string }): Promise<void>;
  close(): void;
  selection(): Promise<WorkspaceSelection>;
  /** The selected folder's roots; nothing while no folder is selected. */
  sessions<P extends SessionsPage>(page: P): Promise<P>;
  readonly starts: RootStarts;
  /** Ask again about every unanswered start on record for this binding, under its own request id. */
  replay(): Promise<void>;
}

export function createRegistryController(dependencies: {
  readonly client: Pick<NyteClient, "environment">;
  readonly binding: HostBinding;
  readonly storage: SessionStorageLike;
  readonly journal: StartJournal;
  readonly platform: NodeJS.Platform;
  readonly emit: (
    event:
      | { readonly kind: "workspace_opened"; readonly workspace: WorkspaceInfo }
      | { readonly kind: "workspace_closed" }
      | { readonly kind: "starts_changed" },
  ) => void;
}): RegistryController {
  const { client, binding, storage, journal } = dependencies;
  const key = selectionKey(binding);

  const rows = (): Promise<readonly RegisteredWorkspace[]> =>
    client.environment("environment.workspaces.list", undefined);

  const selectedRow = async (): Promise<RegisteredWorkspace | undefined> => {
    const selected = readSelection(storage, binding);

    if (selected === undefined) return undefined;
    const row = (await rows()).find((candidate) => candidate.id === selected.id);

    // Gone from the registry, or no longer served until trusted again: opening it asks for consent.
    if (row === undefined || row.trust.kind === "none" || row.trust.kind === "changed") {
      storage.removeItem(key);

      return undefined;
    }

    return row;
  };

  const select = (row: RegisteredWorkspace): OpenWorkspaceOutcome => {
    const outcome = opened(row, binding.hostId);

    if (outcome.kind !== "opened") return outcome;
    const selected: Selected = { id: row.id };
    storage.setItem(key, JSON.stringify(selected));
    dependencies.emit({ kind: "workspace_opened", workspace: outcome.workspace });

    return outcome;
  };

  /** Request ids being asked about now; their records are not the renderer's to act on yet. */
  const asking = new Set<string>();

  const ask = async (request: StartInput): Promise<StartReceipt> => {
    asking.add(request.requestId);

    try {
      return await client.environment("environment.start", request);
    } finally {
      asking.delete(request.requestId);
    }
  };

  /** Ask about a recorded start nobody is waiting on; an answer goes on its record. */
  const askAgain = async (request: StartInput): Promise<void> => {
    try {
      const receipt = await ask(request);
      await journal.answer({ binding, requestId: request.requestId, receipt });
    } catch {
      // Still unanswered: it stays on record for the next attempt.
    } finally {
      dependencies.emit({ kind: "starts_changed" });
    }
  };

  /** The caller acts on an answer it was given; a row that cannot go is asked again later, same answer. */
  const taken = async (requestId: string, receipt: StartReceipt): Promise<RootStartOutcome> => {
    await journal.remove({ binding, requestId }).catch(() => undefined);
    dependencies.emit({ kind: "starts_changed" });

    return outcomeOf(receipt);
  };

  const starts: RootStarts = {
    async start(input) {
      const selected = readSelection(storage, binding);

      if (selected === undefined)
        return { kind: "refused", message: "Choose a folder on the host first." };

      // On record before it is sent, folder included; from here on only the record is sent.
      const request = await journal.record({
        binding,
        input: { ...input, workspace: { id: selected.id } },
      });

      let receipt: StartReceipt;

      try {
        receipt = await ask(request);
      } catch {
        dependencies.emit({ kind: "starts_changed" });

        return unanswered;
      }

      return taken(request.requestId, receipt);
    },

    async retry(requestId) {
      const row = (await journal.list(binding)).find(
        (candidate) => candidate.input.requestId === requestId,
      );

      if (row === undefined || asking.has(requestId)) return undefined;

      if (row.receipt !== undefined) return taken(requestId, row.receipt);
      let receipt: StartReceipt;

      try {
        receipt = await ask(row.input);
      } catch {
        dependencies.emit({ kind: "starts_changed" });

        return unanswered;
      }

      return taken(requestId, receipt);
    },

    async list() {
      return (await journal.list(binding)).flatMap((row) => {
        const { requestId, message } = row.input;

        if (row.receipt !== undefined)
          return [{ requestId, message, outcome: outcomeOf(row.receipt) }];

        return asking.has(requestId) ? [] : [{ requestId, message, outcome: unanswered }];
      });
    },

    dismiss: (requestId) => journal.remove({ binding, requestId }),
  };

  return {
    binding,

    selectedId: () => readSelection(storage, binding)?.id,

    async state() {
      const row = await selectedRow();

      return {
        workspace: row === undefined ? undefined : workspaceInfo(row),
        platform: dependencies.platform,
        binding,
      };
    },

    async list() {
      return (await rows()).map(workspaceInfo);
    },

    async open({ path }) {
      try {
        const registered = await client.environment("environment.workspaces.register", { path });

        switch (registered.kind) {
          case "registered":
          case "exists":
            return select(registered.workspace);
          case "not_absolute":
            return { kind: "failed", message: "Enter the folder's full path on the host." };
          case "not_directory":
            return { kind: "failed", message: `${path} is not a folder on the host.` };
          case "outside_roots":
            return {
              kind: "failed",
              message: `The host does not expose folders outside its configured roots.`,
            };
          default: {
            const _exhaustive: never = registered;

            return _exhaustive;
          }
        }
      } catch (cause) {
        // Not an owner: the folder may still be one the owner exposed.
        const row = (await rows().catch(() => [])).find((candidate) => candidate.path === path);

        if (row !== undefined) return select(row);

        return { kind: "failed", message: administrationRefused(cause) };
      }
    },

    async trust({ path, consent }) {
      if (consent === undefined || consent.hostId !== binding.hostId || consent.path !== path)
        return { kind: "failed", message: "Open the folder again, then trust what it shows." };

      try {
        const granted = await client.environment("environment.workspaces.trust", {
          id: consent.id,
          path: consent.path,
          identity: consent.identity,
        });

        switch (granted.kind) {
          case "granted":
            return select(granted.workspace);
          case "identity_changed":
            return {
              kind: "failed",
              message:
                "The folder changed on the host while you looked. Open it again, then trust it.",
            };
          case "path_mismatch":
          case "unknown":
          case "unavailable":
            return {
              kind: "failed",
              message: "This folder is not available on the host right now.",
            };
          default: {
            const _exhaustive: never = granted;

            return _exhaustive;
          }
        }
      } catch (cause) {
        return { kind: "failed", message: administrationRefused(cause) };
      }
    },

    async forget({ path }) {
      const row = (await rows()).find((candidate) => candidate.path === path);

      if (row === undefined) return;
      const outcome = await client.environment("environment.workspaces.forget", { id: row.id });

      if (outcome.kind === "busy") throw new Error("This folder still has a chat with work in it.");

      if (readSelection(storage, binding)?.id === row.id) {
        storage.removeItem(key);
        dependencies.emit({ kind: "workspace_closed" });
      }
    },

    close() {
      if (storage.getItem(key) === null) return;
      storage.removeItem(key);
      dependencies.emit({ kind: "workspace_closed" });
    },

    async selection() {
      const row = await selectedRow();

      return row === undefined
        ? { kind: "home" }
        : { kind: "project", workspace: workspaceInfo(row) };
    },

    async sessions(page) {
      const row = await selectedRow();

      return {
        ...page,
        items:
          row === undefined ? [] : page.items.filter((info) => info.workspace.cwd === row.path),
      };
    },

    starts,

    async replay() {
      for (const row of await journal.list(binding)) {
        if (row.receipt === undefined && !asking.has(row.input.requestId))
          await askAgain(row.input);
      }
    },
  };
}

const unanswered: RootStartOutcome = { kind: "unanswered" };

function outcomeOf(receipt: StartReceipt): RootStartOutcome {
  switch (receipt.kind) {
    case "accepted":
      return { kind: "accepted", sessionId: receipt.sessionId };
    case "conflict":
      return {
        kind: "refused",
        message: "This request was already sent with different content.",
      };
    case "refused":
      return { kind: "refused", message: refused(receipt) };
    default: {
      const _exhaustive: never = receipt;

      return _exhaustive;
    }
  }
}
