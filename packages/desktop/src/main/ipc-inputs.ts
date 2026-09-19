/**
 * Main is the only Electron process that compiles validators: `Compile` emits
 * code through `new Function`, which the renderer's CSP forbids. Renderer code
 * imports `typebox/value` and never `typebox/compile`.
 */
import {
  BROWSER_ACTIONS,
  CONTEXT_MENU_ROLES,
  HOST_OPERATION_PATHS,
  SDK_OPERATION_PATHS,
} from "../shared/ipc.ts";
import { Type } from "typebox";
import { WorkspaceSearchSchema } from "@nyte-ai/protocol";
import type { Static, TProperties, TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { ParseError } from "typebox/value";
import { ExpectedHostError } from "./errors.ts";
import { OPERATIONS, schemas } from "@nyte-ai/protocol";
import { sessionId } from "../shared/schemas.ts";
import type {
  BrowserBoundsMessage,
  CallInput,
  CallPath,
  CallRequest,
  WatchStartInput,
  WorkspaceEditorInput,
  WorkspaceEditorOperation,
  WorkspaceEditorRequest,
} from "../shared/ipc.ts";

interface Parser<T> {
  Parse(value: unknown): T;
}

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

const id = Type.String();
const nonEmpty = Type.String({ minLength: 1 });
/** A renderer-chosen correlation ID; bounded so it cannot carry a payload. */
const loginAttempt = Type.String({ minLength: 1, maxLength: 64 });
const thinkingLevel = schemas.ThinkingLevel;
const noInput = Type.Optional(Type.Undefined());
const model = strict({ provider: nonEmpty, id: nonEmpty });
const fileVersion = Type.String({ pattern: "^[a-f0-9]{64}$" });
/** A local calendar day. Anything else would fold history onto the wrong dates. */
const usageDay = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
/** A commit-ish the renderer names. A leading `-` would read as a git option. */
const revision = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._/^~@{}-]*$",
});

export const WORKSPACE_EDITOR_INPUT_SCHEMAS = {
  search: compile(
    strict({
      requestId: Type.String({ minLength: 1, maxLength: 128 }),
      ...WorkspaceSearchSchema.properties,
    }),
  ),
  cancelSearch: compile(strict({ requestId: Type.String({ minLength: 1, maxLength: 128 }) })),
  blame: compile(strict({ path: nonEmpty })),
  format: compile(
    strict({
      path: nonEmpty,
      contents: Type.String({ maxLength: 2_000_000 }),
      version: fileVersion,
    }),
  ),
} satisfies { readonly [P in WorkspaceEditorOperation]: Parser<WorkspaceEditorInput<P>> };

const workspaceEditorRequest = compile(
  strict({
    operation: Type.Enum(["search", "cancelSearch", "blame", "format"]),
    input: Type.Unknown(),
  }),
);

export function decodeWorkspaceEditorRequest(
  input: WorkspaceEditorRequest,
): WorkspaceEditorRequest {
  return checked(workspaceEditorRequest, input);
}

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
  "workspace.vcs.diff": compile(OPERATIONS["workspace.vcs.diff"].input),
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
  "host.usage": compile(
    // `sinceDay: null` is all time, the one window whose start the page cannot
    // name before reading.
    strict({ sinceDay: Type.Union([usageDay, Type.Null()]), untilDay: usageDay }),
  ),
  "host.accountLimits": compile(noInput),
  "host.login": compile(
    strict({
      provider: Type.String(),
      method: Type.Union([
        strict({ kind: Type.Literal("browser") }),
        // A key must hold something other than whitespace.
        strict({ kind: Type.Literal("api_key"), key: Type.String({ pattern: "\\S" }) }),
      ]),
      attempt: loginAttempt,
    }),
  ),
  "host.cancelLogin": compile(strict({ attempt: loginAttempt })),
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
  "host.vcs.contents": compile(strict({ path: nonEmpty, base: Type.Enum(["head", "index"]) })),
  "host.vcs.diff": compile(
    Type.Union([
      strict({
        scope: Type.Enum(["worktree", "staged", "unstaged"]),
        paths: Type.Optional(Type.Array(nonEmpty, { maxItems: 1000 })),
        ignoreWhitespace: Type.Optional(Type.Boolean()),
      }),
      strict({
        scope: Type.Literal("commit"),
        commit: revision,
        paths: Type.Optional(Type.Array(nonEmpty, { maxItems: 1000 })),
        ignoreWhitespace: Type.Optional(Type.Boolean()),
      }),
    ]),
  ),
  "host.vcs.log": compile(
    strict({
      limit: Type.Integer({ minimum: 1, maximum: 1000 }),
      before: Type.Optional(revision),
    }),
  ),
  "host.vcs.refs": compile(noInput),
  "host.vcs.revert": compile(
    strict({ paths: Type.Array(nonEmpty, { minItems: 1, maxItems: 1000 }) }),
  ),
  "host.vcs.stage": compile(
    strict({
      paths: Type.Array(nonEmpty, { minItems: 1, maxItems: 1000 }),
      staged: Type.Boolean(),
    }),
  ),
  "host.vcs.commit": compile(
    strict({
      // A message of only whitespace never reaches git.
      message: Type.String({ minLength: 1, maxLength: 20_000, pattern: "\\S" }),
      all: Type.Optional(Type.Boolean()),
      paths: Type.Optional(Type.Array(nonEmpty, { maxItems: 1000 })),
    }),
  ),
  "host.vcs.createBranch": compile(
    strict({
      // `git check-ref-format` is the real check; this only bounds the operand.
      name: Type.String({ minLength: 1, maxLength: 255 }),
      checkout: Type.Boolean(),
    }),
  ),
  "host.vcs.push": compile(strict({ setUpstream: Type.Optional(Type.Boolean()) })),
  "host.vcs.createPullRequest": compile(
    strict({
      title: Type.String({ minLength: 1, maxLength: 512, pattern: "\\S" }),
      body: Type.Optional(Type.String({ maxLength: 65_536 })),
      draft: Type.Optional(Type.Boolean()),
    }),
  ),
  "host.files.list": compile(strict({ requestId: Type.String({ minLength: 1, maxLength: 128 }) })),
  "host.files.cancelList": compile(
    strict({ requestId: Type.String({ minLength: 1, maxLength: 128 }) }),
  ),
  "host.files.read": compile(strict({ path: nonEmpty })),
  "host.files.save": compile(
    strict({
      path: nonEmpty,
      contents: Type.String({ maxLength: 2_000_000 }),
      version: fileVersion,
    }),
  ),
  "host.github.state": compile(noInput),
  "host.github.signIn": compile(noInput),
  "host.github.signOut": compile(noInput),
  "host.server.state": compile(noInput),
  "host.server.connect": compile(strict({ baseUrl: nonEmpty, token: nonEmpty })),
  "host.server.disconnect": compile(noInput),
  "host.server.createSession": compile(noInput),
  "host.mobile.state": compile(noInput),
  "host.mobile.start": compile(
    strict({ reach: Type.Union([Type.Literal("simulator"), Type.Literal("tailnet")]) }),
  ),
  "host.mobile.stop": compile(noInput),
  "host.openExternal": compile(strict({ url: Type.String() })),
  "host.revealPath": compile(strict({ path: nonEmpty })),
  "host.contextMenu": compile(
    strict({
      items: Type.Array(
        Type.Union([
          strict({ kind: Type.Literal("separator") }),
          strict({
            kind: Type.Literal("role"),
            role: Type.Enum(CONTEXT_MENU_ROLES),
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
  "host.browser.captureFrame": compile(strict({ surface: nonEmpty })),
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

export const themePreference = Compile(
  Type.Union([Type.Literal("system"), Type.Literal("light"), Type.Literal("dark")]),
);
