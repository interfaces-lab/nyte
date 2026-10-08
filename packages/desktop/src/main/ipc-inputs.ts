/**
 * Main is the only Electron process that compiles validators: `Compile` emits
 * code through `new Function`, which the renderer's CSP forbids. Renderer code
 * imports `typebox/value` and never `typebox/compile`.
 */
import { HOST_OPERATION_PATHS, SDK_OPERATION_PATHS } from "../shared/ipc.ts";
import { Type } from "typebox";
import type { Static, TProperties, TSchema } from "typebox";
import { Compile } from "typebox/compile";
import type { Validator } from "typebox/compile";
import { ParseError } from "typebox/value";
import { ExpectedHostError } from "./errors.ts";
import { ENVIRONMENT_OPERATIONS, OPERATIONS, schemas } from "@nyte-ai/protocol";
import { HostSettingsPatchSchema } from "@nyte-ai/host/settings";
import { Uuid } from "@nyte-ai/connect";
import { sessionId } from "@nyte-ai/app/schemas.ts";
import type { CallInput, CallPath, CallRequest, WatchStartInput } from "../shared/ipc.ts";
import type {
  BrowserAction,
  BrowserBoundsMessage,
  BrowserFocusMessage,
  BrowserKey,
  BrowserNavigationAction,
  ContextMenuRole,
  RemoteAccessPluginId,
  RemoteReach,
} from "@nyte-ai/app/bridge.ts";

type Parser<T> = Pick<Validator<TProperties, TSchema, T>, "Parse">;

const strict = <P extends TProperties>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });

/** Only request-schema failures are invalid input; internal parser failures remain diagnostics. */
function compile<T extends TSchema>(schema: T) {
  const validator = Compile(schema);

  return {
    Parse(value) {
      try {
        return validator.Parse(value);
      } catch (cause) {
        if (!(cause instanceof ParseError)) throw cause;
        throw new ExpectedHostError({
          code: "invalid_input",
          message: "The request is invalid. Check its fields.",
          issues: cause.cause.errors.slice(0, 20).map((error) => {
            // Name only the top-level field from our schema, never input property names or values.
            const path = error.schemaPath.split("/");
            const index = path.indexOf("properties");
            const field = index < 0 ? undefined : path[index + 1];

            return {
              path: field === undefined ? "" : `/${field}`,
              message: "Invalid request field",
            };
          }),
        });
      }
    },
  } satisfies Parser<Static<T>>;
}

const nonEmpty = Type.String({ minLength: 1 });

const noInput = Type.Optional(Type.Undefined());

const remotePlugin = schemas.typed<RemoteAccessPluginId>()(Type.Literal("cloudflare"));

export const CALL_INPUT_SCHEMAS = {
  // The SDK operations validate with the wire protocol's own input schemas, compiled here.
  "sessions.create": compile(OPERATIONS["sessions.create"].input),
  "sessions.get": compile(OPERATIONS["sessions.get"].input),
  "sessions.snapshot": compile(OPERATIONS["sessions.snapshot"].input),
  "sessions.metadata": compile(OPERATIONS["sessions.metadata"].input),
  "sessions.list": compile(OPERATIONS["sessions.list"].input),
  "sessions.rename": compile(OPERATIONS["sessions.rename"].input),
  "sessions.setPinned": compile(OPERATIONS["sessions.setPinned"].input),
  "sessions.setArchived": compile(OPERATIONS["sessions.setArchived"].input),
  "sessions.delete": compile(OPERATIONS["sessions.delete"].input),
  "sessions.configure": compile(OPERATIONS["sessions.configure"].input),
  "messages.send": compile(OPERATIONS["messages.send"].input),
  "messages.cancel": compile(OPERATIONS["messages.cancel"].input),
  "messages.redeliver": compile(OPERATIONS["messages.redeliver"].input),
  "jobs.list": compile(OPERATIONS["jobs.list"].input),
  "jobs.start": compile(OPERATIONS["jobs.start"].input),
  "jobs.background": compile(OPERATIONS["jobs.background"].input),
  "jobs.cancel": compile(OPERATIONS["jobs.cancel"].input),
  "runs.abort": compile(OPERATIONS["runs.abort"].input),
  "runs.reply": compile(OPERATIONS["runs.reply"].input),
  "runs.diff": compile(OPERATIONS["runs.diff"].input),
  "heads.move": compile(OPERATIONS["heads.move"].input),
  "workspace.list": compile(OPERATIONS["workspace.list"].input),
  "workspace.forget": compile(OPERATIONS["workspace.forget"].input),
  "workspace.files": compile(OPERATIONS["workspace.files"].input),
  "workspace.read": compile(OPERATIONS["workspace.read"].input),
  "workspace.save": compile(OPERATIONS["workspace.save"].input),
  "workspace.format": compile(OPERATIONS["workspace.format"].input),
  "workspace.search": compile(OPERATIONS["workspace.search"].input),
  "workspace.blame": compile(OPERATIONS["workspace.blame"].input),
  "workspace.vcs.snapshot": compile(OPERATIONS["workspace.vcs.snapshot"].input),
  "workspace.vcs.changes": compile(OPERATIONS["workspace.vcs.changes"].input),
  "workspace.vcs.diff": compile(OPERATIONS["workspace.vcs.diff"].input),
  "workspace.vcs.contents": compile(OPERATIONS["workspace.vcs.contents"].input),
  "workspace.vcs.log": compile(OPERATIONS["workspace.vcs.log"].input),
  "workspace.vcs.refs": compile(OPERATIONS["workspace.vcs.refs"].input),
  "workspace.vcs.stage": compile(OPERATIONS["workspace.vcs.stage"].input),
  "workspace.vcs.discard": compile(OPERATIONS["workspace.vcs.discard"].input),
  "workspace.vcs.commit": compile(OPERATIONS["workspace.vcs.commit"].input),
  "workspace.vcs.createBranch": compile(OPERATIONS["workspace.vcs.createBranch"].input),
  "workspace.vcs.push": compile(OPERATIONS["workspace.vcs.push"].input),
  "provider.models.default": compile(OPERATIONS["provider.models.default"].input),
  "plugins.catalog": compile(OPERATIONS["plugins.catalog"].input),
  "plugins.list": compile(OPERATIONS["plugins.list"].input),
  "plugins.commands.list": compile(OPERATIONS["plugins.commands.list"].input),
  "plugins.commands.run": compile(OPERATIONS["plugins.commands.run"].input),
  "plugins.settings.list": compile(OPERATIONS["plugins.settings.list"].input),
  "plugins.settings.apply": compile(OPERATIONS["plugins.settings.apply"].input),
  "plugins.resources.list": compile(OPERATIONS["plugins.resources.list"].input),
  "host.state": compile(noInput),
  "host.sessionDirectory": compile(noInput),
  "host.fonts": compile(noInput),
  "host.openWorkspace": compile(strict({ path: Type.String() })),
  "host.pickWorkspace": compile(noInput),
  "host.trustWorkspace": compile(strict({ path: Type.String() })),
  "host.closeWorkspace": compile(noInput),
  "host.catalog": compile(Type.Union([Type.Undefined(), strict({ sessionId })])),
  "host.usage": compile(ENVIRONMENT_OPERATIONS["environment.usage"].input),
  "host.accountLimits": compile(noInput),
  "host.login": compile(ENVIRONMENT_OPERATIONS["environment.login"].input),
  "host.cancelLogin": compile(ENVIRONMENT_OPERATIONS["environment.cancelLogin"].input),
  "host.logout": compile(ENVIRONMENT_OPERATIONS["environment.logout"].input),
  "host.setPreference": compile(ENVIRONMENT_OPERATIONS["environment.setPreference"].input),
  "host.github.createPullRequest": compile(
    ENVIRONMENT_OPERATIONS["environment.github.createPullRequest"].input,
  ),
  "host.settings.get": compile(noInput),
  "host.settings.set": compile(HostSettingsPatchSchema),
  "host.updates.state": compile(noInput),
  "host.updates.check": compile(noInput),
  "host.github.state": compile(noInput),
  "host.github.signIn": compile(noInput),
  "host.github.signOut": compile(noInput),
  "host.server.state": compile(noInput),
  "host.server.connect": compile(strict({ baseUrl: nonEmpty, token: nonEmpty })),
  "host.server.disconnect": compile(noInput),
  "host.server.createSession": compile(noInput),
  "host.remote.state": compile(noInput),
  "host.remote.start": compile(
    strict({
      reach: schemas.typed<RemoteReach>()(Type.Enum(["local", "tailnet", "cloudflare"])),
    }),
  ),
  "host.remote.stop": compile(noInput),
  "host.remote.configure": compile(
    strict({
      plugin: remotePlugin,
      hostname: Type.String({ minLength: 1, maxLength: 253 }),
      port: Type.Integer({ minimum: 1024, maximum: 65_535 }),
      tunnelToken: Type.String({ minLength: 1, maxLength: 4096 }),
    }),
  ),
  "host.remote.clear": compile(strict({ plugin: remotePlugin })),
  "host.remote.pair": compile(
    strict({ plugin: remotePlugin, name: Type.String({ minLength: 1, maxLength: 64 }) }),
  ),
  "host.remote.revoke": compile(
    strict({ plugin: remotePlugin, deviceId: Type.String({ minLength: 1, maxLength: 64 }) }),
  ),
  "host.connect.state": compile(noInput),
  "host.connect.link": compile(noInput),
  "host.connect.cancel": compile(noInput),
  "host.connect.setEnabled": compile(strict({ enabled: Type.Boolean() })),
  "host.connect.unlink": compile(noInput),
  "host.connect.revokeDevice": compile(strict({ deviceId: Uuid })),
  "host.connect.openAccount": compile(noInput),
  "host.connect.signOut": compile(noInput),
  "host.openExternal": compile(strict({ url: Type.String() })),
  "host.confirmExternal": compile(strict({ url: Type.String() })),
  "host.revealPath": compile(strict({ path: nonEmpty })),
  "host.openPluginsFolder": compile(noInput),
  "host.contextMenu": compile(
    strict({
      items: Type.Array(
        Type.Union([
          strict({ kind: Type.Literal("separator") }),
          strict({
            kind: Type.Literal("role"),
            role: schemas.typed<ContextMenuRole>()(
              Type.Enum(["cut", "copy", "paste", "selectAll"]),
            ),
            label: nonEmpty,
          }),
          strict({
            kind: Type.Literal("item"),
            label: nonEmpty,
            accelerator: Type.Optional(nonEmpty),
            enabled: Type.Optional(Type.Boolean()),
          }),
        ]),
        { maxItems: 40 },
      ),
      x: Type.Integer(),
      y: Type.Integer(),
    }),
  ),
  "host.browser.open": compile(
    strict({
      surface: nonEmpty,
      url: Type.String(),
      owner: Type.Optional(
        Type.Union([
          strict({ kind: Type.Literal("home") }),
          strict({ kind: Type.Literal("project"), path: nonEmpty }),
        ]),
      ),
    }),
  ),
  "host.browser.navigate": compile(
    strict({
      surface: nonEmpty,
      action: schemas.typed<BrowserNavigationAction>()(
        Type.Enum([
          "back",
          "forward",
          "reload",
          "hard-reload",
          "stop",
          "trust-certificate",
          "zoom-in",
          "zoom-out",
          "zoom-reset",
          "toggle-devtools",
        ]),
      ),
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
    strict({
      surface: nonEmpty,
      action: schemas.typed<BrowserAction>()(
        Type.Enum(["screenshot", "copy-url", "clear-history", "clear-cookies", "clear-cache"]),
      ),
      owner: Type.Union([nonEmpty, Type.Null()]),
    }),
  ),
  "host.browser.close": compile(strict({ surface: nonEmpty })),
  "host.browser.captureFrame": compile(strict({ surface: nonEmpty })),
  "host.browser.find": compile(
    strict({
      surface: nonEmpty,
      text: Type.String({ maxLength: 1024 }),
      direction: Type.Enum(["next", "previous"]),
    }),
  ),
  "host.browser.cancelDownload": compile(strict({ surface: nonEmpty, id: nonEmpty })),
  "host.browser.login": compile(
    strict({
      surface: nonEmpty,
      credentials: Type.Union([
        Type.Undefined(),
        strict({
          username: Type.String({ maxLength: 1024 }),
          password: Type.String({ maxLength: 1024 }),
        }),
      ]),
    }),
  ),
  "host.browser.history": compile(strict({ owner: Type.Union([nonEmpty, Type.Null()]) })),
  "host.browser.forgetHistory": compile(
    strict({ owner: Type.Union([nonEmpty, Type.Null()]), url: Type.String({ maxLength: 8192 }) }),
  ),
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
  "host.terminal.idle": compile(strict({ id: nonEmpty })),
  "host.terminal.close": compile(strict({ id: nonEmpty })),
} satisfies { readonly [P in CallPath]: Parser<CallInput<P>> };

const callRequest = compile(
  strict({
    path: Type.Enum([...SDK_OPERATION_PATHS, ...HOST_OPERATION_PATHS]),
    input: Type.Unknown(),
  }),
);

const watchStart = compile(
  Type.Union([
    strict({ watchId: nonEmpty, sessionId, live: Type.Literal(true) }),
    strict({ watchId: nonEmpty, sessionId, afterSeq: Type.Optional(Type.Integer()) }),
  ]),
);

const watchStop = compile(strict({ watchId: nonEmpty }));

const size = Type.Number({ minimum: 0 });

const browserBounds = compile(
  strict({
    surface: nonEmpty,
    bounds: strict({ x: Type.Number(), y: Type.Number(), width: size, height: size }),
    visible: Type.Boolean(),
  }),
);

/** Preserve the caller's correlated type after its boundary schema accepts it. */
function checked<T>(validator: Parser<unknown>, value: T): T {
  validator.Parse(value);

  return value;
}

const browserFocus = compile(strict({ surface: nonEmpty, focused: Type.Boolean() }));

const keyName = Type.String({ maxLength: 32 });

/** Sent by the guest preload, so the page may have forged it. */
const browserKey = compile(
  schemas.typed<BrowserKey>()(
    strict({
      key: keyName,
      code: keyName,
      ctrlKey: Type.Boolean(),
      shiftKey: Type.Boolean(),
      altKey: Type.Boolean(),
      metaKey: Type.Boolean(),
      repeat: Type.Boolean(),
    }),
  ),
);

export function decodeCallRequest(input: CallRequest): CallRequest {
  // DesktopHost's selected operation parser validates `input` exactly once.
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

export function decodeBrowserFocus(input: BrowserFocusMessage): BrowserFocusMessage {
  return checked(browserFocus, input);
}

export function decodeBrowserKey(input: BrowserKey): BrowserKey {
  return checked(browserKey, input);
}

export const themePreference = Compile(
  Type.Union([Type.Literal("system"), Type.Literal("light"), Type.Literal("dark")]),
);
