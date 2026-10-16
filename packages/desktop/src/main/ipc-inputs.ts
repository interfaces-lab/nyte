/**
 * Main is the only Electron process that compiles validators: `Compile` emits
 * code through `new Function`, which the renderer's CSP forbids. Renderer code
 * imports `typebox/value` and never `typebox/compile`.
 */
import { HOST_OPERATION_PATHS } from "../shared/ipc.ts";
import { Type } from "typebox";
import type { Static, TProperties, TSchema } from "typebox";
import { Compile } from "typebox/compile";
import type { Validator } from "typebox/compile";
import { ParseError } from "typebox/value";
import { ExpectedHostError } from "./errors.ts";
import { themeSource } from "./launch-state.ts";
import { Uuid } from "@nyte-ai/connect";
import type { CallInput, CallPath, CallRequest } from "../shared/ipc.ts";
import type { BrowserBoundsMessage, BrowserFocusMessage, BrowserKey } from "@nyte-ai/app/bridge.ts";

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
          code: "invalid",
          message: "The request is invalid. Check its fields.",
        });
      }
    },
  } satisfies Parser<Static<T>>;
}

const nonEmpty = Type.String({ minLength: 1 });

const noInput = Type.Optional(Type.Undefined());

const remotePlugin = Type.Literal("cloudflare");

const usageDay = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });

const usageWindow = compile(
  strict({ sinceDay: Type.Union([usageDay, Type.Null()]), untilDay: usageDay }),
);

const checkedUsageWindow: typeof usageWindow = {
  Parse(value) {
    const window = usageWindow.Parse(value);
    const days = window.sinceDay === null ? [window.untilDay] : [window.sinceDay, window.untilDay];

    const valid = days.every((day) => {
      const date = new Date(`${day}T12:00:00Z`);

      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
    });

    if (!valid || (window.sinceDay !== null && window.sinceDay > window.untilDay))
      throw new ExpectedHostError({ code: "invalid", message: "The usage window is invalid." });

    return window;
  },
};

/** Each operation's input parser, keyed by its path. */
type CallInputParsers = { readonly [P in CallPath]: Parser<CallInput<P>> };

/** Each operation's input schema; the IPC boundary decodes a request's input with its path's parser. */
export const CALL_INPUT_SCHEMAS: CallInputParsers = {
  "host.endpoint": compile(noInput),
  "host.state": compile(noInput),
  "host.fonts": compile(noInput),
  "host.usage": checkedUsageWindow,
  "host.openWorkspace": compile(strict({ path: nonEmpty })),
  "host.pickWorkspace": compile(noInput),
  "host.trustWorkspace": compile(strict({ path: nonEmpty })),
  "host.closeWorkspace": compile(noInput),
  "host.updates.state": compile(noInput),
  "host.updates.check": compile(noInput),
  "host.server.state": compile(noInput),
  "host.server.connect": compile(strict({ baseUrl: nonEmpty, token: nonEmpty })),
  "host.server.disconnect": compile(noInput),
  "host.remote.state": compile(noInput),
  "host.remote.start": compile(
    strict({
      reach: Type.Enum(["local", "tailnet", "cloudflare"]),
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
            role: Type.Enum(["cut", "copy", "paste", "selectAll"]),
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
      action: Type.Enum([
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
    }),
  ),
  "host.browser.menu": compile(
    strict({
      surface: nonEmpty,
      bookmarksVisible: Type.Boolean(),
      x: Type.Integer(),
      y: Type.Integer(),
      owner: Type.Union([nonEmpty, Type.Null()]),
    }),
  ),
  "host.browser.perform": compile(
    strict({
      surface: nonEmpty,
      action: Type.Enum([
        "screenshot",
        "copy-url",
        "clear-history",
        "clear-cookies",
        "clear-cache",
      ]),
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
  "host.browser.focusPage": compile(strict({ surface: nonEmpty })),
};

const callRequest = compile(
  strict({
    path: Type.Enum([...HOST_OPERATION_PATHS]),
    input: Type.Unknown(),
  }),
);

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

const browserKey = compile(
  strict({
    key: keyName,
    code: keyName,
    ctrlKey: Type.Boolean(),
    shiftKey: Type.Boolean(),
    altKey: Type.Boolean(),
    metaKey: Type.Boolean(),
    repeat: Type.Boolean(),
  }),
);

/** The request envelope: a known operation path. Its input is decoded by `decodeCallInput`. */
export function decodeCallRequest(input: CallRequest): CallRequest {
  return checked(callRequest, input);
}

export function decodeCallInput<P extends CallPath>(
  path: P,
  input: CallRequest["input"],
): CallInput<P> {
  return CALL_INPUT_SCHEMAS[path].Parse(input);
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

export const themePreference = Compile(themeSource);
