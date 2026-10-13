import { asId } from "@nyte-ai/schema";
import type { HostState, NyteBridge, SelectedWorkspace } from "@nyte-ai/app/bridge.ts";
import { installBridge } from "@nyte-ai/app/nyte.ts";

/*
 * `theme/boot.ts` reads the bridge while its module evaluates, so the fixture
 * has to be installed before anything that imports it loads. Import this
 * first.
 *
 * Host reads with a fixture answer; every other call rejects.
 */
export const workspace = {
  id: asId<"workspace">("lab"),
  path: "/Users/lab/nyte",
  name: "nyte",
} satisfies SelectedWorkspace;

const host = { workspace, platform: "darwin" } satisfies HostState;

const answers = new Map<string, unknown>([
  ["host.state", host],
  ["host.setThemePreference", undefined],
]);

function bridge(path: string): () => void {
  return new Proxy(function host() {}, {
    get: (_target, key) =>
      key === "then" ? undefined : bridge(path === "" ? String(key) : `${path}.${String(key)}`),
    apply: () => {
      if (/(^|\.)(on[A-Z]\w*|watch)$/.test(path)) return () => {};

      return answers.has(path)
        ? Promise.resolve(answers.get(path))
        : Promise.reject(new Error(`The lab has no host for ${path}`));
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
