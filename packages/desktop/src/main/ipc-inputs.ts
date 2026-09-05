/**
 * Main is the only Electron process that compiles validators: `Compile` emits
 * code through `new Function`, which the renderer's CSP forbids. Renderer code
 * imports `typebox/value` and never `typebox/compile`.
 */
import { BROWSER_ACTIONS } from "../shared/ipc.ts";
import { Type } from "typebox";
import type { TProperties, TSchema } from "typebox";
import { Compile } from "typebox/compile";
import type { Nyte } from "@nyte-ai/core";
import { VERBS } from "@nyte-ai/protocol";
import { sessionId } from "../shared/schemas.ts";
import type {
  BrowserBoundsMessage,
  CallInput,
  CallOutput,
  CallPath,
  CallRequest,
  SdkVerbPath,
  WatchStartInput,
} from "../shared/ipc.ts";

interface Parser<T> {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- this is the boundary parser itself
  Parse(value: unknown): T;
}

const strict = <P extends TProperties>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });
/** Pins `Compile`'s result type so the `satisfies` below cannot widen it. */
const compile = <T extends TSchema>(schema: T) => Compile(schema);

const id = Type.String();
const nonEmpty = Type.String({ minLength: 1 });
const thinkingLevel = Type.Enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const noInput = Type.Optional(Type.Undefined());
const model = strict({ provider: Type.String(), id });

export const CALL_INPUT_SCHEMAS = {
  // The SDK verbs validate with the wire protocol's own input schemas, compiled here.
  "sessions.create": compile(VERBS["sessions.create"].input),
  "sessions.get": compile(VERBS["sessions.get"].input),
  "sessions.snapshot": compile(VERBS["sessions.snapshot"].input),
  "sessions.list": compile(VERBS["sessions.list"].input),
  "sessions.rename": compile(VERBS["sessions.rename"].input),
  "sessions.setPinned": compile(VERBS["sessions.setPinned"].input),
  "sessions.setArchived": compile(VERBS["sessions.setArchived"].input),
  "sessions.delete": compile(VERBS["sessions.delete"].input),
  "sessions.configure": compile(VERBS["sessions.configure"].input),
  "messages.send": compile(VERBS["messages.send"].input),
  "messages.cancel": compile(VERBS["messages.cancel"].input),
  "messages.redeliver": compile(VERBS["messages.redeliver"].input),
  "runs.abort": compile(VERBS["runs.abort"].input),
  "runs.changes": compile(VERBS["runs.changes"].input),
  "heads.move": compile(VERBS["heads.move"].input),
  "workspace.list": compile(VERBS["workspace.list"].input),
  "workspace.forget": compile(VERBS["workspace.forget"].input),
  "workspace.vcs.diff": compile(VERBS["workspace.vcs.diff"].input),
  "provider.models.default": compile(VERBS["provider.models.default"].input),
  "plugins.catalog": compile(VERBS["plugins.catalog"].input),
  "plugins.list": compile(VERBS["plugins.list"].input),
  "plugins.commands.list": compile(VERBS["plugins.commands.list"].input),
  "plugins.commands.run": compile(VERBS["plugins.commands.run"].input),
  "plugins.settings.list": compile(VERBS["plugins.settings.list"].input),
  "plugins.settings.apply": compile(VERBS["plugins.settings.apply"].input),
  "plugins.resources.list": compile(VERBS["plugins.resources.list"].input),
  "host.state": compile(noInput),
  "host.fonts": compile(noInput),
  "host.openWorkspace": compile(strict({ path: Type.String() })),
  "host.pickWorkspace": compile(noInput),
  "host.trustWorkspace": compile(strict({ path: Type.String() })),
  "host.closeWorkspace": compile(noInput),
  "host.catalog": compile(noInput),
  "host.login": compile(
    strict({
      provider: Type.String(),
      method: Type.Union([
        strict({ kind: Type.Literal("browser") }),
        // A key must hold something other than whitespace.
        strict({ kind: Type.Literal("api_key"), key: Type.String({ pattern: "\\S" }) }),
      ]),
    }),
  ),
  "host.logout": compile(strict({ provider: Type.String() })),
  "host.setPreference": compile(
    Type.Union([
      strict({ kind: Type.Literal("provider"), provider: Type.String(), enabled: Type.Boolean() }),
      strict({
        kind: Type.Literal("models"),
        provider: Type.String(),
        ids: Type.Array(id),
        hidden: Type.Boolean(),
      }),
      strict({
        kind: Type.Literal("defaults"),
        model: Type.Optional(model),
        thinkingLevel: Type.Optional(thinkingLevel),
      }),
    ]),
  ),
  "host.vcs.snapshot": compile(noInput),
  "host.files.list": compile(noInput),
  "host.github.state": compile(noInput),
  "host.github.refresh": compile(noInput),
  "host.github.signIn": compile(noInput),
  "host.github.signOut": compile(noInput),
  "host.openExternal": compile(strict({ url: Type.String() })),
  "host.browser.open": compile(strict({ surface: nonEmpty, url: Type.String() })),
  "host.browser.navigate": compile(
    strict({
      surface: nonEmpty,
      action: Type.Enum(["back", "forward", "reload", "stop"]),
    }),
  ),
  "host.browser.menu": compile(
    strict({
      surface: nonEmpty,
      bookmarksVisible: Type.Boolean(),
      x: Type.Integer(),
      y: Type.Integer(),
    }),
  ),
  "host.browser.perform": compile(
    strict({ surface: nonEmpty, action: Type.Enum(BROWSER_ACTIONS) }),
  ),
  "host.browser.close": compile(strict({ surface: nonEmpty })),
  "host.terminal.create": compile(
    strict({ id: nonEmpty, workspacePath: Type.Union([nonEmpty, Type.Null()]) }),
  ),
  "host.terminal.write": compile(strict({ id: nonEmpty, data: Type.String({ maxLength: 65536 }) })),
  "host.terminal.resize": compile(
    strict({
      id: nonEmpty,
      cols: Type.Integer({ minimum: 2, maximum: 1000 }),
      rows: Type.Integer({ minimum: 1, maximum: 1000 }),
    }),
  ),
  "host.terminal.acknowledge": compile(
    strict({ id: nonEmpty, length: Type.Integer({ minimum: 0, maximum: 1048576 }) }),
  ),
  "host.terminal.close": compile(strict({ id: nonEmpty })),
} satisfies { readonly [P in CallPath]: Parser<CallInput<P>> };

const callRequest = Compile(
  Type.Union(
    Object.entries(CALL_INPUT_SCHEMAS).map(([path, input]) =>
      strict({ path: Type.Literal(path), input: input.Type() }),
    ),
  ),
);
const watchStart = Compile(
  Type.Union([
    strict({ watchId: nonEmpty, sessionId, live: Type.Literal(true) }),
    strict({ watchId: nonEmpty, sessionId, afterSeq: Type.Optional(Type.Integer()) }),
  ]),
);
const watchStop = Compile(strict({ watchId: nonEmpty }));
const size = Type.Number({ minimum: 0 });
const browserBounds = Compile(
  strict({
    surface: nonEmpty,
    bounds: strict({ x: Type.Number(), y: Type.Number(), width: size, height: size }),
    visible: Type.Boolean(),
  }),
);

/** The wire value already carries the static type; the check earns it. */
function checked<T>(validator: Parser<unknown>, value: T): T {
  validator.Parse(value);
  return value;
}

export function decodeCallRequest(input: CallRequest): CallRequest {
  return checked(callRequest, input);
}

export function decodeWatchStart(input: WatchStartInput): WatchStartInput {
  return checked(watchStart, input);
}

export function decodeWatchStop(input: { readonly watchId: string }): string {
  return watchStop.Parse(input).watchId;
}

export function decodeBrowserBounds(input: BrowserBoundsMessage): BrowserBoundsMessage {
  return checked(browserBounds, input);
}

export interface SdkVerb {
  invoke(
    input: CallInput<SdkVerbPath>,
    getSdk: () => Promise<Nyte>,
  ): Promise<CallOutput<SdkVerbPath>>;
}

/** Bind an SDK verb to its exact input parser before it enters the dispatcher. */
export function sdkVerb<
  TInput extends CallInput<SdkVerbPath>,
  TResult extends CallOutput<SdkVerbPath>,
>(schema: Parser<TInput>, run: (sdk: Nyte, input: TInput) => Promise<TResult>): SdkVerb {
  return {
    invoke: async (input, getSdk) => run(await getSdk(), schema.Parse(input)),
  };
}
