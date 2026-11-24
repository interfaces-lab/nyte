import { HOST_OPERATION_PATHS } from "./ipc.ts";
import { Type } from "typebox";
import type { Static, TProperties, TSchema } from "typebox";
import { Compile } from "typebox/compile";
import type { Validator } from "typebox/compile";
import { ParseError } from "typebox/value";
import { ExpectedHostError } from "./errors.ts";
import { Uuid } from "@nyte-ai/connect";
import type { CallInput, CallPath, CallRequest } from "./ipc.ts";
import { DESIGN_PICK_CHARS, WHEEL_DELTA_LIMIT } from "./browser-page.ts";
import { BROWSER_DESIGN_VIEW_KEYS, TERMINAL_NOTICE_LIMITS } from "@nyte-ai/app/contract/bridge.ts";
import { DESKTOP_APPS } from "@nyte-ai/app/contract/desktop-app.ts";
import { ArrivalSubjectType, SelectedWorkspaceType } from "@nyte-ai/app/contract/desktop-window.ts";
import type { BrowserKey } from "@nyte-ai/app/contract/bridge.ts";

type Parser<T> = Pick<Validator<TProperties, TSchema, T>, "Parse">;

const strict = <P extends TProperties>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });

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

export const themeSource = Type.Union([
  Type.Literal("system"),
  Type.Literal("light"),
  Type.Literal("dark"),
]);

const noInput = Type.Optional(Type.Undefined());

const designOff = strict({ kind: Type.Literal("off") });

const designView = strict({
  kind: Type.Literal("view"),
  view: Type.Enum(Object.values(BROWSER_DESIGN_VIEW_KEYS)),
  shown: Type.Boolean(),
});

const usageDay = Type.String({ pattern: String.raw`^\d{4}-\d{2}-\d{2}$` });

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

    if (!valid || (window.sinceDay !== null && window.sinceDay > window.untilDay)) {
      throw new ExpectedHostError({ code: "invalid", message: "The usage window is invalid." });
    }

    return window;
  },
};

type CallInputParsers = { readonly [P in CallPath]: Parser<CallInput<P>> };

export const CALL_INPUT_SCHEMAS: CallInputParsers = {
  "host.endpoint": compile(noInput),
  "host.restore": compile(strict({ session: nonEmpty })),
  "host.fonts": compile(noInput),
  "host.usage": checkedUsageWindow,
  "host.openWorkspace": compile(strict({ path: nonEmpty })),
  "host.registerWorkspace": compile(strict({ path: nonEmpty })),
  "host.pickWorkspace": compile(noInput),
  "host.pickFolder": compile(noInput),
  "host.trustWorkspace": compile(strict({ path: nonEmpty })),
  "host.updates.state": compile(noInput),
  "host.updates.check": compile(noInput),
  "host.updates.channel": compile(noInput),
  "host.updates.setChannel": compile(strict({ channel: Type.Enum(["stable", "nightly"]) })),
  "host.hostProcess.state": compile(noInput),
  "host.hostProcess.confirm": compile(strict({ action: Type.Enum(["restart", "stop"]) })),
  "host.hostProcess.start": compile(noInput),
  "host.bundledCli": compile(noInput),
  "host.server.state": compile(noInput),
  "host.server.connect": compile(strict({ baseUrl: nonEmpty, token: nonEmpty })),
  "host.server.disconnect": compile(noInput),
  "host.remote.state": compile(noInput),
  "host.remote.configureTailnet": compile(strict({ enabled: Type.Boolean() })),
  "host.remote.signOutTailnet": compile(noInput),
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
  "host.openInBrowser": compile(strict({ path: nonEmpty })),
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
      holder: Type.Enum(["tab", "board"]),
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
  "host.browser.design": compile(
    strict({
      surface: nonEmpty,
      change: Type.Union([strict({ kind: Type.Literal("on") }), designOff, designView]),
    }),
  ),
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
  "host.browser.guests": compile(noInput),
  "host.browser.attach": compile(
    strict({
      surface: nonEmpty,
      webContentsId: Type.Integer({ minimum: 1 }),
      generation: Type.Integer({ minimum: 0 }),
    }),
  ),
  "host.browser.setEntered": compile(strict({ surface: nonEmpty, entered: Type.Boolean() })),
  "host.switchApp": compile(
    strict({
      to: Type.Enum([...DESKTOP_APPS, "last"]),
      workspace: Type.Union([SelectedWorkspaceType, Type.Null()]),
      subject: Type.Union([ArrivalSubjectType, Type.Null()]),
    }),
  ),
  "host.openSettings": compile(strict({ page: Type.Optional(nonEmpty) })),
};

const callRequest = compile(
  strict({
    path: Type.Enum([...HOST_OPERATION_PATHS]),
    input: Type.Unknown(),
  }),
);

function checked<T>(validator: Parser<unknown>, value: T): T {
  validator.Parse(value);

  return value;
}

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

export function decodeCallRequest(input: CallRequest): CallRequest {
  return checked(callRequest, input);
}

export function decodeCallInput<P extends CallPath>(
  path: P,
  input: CallRequest["input"],
): CallInput<P> {
  return CALL_INPUT_SCHEMAS[path].Parse(input);
}

export function decodeBrowserKey(input: BrowserKey): BrowserKey {
  return checked(browserKey, input);
}

const pageBox = strict({
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number({ minimum: 0 }),
  height: Type.Number({ minimum: 0 }),
});

const designPageMessage = Type.Union([
  designOff,
  designView,
  strict({
    kind: Type.Literal("pick"),
    id: Type.String({ minLength: 1, maxLength: 64 }),
    selector: Type.String({ minLength: 1, maxLength: DESIGN_PICK_CHARS.selector }),
    text: Type.String({ maxLength: DESIGN_PICK_CHARS.text }),
    region: Type.Optional(pageBox),
    crop: pageBox,
  }),
]);

export type DesignPageMessage = Static<typeof designPageMessage>;

const designPageMessageParser = compile(designPageMessage);

export function decodeDesignPageMessage(input: unknown): DesignPageMessage {
  return designPageMessageParser.Parse(input);
}

const pagePoint = Type.Number({ minimum: -100_000, maximum: 100_000 });

const wheelDelta = Type.Number({ minimum: -WHEEL_DELTA_LIMIT, maximum: WHEEL_DELTA_LIMIT });

/** A wheel the entered page hands back, bounded to what one wheel event can move. */
export const pageWheel = Compile(
  strict({
    x: pagePoint,
    y: pagePoint,
    deltaX: wheelDelta,
    deltaY: wheelDelta,
    zoom: Type.Boolean(),
  }),
);

export const themePreference = Compile(themeSource);

export const browserShown = Compile(strict({ surface: nonEmpty, visible: Type.Boolean() }));

export const browserFocus = Compile(strict({ surface: nonEmpty, focused: Type.Boolean() }));

export const viewedChat = Compile(
  Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
);

export const unsavedEditsHeld = Compile(Type.Boolean());

export const windowWorkspace = Compile(Type.Union([SelectedWorkspaceType, Type.Null()]));

export const terminalNotice = Compile(
  strict({
    title: Type.String({ maxLength: TERMINAL_NOTICE_LIMITS.title }),
    body: Type.String({ maxLength: TERMINAL_NOTICE_LIMITS.body }),
  }),
);
