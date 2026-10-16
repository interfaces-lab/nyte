import type { Plugin } from "@nyte-ai/plugin/core";
import { asId, isJson } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/sdk";
import type {
  BrowserApi,
  ByteReader,
  Page,
  PageOutcome,
  PageSnapshot,
  PageView,
  SessionId,
} from "@nyte-ai/sdk";
import type {
  BrowserActionFailure,
  BrowserActionResult,
  BrowserAgent,
  BrowserOwner,
  BrowserPageState,
} from "./browser-agent.ts";
import { sanitizeLine } from "./browser-report.ts";

function failureOutcome(
  failure: BrowserActionFailure,
  state: BrowserPageState | null,
): PageOutcome {
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
  }
}

function snapshotOf(state: BrowserPageState): PageSnapshot {
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

function sessionBrowser(agent: BrowserAgent, session: SessionId, owner: BrowserOwner): BrowserApi {
  const id = asId<"page">(agent.sessionSurfaceId(session));
  let state: BrowserPageState | null = null;

  const settle = (result: BrowserActionResult): PageOutcome => {
    if (result.kind === "failed") return failureOutcome(result.failure, state);
    state = result.state;

    return { kind: "applied", snapshot: snapshotOf(result.state) };
  };

  const expect = (ref: string) => state?.nodes.find((node) => node.ref === ref)?.name ?? "";

  const script = async (expression: string): Promise<PageOutcome> => {
    const ran = await agent.evaluate({ session, expression });

    if (ran.kind === "threw") return { kind: "refused", reason: "policy" };

    return settle(await agent.wait({ session, until: "load" }));
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

  const page: Page = {
    id,
    view: async () => view(),
    async *watch() {
      yield view();
    },
    async snapshot(input) {
      const result = await agent.snapshot({ session, ref: input?.ref });

      if (result.kind === "failed")
        throw new SdkError("unavailable", `The page cannot be read: ${result.failure.kind}.`);
      state = result.state;

      return snapshotOf(result.state);
    },
    navigate: async (url) => settle(await agent.open({ session, owner, url })),
    back: () => script("history.back()"),
    forward: () => script("history.forward()"),
    reload: () => script("location.reload()"),
    stopLoading: () => script("window.stop()"),
    click: async (input) =>
      settle(
        await agent.click({
          session,
          ref: input.ref,
          expect: expect(input.ref),
          button: input.button,
          double: input.double,
        }),
      ),
    type: async (input) =>
      settle(
        await agent.type({
          session,
          ref: input.ref,
          text: input.text,
          clear: input.clear,
          submit: input.submit,
          expect: expect(input.ref),
        }),
      ),
    press: async (input) => settle(await agent.press({ session, key: input.key, ref: input.ref })),
    scroll: async (input) => settle(await agent.scroll({ session, ...input })),
    async wait(condition) {
      if (condition.kind === "loaded") return settle(await agent.wait({ session, until: "load" }));

      if (condition.kind === "delay")
        return settle(
          await agent.wait({ session, until: "time", seconds: Math.max(0.1, condition.ms / 1000) }),
        );

      return settle(
        await agent.wait({
          session,
          until: condition.present ? "text" : "gone",
          text: condition.text,
        }),
      );
    },
    console: async (input) =>
      (await agent.console({ session, limit: input?.limit ?? 50, clear: input?.clear })).map(
        (entry) => ({
          level: entry.level === "warning" ? "warn" : entry.level === "debug" ? "log" : entry.level,
          text: entry.message,
          at: entry.at,
        }),
      ),
    async capture() {
      const bytes = await agent.capture({ session });

      if (bytes === undefined) throw new SdkError("unavailable", "The page could not be captured.");

      return pngReader(bytes);
    },
    async evaluate(expression, options) {
      const result = await agent.evaluate({ session, expression, ref: options?.ref });

      if (result.kind === "threw") return result;
      const value: unknown = JSON.parse(result.json);

      return { kind: "value", value: isJson(value) ? value : result.json };
    },
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  };

  return {
    async open(input) {
      const outcome = settle(await agent.open({ session, owner, url: input.url }));

      if (outcome.kind !== "applied")
        throw new SdkError("unavailable", `The page did not open: ${outcome.kind}.`);

      return page;
    },
    async adopt(pageId) {
      if (pageId !== id || state === null) throw new SdkError("unknown", "No page has this id.");

      return page;
    },
    list: async () =>
      state === null ? [] : [{ id, url: state.url, title: state.title, holders: 1 }],
    async *watch() {
      yield state === null ? [] : [{ id, url: state.url, title: state.title, holders: 1 }];
    },
  };
}

export function desktopBrowserPlugin(agent: BrowserAgent, home: string): Plugin {
  return {
    id: "desktop-browser",
    activate(api) {
      const session = api.session.sessionId;

      const owner: BrowserOwner =
        api.env.cwd === home ? { kind: "home" } : { kind: "project", path: api.env.cwd };

      const browser = sessionBrowser(agent, session, owner);

      api.wrapEnv((inner) => ({
        identity: inner.identity,
        cwd: inner.cwd,
        files: inner.files,
        exec: (command, options) => inner.exec(command, options),
        close: () => inner.close(),
        browser,
      }));
      api.signal.addEventListener("abort", () => agent.release({ session }), { once: true });
    },
  };
}
