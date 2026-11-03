import { onlyNyteAppHas } from "@nyte-ai/core";
import type { BrowserApi, Page } from "@nyte-ai/core";
import { asId, compile, idSchema, isJson, SdkError } from "@nyte-ai/schema";
import type {
  ActionDeclaration,
  ByteReader,
  Json,
  PageOutcome,
  PageSnapshot,
  PageView,
  SessionId,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import browserTools from "@nyte-ai/plugin/core/browser-tools";
import type { Plugin } from "@nyte-ai/plugin/core";

/**
 * How a host asks its connected clients to act: whether one offers an
 * action now, and asking the one that does, which answers `not_supported`
 * when none does.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface ClientActions {
  offered(action: string): boolean;
  perform(action: string, input: Json, timeoutMs: number): Promise<Json>;
}

/**
 * The action an app offers to drive the page each chat's agent holds in its
 * browser; its input is a `BrowserCall`.
 *
 * @category plugins
 * @since 0.1.0
 */
export const BROWSER_ACTION = {
  name: "browser",
  summary: "Drives the page a chat's agent holds in this app's browser.",
  input: { type: "object" },
} as const satisfies ActionDeclaration;

const PERFORM_MS = 30_000;

const SessionField = idSchema<"session">();

const ref = Type.String();

const OwnerType = Type.Union([
  Type.Object({ kind: Type.Literal("home") }),
  Type.Object({ kind: Type.Literal("project"), path: Type.String() }),
]);

const WaitType = Type.Union([
  Type.Object({ until: Type.Literal("load") }),
  Type.Object({ until: Type.Literal("text"), text: Type.String() }),
  Type.Object({ until: Type.Literal("gone"), text: Type.String() }),
  Type.Object({ until: Type.Literal("time"), seconds: Type.Number() }),
]);

/**
 * What the host asks the browser action to do: one `BrowserAgent` method of
 * the desktop and its input.
 *
 * @category plugins
 * @since 0.1.0
 */
export const BrowserCallType = Type.Union([
  Type.Object({
    method: Type.Literal("open"),
    session: SessionField,
    owner: OwnerType,
    url: Type.String(),
  }),
  Type.Object({ method: Type.Literal("snapshot"), session: SessionField, ref: Type.Optional(ref) }),
  Type.Object({
    method: Type.Literal("click"),
    session: SessionField,
    ref,
    expect: Type.String(),
    button: Type.Optional(Type.Enum(["left", "right", "middle"])),
    double: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    method: Type.Literal("type"),
    session: SessionField,
    ref,
    text: Type.String(),
    expect: Type.String(),
    clear: Type.Optional(Type.Boolean()),
    submit: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    method: Type.Literal("press"),
    session: SessionField,
    key: Type.String(),
    ref: Type.Optional(ref),
  }),
  Type.Object({
    method: Type.Literal("scroll"),
    session: SessionField,
    direction: Type.Enum(["up", "down", "top", "bottom"]),
    ref: Type.Optional(ref),
    pages: Type.Optional(Type.Number()),
  }),
  Type.Object({ method: Type.Literal("wait"), session: SessionField, wait: WaitType }),
  Type.Object({
    method: Type.Literal("console"),
    session: SessionField,
    limit: Type.Integer({ minimum: 1 }),
    clear: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    method: Type.Literal("evaluate"),
    session: SessionField,
    expression: Type.String(),
    ref: Type.Optional(ref),
  }),
  Type.Object({ method: Type.Literal("capture"), session: SessionField }),
  Type.Object({ method: Type.Literal("release"), session: SessionField }),
]);

export type BrowserCall = Static<typeof BrowserCallType>;

const PageStateType = Type.Object({
  url: Type.String(),
  title: Type.String(),
  loading: Type.Boolean(),
  snapshot: Type.Number(),
  nodes: Type.Array(
    Type.Object({
      ref: Type.String(),
      role: Type.String(),
      name: Type.String(),
      editable: Type.Optional(Type.Boolean()),
    }),
  ),
});

type PageState = Static<typeof PageStateType>;

const FailureType = Type.Object({
  kind: Type.Enum([
    "stale_document",
    "unknown_ref",
    "detached",
    "not_visible",
    "occluded",
    "no_window",
    "closed",
    "crashed",
  ]),
});

type Failure = Static<typeof FailureType>;

const ActionAnswerType = Type.Union([
  Type.Object({ kind: Type.Literal("ok"), state: PageStateType }),
  Type.Object({ kind: Type.Literal("failed"), failure: FailureType }),
]);

type ActionAnswer = Static<typeof ActionAnswerType>;

const EvaluateAnswerType = Type.Union([
  Type.Object({ kind: Type.Literal("value"), json: Type.String() }),
  Type.Object({ kind: Type.Literal("threw"), message: Type.String() }),
]);

const ConsoleAnswerType = Type.Array(
  Type.Object({
    level: Type.Enum(["error", "warning", "info", "debug"]),
    message: Type.String(),
    at: Type.Number(),
  }),
);

const CaptureAnswerType = Type.Union([Type.Null(), Type.Object({ png: Type.String() })]);

const answers = {
  action: compile(ActionAnswerType),
  evaluate: compile(EvaluateAnswerType),
  console: compile(ConsoleAnswerType),
  capture: compile(CaptureAnswerType),
};

const UNICODE_FORGERY = /[\u2028\u2029\u202a-\u202e]/g;

// oxlint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f-\x9f]/g;

/**
 * Returns page text fit for one line of a tool result: no control
 * characters and no characters that reorder or break lines.
 *
 * @category plugins
 * @since 0.1.0
 */
export function sanitizeLine(text: string): string {
  return text.replace(CONTROL_CHARACTERS, "").replace(UNICODE_FORGERY, "");
}

/**
 * Returns the id of the page a session's agent holds in an app's browser.
 *
 * @category plugins
 * @since 0.1.0
 */
export function sessionSurfaceId(sessionId: SessionId): string {
  return `stage:session:${encodeURIComponent(sessionId)}`;
}

/**
 * The browser tools, served by the connected app that offers
 * `BROWSER_ACTION`: each session's page is the one its agent holds in that
 * app. With no app connected that offers it, every tool answers that only
 * Nyte.app has the browser.
 *
 * @category plugins
 * @since 0.1.0
 */
export function clientBrowserPlugins(actions: ClientActions, home: string): readonly Plugin[] {
  return [
    browserTools,
    {
      id: "client-browser",
      activate(api) {
        const owner =
          api.env.cwd === home
            ? { kind: "home" as const }
            : { kind: "project" as const, path: api.env.cwd };

        const browser = sessionBrowser(actions, api.session.sessionId, owner);

        api.wrapEnv((inner) => ({
          identity: inner.identity,
          cwd: inner.cwd,
          files: inner.files,
          exec: (command, options) => inner.exec(command, options),
          close: () => inner.close(),
          browser,
        }));
        api.signal.addEventListener(
          "abort",
          () => {
            if (actions.offered(BROWSER_ACTION.name))
              void ask(actions, { method: "release", session: api.session.sessionId }).catch(
                () => undefined,
              );
          },
          { once: true },
        );
      },
    },
  ];
}

function sessionBrowser(
  actions: ClientActions,
  session: SessionId,
  owner: Static<typeof OwnerType>,
): BrowserApi {
  const id = asId<"page">(sessionSurfaceId(session));
  let state: PageState | null = null;

  const act = async (call: BrowserCall): Promise<ActionAnswer> =>
    decode(answers.action, await ask(actions, call));

  const settle = (answer: ActionAnswer): PageOutcome => {
    if (answer.kind === "failed") return failureOutcome(answer.failure, state);
    state = answer.state;

    return { kind: "applied", snapshot: toPageSnapshot(answer.state) };
  };

  const expect = (target: string) => state?.nodes.find((node) => node.ref === target)?.name ?? "";

  const script = async (expression: string): Promise<PageOutcome> => {
    const ran = decode(
      answers.evaluate,
      await ask(actions, { method: "evaluate", session, expression }),
    );

    if (ran.kind === "threw") return { kind: "refused", reason: "policy" };

    return settle(await act({ method: "wait", session, wait: { until: "load" } }));
  };

  const view = (): PageView => ({
    id,
    url: sanitizeLine(state?.url ?? ""),
    title: sanitizeLine(state?.title ?? ""),
    loading: state?.loading ?? false,
    revision: asId(String(state?.snapshot ?? 0)),
    canGoBack: false,
    canGoForward: false,
  });

  const pages = () => {
    offeredOrThrow(actions);

    return state === null ? [] : [{ id, url: state.url, title: state.title, holders: 1 }];
  };

  const page: Page = {
    id,
    view: async () => view(),
    async *watch() {
      yield view();
    },
    async snapshot(input) {
      const answer = await act({ method: "snapshot", session, ref: input?.ref });

      if (answer.kind === "failed")
        throw new SdkError("unavailable", `The page cannot be read: ${answer.failure.kind}.`);
      state = answer.state;

      return toPageSnapshot(answer.state);
    },
    navigate: async (url) => settle(await act({ method: "open", session, owner, url })),
    back: () => script("history.back()"),
    forward: () => script("history.forward()"),
    reload: () => script("location.reload()"),
    stopLoading: () => script("window.stop()"),
    click: async (input) =>
      settle(
        await act({
          method: "click",
          session,
          ref: input.ref,
          expect: expect(input.ref),
          button: input.button,
          double: input.double,
        }),
      ),
    type: async (input) =>
      settle(
        await act({
          method: "type",
          session,
          ref: input.ref,
          text: input.text,
          clear: input.clear,
          submit: input.submit,
          expect: expect(input.ref),
        }),
      ),
    press: async (input) =>
      settle(await act({ method: "press", session, key: input.key, ref: input.ref })),
    scroll: async (input) =>
      settle(
        await act({
          method: "scroll",
          session,
          direction: input.direction,
          ref: input.ref,
          pages: input.pages,
        }),
      ),
    async wait(condition) {
      if (condition.kind === "loaded")
        return settle(await act({ method: "wait", session, wait: { until: "load" } }));

      if (condition.kind === "delay")
        return settle(
          await act({
            method: "wait",
            session,
            wait: { until: "time", seconds: Math.max(0.1, condition.ms / 1000) },
          }),
        );

      return settle(
        await act({
          method: "wait",
          session,
          wait: { until: condition.present ? "text" : "gone", text: condition.text },
        }),
      );
    },
    async console(input) {
      const entries = decode(
        answers.console,
        await ask(actions, {
          method: "console",
          session,
          limit: input?.limit ?? 50,
          clear: input?.clear,
        }),
      );

      return entries.map((entry) => ({
        level: entry.level === "warning" ? "warn" : entry.level === "debug" ? "log" : entry.level,
        text: entry.message,
        at: entry.at,
      }));
    },
    async capture() {
      const captured = decode(answers.capture, await ask(actions, { method: "capture", session }));

      if (captured === null) throw new SdkError("unavailable", "The page could not be captured.");

      return pngReader(Uint8Array.fromBase64(captured.png));
    },
    async evaluate(expression, options) {
      const result = decode(
        answers.evaluate,
        await ask(actions, { method: "evaluate", session, expression, ref: options?.ref }),
      );

      if (result.kind === "threw") return result;
      const value: unknown = JSON.parse(result.json);

      return { kind: "value", value: isJson(value) ? value : result.json };
    },
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  };

  return {
    async open(input) {
      const outcome = settle(await act({ method: "open", session, owner, url: input.url }));

      if (outcome.kind !== "applied")
        throw new SdkError("unavailable", `The page did not open: ${outcome.kind}.`);

      return page;
    },
    async adopt(pageId) {
      offeredOrThrow(actions);

      if (pageId !== id || state === null) throw new SdkError("unknown", "No page has this id.");

      return page;
    },
    list: async () => pages(),
    async *watch() {
      yield pages();
    },
  };
}

async function ask(actions: ClientActions, call: BrowserCall): Promise<Json> {
  offeredOrThrow(actions);
  const input: unknown = JSON.parse(JSON.stringify(call));

  if (!isJson(input)) throw new SdkError("internal", "A browser call did not encode as JSON.");

  return actions.perform(BROWSER_ACTION.name, input, PERFORM_MS).catch((error: unknown) => {
    if (error instanceof SdkError && error.code === "not_supported") throw unavailable();

    throw error;
  });
}

function offeredOrThrow(actions: ClientActions): void {
  if (!actions.offered(BROWSER_ACTION.name)) throw unavailable();
}

function unavailable(): SdkError {
  return new SdkError("unavailable", onlyNyteAppHas("The browser", [browserTools.id]));
}

function decode<T>(checker: { Check(value: unknown): value is T }, value: Json): T {
  if (!checker.Check(value))
    throw new SdkError("invalid", "The app answered a browser call with something unreadable.");

  return value;
}

function failureOutcome(failure: Failure, state: PageState | null): PageOutcome {
  switch (failure.kind) {
    case "stale_document":
      return { kind: "stale", revision: asId(String(state?.snapshot ?? 0)) };
    case "unknown_ref":
    case "detached":
      return { kind: "refused", reason: "unknown-ref" };
    case "occluded":
      return { kind: "refused", reason: "occluded" };
    case "not_visible":
    case "no_window":
      return { kind: "refused", reason: "not-visible" };
    case "closed":
      return { kind: "closed", reason: "released" };
    case "crashed":
      return { kind: "closed", reason: "crashed" };
    default: {
      const _exhaustive: never = failure.kind;

      return _exhaustive;
    }
  }
}

function toPageSnapshot(state: PageState): PageSnapshot {
  return {
    revision: asId(String(state.snapshot)),
    nodes: state.nodes.map((node) => ({
      ref: node.ref,
      role: sanitizeLine(node.role),
      name: sanitizeLine(node.name),
      editable: node.editable === true,
      depth: 0,
    })),
  };
}

function pngReader(bytes: Uint8Array): ByteReader {
  return {
    size: bytes.byteLength,
    mime: "image/png",
    async *chunks() {
      yield bytes;
    },
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  };
}
