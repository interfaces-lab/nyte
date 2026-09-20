/**
 * Every wire operation bound to the SDK method it names. Hosts that carry operations
 * over a transport (HTTP, Electron IPC) parse at their boundary, then hand
 * the operation and its parsed input here; an operation missing from the table fails
 * the build, and each arrow proves the SDK signature matches the protocol's.
 *
 * A remote SDK answers the same table: a host that forwards to another host
 * (the desktop reaching a server) dispatches to it the way it dispatches locally.
 */
import type { Operation, OperationInput, OperationOutput, RemoteNyte } from "@nyte-ai/protocol";
import type { Nyte } from "./types.ts";

type Dispatch = {
  readonly [V in Operation]: (
    sdk: Nyte | RemoteNyte,
    input: OperationInput<V>,
  ) => Promise<OperationOutput<V>>;
};

const DISPATCH: Dispatch = {
  // The local SDK holds its landing policy as a value; the wire asks for it.
  landing: (sdk) =>
    typeof sdk.landing === "function" ? sdk.landing() : Promise.resolve(sdk.landing),
  "sessions.create": (sdk, input) => sdk.sessions.create(input),
  "sessions.get": (sdk, input) => sdk.sessions.get(input),
  "sessions.snapshot": (sdk, input) => sdk.sessions.snapshot(input),
  "sessions.metadata": (sdk, input) => sdk.sessions.metadata(input),
  "sessions.list": (sdk, input) => sdk.sessions.list(input),
  "sessions.rename": (sdk, input) => sdk.sessions.rename(input),
  "sessions.setPinned": (sdk, input) => sdk.sessions.setPinned(input),
  "sessions.setArchived": (sdk, input) => sdk.sessions.setArchived(input),
  "sessions.delete": (sdk, input) => sdk.sessions.delete(input),
  "sessions.configure": (sdk, input) => sdk.sessions.configure(input),
  "messages.send": (sdk, input) => sdk.messages.send(input),
  "messages.cancel": (sdk, input) => sdk.messages.cancel(input),
  "messages.redeliver": (sdk, input) => sdk.messages.redeliver(input),
  "jobs.list": (sdk, input) => sdk.jobs.list(input),
  "jobs.start": (sdk, input) => sdk.jobs.start(input),
  "jobs.background": (sdk, input) => sdk.jobs.background(input),
  "jobs.cancel": (sdk, input) => sdk.jobs.cancel(input),
  "runs.current": (sdk, input) => sdk.runs.current(input),
  "runs.abort": (sdk, input) => sdk.runs.abort(input),
  "runs.reply": (sdk, input) => sdk.runs.reply(input),
  "runs.diff": (sdk, input) => sdk.runs.diff(input),
  "runs.revert": (sdk, input) => sdk.runs.revert(input),
  "heads.move": (sdk, input) => sdk.heads.move(input),
  "workspace.list": (sdk) => sdk.workspace.list(),
  "workspace.current": (sdk) => sdk.workspace.current(),
  "workspace.select": (sdk, input) => sdk.workspace.select(input),
  "workspace.forget": (sdk, input) => sdk.workspace.forget(input),
  "workspace.files": (sdk, input) => sdk.workspace.files(input),
  "workspace.vcs.snapshot": (sdk, input) => sdk.workspace.vcs.snapshot(input),
  "workspace.vcs.diff": (sdk, input) => sdk.workspace.vcs.diff(input),
  "workspace.vcs.contents": (sdk, input) => sdk.workspace.vcs.contents(input),
  "workspace.vcs.log": (sdk, input) => sdk.workspace.vcs.log(input),
  "workspace.vcs.refs": (sdk, input) => sdk.workspace.vcs.refs(input),
  "workspace.vcs.stage": (sdk, input) => sdk.workspace.vcs.stage(input),
  "workspace.vcs.discard": (sdk, input) => sdk.workspace.vcs.discard(input),
  "workspace.vcs.commit": (sdk, input) => sdk.workspace.vcs.commit(input),
  "workspace.vcs.createBranch": (sdk, input) => sdk.workspace.vcs.createBranch(input),
  "workspace.vcs.push": (sdk, input) => sdk.workspace.vcs.push(input),
  "provider.models.list": (sdk) => sdk.provider.models.list(),
  "provider.models.default": (sdk) => sdk.provider.models.default(),
  "plugins.catalog": (sdk) => sdk.plugins.catalog(),
  "plugins.list": (sdk, input) => sdk.plugins.list(input),
  "plugins.commands.list": (sdk, input) => sdk.plugins.commands.list(input),
  "plugins.commands.run": (sdk, input) => sdk.plugins.commands.run(input),
  "plugins.settings.list": (sdk, input) => sdk.plugins.settings.list(input),
  "plugins.settings.apply": (sdk, input) => sdk.plugins.settings.apply(input),
  "plugins.resources.list": (sdk, input) => sdk.plugins.resources.list(input),
  "plugins.status.list": (sdk, input) => sdk.plugins.status.list(input),
};

/** Run one operation, parsed at the caller's boundary, against an SDK. */
export function dispatch<V extends Operation>(
  sdk: Nyte | RemoteNyte,
  operation: V,
  input: OperationInput<V>,
): Promise<OperationOutput<V>> {
  return DISPATCH[operation](sdk, input);
}
