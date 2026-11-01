import { asId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { HostEndpoint } from "@nyte-ai/app/contract/connection.ts";
import type {
  HostState,
  LocalFontCatalog,
  NyteBridge,
  SelectedWorkspace,
} from "@nyte-ai/app/contract/bridge.ts";
import { installBridge } from "@nyte-ai/app/contract/nyte.ts";

export const workspace = {
  id: asId<"workspace">("lab"),
  path: "/Users/lab/nyte",
  name: "nyte",
} satisfies SelectedWorkspace;

const host = { workspace } satisfies HostState;

const fonts = { sans: [], monospace: [] } satisfies LocalFontCatalog;

const Endpoint = Type.Object({
  url: Type.String(),
  credentials: Type.Object({ kind: Type.Literal("token"), token: Type.String() }),
});

/**
 * The bridge's plain values, which the interface reads without calling. `host.fetch` and
 * `host.remember` are absent, as in a browser, so the SDK uses the page's own fetch.
 */
const fields = new Map<string, unknown>([
  ["platform", "darwin"],
  ["machineName", "Lab"],
  ["host.fetch", undefined],
  ["host.remember", undefined],
]);

/**
 * What the lab's host answers. `host.endpoint` points at the lab's own core, which the dev server
 * opens on first use; everything else desktop-only stays unanswered.
 */
const answers = new Map<string, () => Promise<unknown>>([
  ["host.state", async () => host],
  ["host.setThemePreference", async () => undefined],
  ["host.fonts", async () => fonts],
  ["host.endpoint", () => fetch("/core/endpoint").then(readEndpoint)],
]);

async function readEndpoint(response: Response): Promise<HostEndpoint> {
  if (!response.ok) throw new Error(`The lab's core did not open: ${await response.text()}`);

  const endpoint: unknown = await response.json();

  if (!Value.Check(Endpoint, endpoint)) throw new Error("The lab's core sent no endpoint.");

  return endpoint;
}

function bridge(path: string): () => void {
  return new Proxy(function host() {}, {
    get: (_target, key) => {
      if (key === "then") return undefined;

      const next = path === "" ? String(key) : `${path}.${String(key)}`;

      if (fields.has(next)) return fields.get(next);

      return bridge(next);
    },
    apply: () => {
      if (/(^|\.)(on[A-Z]\w*|watch)$/.test(path)) return () => {};

      const answer = answers.get(path);

      return answer === undefined
        ? Promise.reject(new Error(`The lab has no host for ${path}`))
        : answer();
    },
  });
}

declare global {
  interface Window {
    readonly nyte: NyteBridge;
  }
}

Object.defineProperty(window, "nyte", { value: bridge(""), configurable: true });

installBridge(window.nyte);
