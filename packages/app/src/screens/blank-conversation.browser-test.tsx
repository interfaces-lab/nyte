/**
 * A new chat's first send made before the host connects. The draft owns the
 * send: remounting the screen or parking the draft keeps it, the host's
 * arrival starts each held draft once, the chat opens only in the pane that
 * shows its draft, and a refusal stays on the draft across a remount.
 */
import "../../test/window-bridge.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterContextProvider } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { ModelCatalogView, ModelInfo, SessionId } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { activeSelection } from "../layout/pane-layout.ts";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { PaneController } from "../layout/pane-controller.ts";
import { SessionDndProvider } from "../layout/session-dnd.tsx";
import { keys, queryClient } from "../queries.ts";
import { installConnection } from "../sdk.tsx";
import { createAppRouter } from "../router.tsx";
import { ThreadScreen } from "./thread.tsx";
import "../theme/tokens.stylex.ts";
import { scriptedConnection } from "../../test/scripted-connection.ts";
import { sessionRow } from "../../test/view-fixtures.ts";

const MODEL: ModelInfo = {
  ref: { provider: "test", id: "test" },
  name: "Scripted",
  reasoning: false,
  thinking: ["off"],
  defaultThinking: "off",
  fast: null,
  contextWindow: 1_000,
  compactAt: 900,
  maxOutput: 100,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function catalog(credential: "configured" | "missing"): ModelCatalogView {
  return {
    generation: asId<"catalog-generation">(`live-${credential}`),
    default: MODEL.ref,
    providers: [{ id: "test", name: "Test", credential, methods: [], limits: [], models: [MODEL] }],
  };
}

const panes = new PaneController({ storageKey: "blank-conversation-test" });

const failures: string[] = [];

let renderFailure: unknown;

let hostCatalog = catalog("configured");

const refuse = async (): Promise<never> => {
  throw new Error("Not scripted.");
};

const starts: SessionId[] = [];

function expectRule(passed: boolean, message: string): void {
  if (!passed) failures.push(message);
}

function mount(container: HTMLElement): Root {
  const root = createRoot(container, {
    onUncaughtError: (error) => {
      renderFailure = error;
    },
  });

  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ["/"] }) });

  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <TooltipProvider delay={0} closeDelay={0} timeout={0}>
            <PaneControllerProvider controller={panes}>
              <SessionDndProvider>
                <ThreadScreen />
              </SessionDndProvider>
            </PaneControllerProvider>
          </TooltipProvider>
        </RouterContextProvider>
      </QueryClientProvider>,
    ),
  );

  return root;
}

async function until<T>(read: () => T | null | undefined | false, what: string): Promise<T> {
  const deadline = performance.now() + 5_000;

  for (;;) {
    if (renderFailure !== undefined) throw renderFailure;
    const value = read();

    if (value !== null && value !== undefined && value !== false) return value;

    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

function painted(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => window.setTimeout(() => resolve(), 0)),
  );
}

async function send(container: HTMLElement, text: string): Promise<void> {
  const editor = await until(
    () => container.querySelector<HTMLElement>("[data-placeholder]"),
    "the editor",
  );

  await painted();
  editor.focus();
  document.execCommand("insertText", false, text);
  await painted();

  const button = await until(() => {
    const found = container.querySelector<HTMLButtonElement>("button[aria-label='Send message']");

    return found?.disabled === false ? found : null;
  }, "an enabled Send button");

  button.click();
}

function statusText(container: HTMLElement): string | undefined {
  return container.querySelector("[role='status']")?.textContent ?? undefined;
}

function connect(ids: readonly SessionId[]): void {
  const scripted = scriptedConnection({
    sessions: ids.map((id) => sessionRow(id)),
    models: { list: async () => hostCatalog },
    session: () => ({
      watch: async function* () {
        yield* [];
        throw new Error("No view in this fixture.");
      },
    }),
  });

  installConnection({
    ...scripted.connection,
    sessions: {
      ...scripted.connection.sessions,
      start: async (input) => {
        const id = input.id ?? asId<"session">("unnamed");
        starts.push(id);

        return {
          session: scripted.connection.session(id),
          receipt: {
            id: asId<"receipt">(id),
            message: asId<"message">(id),
            status: refuse,
            settled: refuse,
            stop: refuse,
            landed: refuse,
          },
        };
      },
    },
  });
}

async function checkSends(): Promise<string> {
  queryClient.clear();
  queryClient.setQueryData(keys.host, { workspace: undefined });
  queryClient.setQueryData(keys.modelCatalog("initial"), catalog("configured"), { updatedAt: 0 });
  queryClient.setQueryData(keys.mentionFiles, []);
  const container = document.createElement("div");
  container.style.cssText = "display:flex;width:900px;height:700px";
  document.body.append(container);
  let root = mount(container);

  try {
    await send(container, "Parked before the host");
    const parked = panes.viewState.readBlank("primary").id;
    await until(() => statusText(container)?.includes("Sends when Nyte connects"), "the hold");
    panes.newChat();

    await send(container, "Shown when the host arrives");
    const shown = panes.viewState.readBlank("primary").id;
    await until(() => statusText(container)?.includes("Sends when Nyte connects"), "the hold");
    flushSync(() => root.unmount());
    root = mount(container);
    await painted();
    expectRule(
      statusText(container)?.includes("Sends when Nyte connects") === true,
      "a remount dropped the held send",
    );

    connect([asId<"session">(parked), asId<"session">(shown)]);
    await until(
      () => starts.length === 2 && panes.viewState.readDraft(shown) === undefined,
      "both starts",
    );
    await painted();
    expectRule(
      starts.toSorted().join() === [parked, shown].toSorted().join(),
      `each held draft starts once: ${starts.join()}`,
    );
    const selection = activeSelection(panes.getSnapshot().layout);
    expectRule(
      selection.kind === "session" && selection.sessionId === shown,
      `the chat opens in the pane that shows its draft: ${JSON.stringify(selection)}`,
    );
    expectRule(panes.viewState.readDraft(parked) === undefined, "the parked draft stayed a draft");

    panes.newChat();
    await painted();
    hostCatalog = catalog("missing");
    await send(container, "On a model the host no longer lists");
    const refused = panes.viewState.readBlank("primary").id;
    await until(() => container.querySelector("[role='alert']"), "the refusal");
    flushSync(() => root.unmount());
    root = mount(container);
    const alert = await until(() => container.querySelector("[role='alert']"), "the refusal");
    expectRule(
      alert.textContent?.includes("test isn’t available") === true,
      `the refusal names the model: ${alert.textContent ?? ""}`,
    );
    expectRule(starts.length === 2, "a refused draft reached sessions.start");
    expectRule(
      panes.viewState.readDraft(refused)?.composer.draft === "On a model the host no longer lists",
      "the refused draft lost its text",
    );

    const choose = await until(
      () =>
        Array.from(alert.querySelectorAll("button")).find(
          (button) => button.textContent === "Choose Model",
        ),
      "Choose Model",
    );

    choose.click();
    await until(() => document.querySelector("[role='menu']"), "the model menu");

    return failures.length === 0 ? "passed" : failures.join("\n");
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}

export function run(): Promise<string> {
  const watchdog = new Promise<string>((resolve) =>
    window.setTimeout(() => resolve(`timed out\n${failures.join("\n")}`), 30_000),
  );

  return Promise.race([checkSends(), watchdog]);
}
