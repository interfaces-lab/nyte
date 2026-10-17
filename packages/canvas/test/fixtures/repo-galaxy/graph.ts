/** The graph the galaxy draws: every module of packages/core/src, the packages it imports, and each import between them. */

/** Every non-test module under packages/core/src, one per token: path:lines:exports. */
const MODULES =
  "agent/agent-loop.ts:372:11 agent/compaction.ts:875:5 agent/request.ts:372:8 agent/tool-runner.ts:832:7 agent/transcript.ts:782:3 agent/turn.ts:928:1 api/connection.ts:203:2 api/head.ts:352:5 api/host.ts:92:2 api/part-schema.ts:55:4 api/part.ts:665:3 api/server.ts:52:1 api/session.ts:653:5 builtins/delegation.ts:426:1 builtins/environment.ts:448:1 builtins/mcp.ts:80:1 builtins/system-prompt.ts:30:1 compose.ts:620:5 contract/fold.ts:244:19 contract/host.ts:326:26 contract/kernel.ts:504:31 contract/parts.ts:221:18 contract/plugin.ts:352:29 contract/records.ts:361:28 contract/server.ts:133:4 contract/session.ts:166:6 contract/store.ts:62:5 contract/tools.ts:71:3 contract/workspace.ts:720:35 drive/execution.ts:864:6 engine/admission.ts:842:4 engine/batches.ts:251:3 engine/branch-summary.ts:247:3 engine/contributions.ts:38:4 engine/durable.ts:618:11 engine/fence.ts:142:5 engine/jobs.ts:707:4 engine/lease.ts:61:2 engine/mentions.ts:40:1 engine/move.ts:332:2 engine/part-definitions.ts:33:2 engine/principals.ts:237:6 engine/receipts.ts:326:7 engine/runs.ts:330:5 engine/waits.ts:629:9 env/browser.ts:211:2 env/environment.ts:427:6 env/mcp.ts:85:3 env/trust.ts:85:4 env/workspaces.ts:619:5 extend/activation.ts:97:1 extend/hooks.ts:359:2 extend/models.ts:638:6 extend/plugin-api.ts:237:4 extend/plugin-runtime.ts:932:5 extend/registry.ts:493:5 extend/resources.ts:513:5 extend/setting-layers.ts:134:3 extend/settings.ts:214:4 fold/bus.ts:60:1 fold/calls.ts:184:2 fold/commit.ts:137:5 fold/draft.ts:237:19 fold/fold.ts:867:3 fold/paths.ts:188:1 fold/project.ts:189:3 fold/reads.ts:55:3 fold/seen.ts:115:1 fold/view.ts:134:3 fold/watch.ts:657:4 harness.ts:337:16 index.ts:133:19 server.ts:14:7 store.ts:70:10 store/inspect.ts:201:1 store/log.ts:52:5 store/memory-store.ts:213:1 store/migrations.ts:633:12 store/model-state.ts:251:3 store/parts.ts:252:9 store/refs.ts:85:16 store/session-index.ts:89:3 store/session.ts:429:36 store/wait-index.ts:103:10 testing.ts:16:8 util/callable.ts:5:1 util/content.ts:30:3 util/dev-log.ts:144:2 util/iterable.ts:196:4 util/json-schema.ts:65:3 util/line-diff.ts:216:1 util/process-environment.ts:22:2 util/text.ts:8:1 util/trace.ts:196:15 util/usage.ts:34:2";

/** The workspace packages core imports; their ids follow the files'. */
export const PACKAGES: readonly string[] = ["@nyte-ai/schema", "@nyte-ai/ai", "typebox"];

/** One import per token: importer.imported.line, with a trailing t when it is type-only. */
const IMPORTS =
  "0.95.1t 0.96.18t 1.95.1 1.96.29t 1.19.31 1.20.32t 1.21.39 1.23.40 1.33.42 1.52.43 1.61.44 1.66.45 1.79.46 1.80.47 1.82.48 1.87.62 1.89.63 1.92.64 1.2.65 1.94.66 1.4.67 1.26.68t 2.95.1 2.96.24 2.19.29 2.20.30t 2.23.31 2.52.33 2.61.34 2.80.35 2.82.36 2.87.37 2.89.38 2.94.39 3.97.1 3.95.3 3.19.32 3.20.34t 3.21.35 3.23.37 3.27.39t 3.28.40t 3.34.41 3.43.42 3.55.43 3.61.44 3.79.45 3.80.46 3.82.47 3.87.58 3.89.59 3.26.60t 4.95.1 4.96.28t 4.19.30 4.20.31t 4.21.32 4.22.33t 4.23.34 4.28.36t 4.66.37 4.80.38 4.82.39 4.89.46 4.26.47t 4.56.48 4.55.49 5.95.1 5.96.18t 5.19.20 5.20.22t 5.23.29 5.34.31 5.35.32 5.47.33 5.43.34 5.52.35 5.61.36 5.66.37 5.79.38 5.80.39 5.82.40 5.87.42 5.0.43 5.1.52 5.2.53 5.3.54 5.4.56 5.93.57 5.94.58 6.95.1 6.19.3 6.20.11t 6.22.12t 6.25.13t 6.28.14t 6.29.15 6.41.16 6.49.17 6.58.18 6.74.19 6.8.20 6.12.21 7.95.1 7.18.16t 7.19.17t 7.20.18t 7.23.19t 7.25.20t 7.30.21 7.39.22 7.58.23 7.61.24 7.66.25 7.68.26 7.80.27 7.82.28 7.92.47 8.95.1t 8.19.2t 8.20.3t 8.88.4 9.21.1t 9.89.8 10.95.1 10.19.11 10.20.13t 10.21.14t 10.23.23 10.34.25 10.40.27 10.61.28 10.79.29 10.80.30 10.82.31 10.85.43 10.86.44 10.89.45 10.9.46 11.20.1t 11.24.2t 11.29.3 11.31.4 11.39.5 11.41.6 11.42.7 11.80.8 12.95.1 12.19.22t 12.20.23t 12.21.24t 12.23.25 12.25.27t 12.30.28 12.33.29 12.34.30 12.35.31 12.42.32 12.43.33 12.44.34 12.55.35 12.56.36 12.58.37 12.61.38 12.79.39 12.80.40 12.82.41 12.88.53 12.7.54 12.10.55 12.26.56t 13.97.1 13.95.2 13.21.13 13.22.14t 13.25.15t 13.27.16t 13.92.17 14.95.1 14.97.3 14.22.4t 14.27.5t 14.28.6t 14.86.7 14.90.8 14.93.9 15.95.1t 15.22.2t 15.28.3t 16.22.1t 17.95.1 17.96.14t 17.1.15 17.2.16 17.3.17 17.5.18 17.6.19 17.8.20 17.11.21 17.10.22 17.12.23 17.13.24 17.14.25 17.15.26 17.16.27 17.18.28t 17.19.29 17.20.31t 17.21.40t 17.24.41t 17.22.42t 17.23.43 17.26.45t 17.28.46t 17.29.53 17.36.54 17.40.55 17.41.56 17.44.57 17.45.58 17.46.59 17.47.60 17.49.61 17.52.62 17.53.63 17.54.64 17.55.71 17.56.72 17.57.73 17.58.74 17.59.75 17.63.76 17.69.77 17.78.78 17.79.79 17.80.80 17.82.81 17.87.82 18.95.1t 18.23.36t 19.95.1 19.96.44t 19.22.45t 19.25.46t 19.26.47t 19.28.48t 20.95.1t 20.18.37t 20.19.38t 20.21.47t 20.22.48t 20.23.61t 20.25.62t 20.26.63t 20.27.64t 20.28.65t 21.95.1 21.97.23 21.89.24 21.22.25t 21.27.26t 22.95.1t 22.19.29t 22.21.30t 22.25.31t 22.27.32t 22.28.33t 23.95.1 23.97.43 23.25.45t 24.95.1t 24.19.22t 24.21.29t 24.22.30t 24.25.31t 24.28.32t 25.95.1t 25.21.40t 26.95.1t 27.95.1t 27.19.16t 27.25.17t 27.28.18t 28.95.1t 28.19.66t 28.25.67t 28.27.68t 29.95.1 29.96.16 29.3.17 29.18.18t 29.19.19 29.20.20t 29.23.21 29.30.23 29.34.24 29.35.25 29.37.26 29.39.27 29.43.28 29.44.29 29.61.30 29.66.31 29.80.32 29.82.33 29.86.44 29.87.45 29.26.46t 30.95.1 30.18.21t 30.19.22t 30.20.23t 30.23.24t 30.25.25t 30.61.26 30.66.27 30.80.28 30.82.29 30.86.47 30.87.48 30.32.49 30.33.50 30.35.51 30.38.52 30.42.53 30.93.54 30.26.55t 31.95.1 31.20.10t 31.25.11t 31.28.12t 31.61.13 31.82.14 31.86.15 31.42.16 31.44.17 31.26.18t 32.95.1 32.20.13t 32.23.14t 32.61.15 32.66.16 32.80.17 32.82.18 32.35.31 32.26.32t 33.95.1 33.20.3t 34.95.1 34.20.14t 34.23.15 34.27.17t 34.61.18 34.79.19 34.80.20 34.82.21 34.83.22 34.87.23 34.37.24 34.44.25 34.26.26t 35.95.1t 35.20.10t 35.23.11 35.61.12 35.66.13 35.79.14 35.80.15 35.82.16 35.26.26t 36.95.1 36.19.14 36.20.16t 36.28.17t 36.82.18 36.87.19 36.88.20 36.30.21 36.34.22 36.44.23 37.87.1 38.95.1t 38.20.2t 39.95.1 39.20.13t 39.23.14t 39.25.15t 39.61.16 39.66.17 39.80.18 39.82.19 39.86.34 39.32.35 39.35.36 39.42.37 40.95.1t 40.21.2 41.95.1 41.19.3t 41.20.4t 41.23.5 41.61.7 41.80.8 41.82.9 41.26.10t 42.95.1 42.19.12 42.20.13t 42.23.14t 42.25.15t 42.61.16 42.66.17 42.80.18 42.82.19 42.35.28 42.44.29 42.26.30t 43.95.1 43.18.13t 43.19.14 43.20.15t 43.23.16 43.25.18t 43.61.19 43.66.20 43.79.21 43.80.22 43.83.23 43.82.24 43.30.37 43.35.38 43.44.39 43.26.40t 44.95.1 44.20.14t 44.23.15 44.61.17 44.66.19 44.79.20 44.80.21 44.82.22 44.83.23 44.87.35 44.26.36t 45.95.1 45.20.3t 45.28.4t 45.36.5 45.86.6 46.95.1 46.20.3t 46.23.4 46.28.6t 46.31.21 46.80.22 46.82.23 46.45.24 46.26.25t 47.95.1 47.20.3t 47.28.4t 47.82.5 47.46.6 47.48.7 48.20.1t 48.23.2t 48.80.3 48.82.4 48.46.5 49.95.1 49.19.16t 49.20.17t 49.23.18 49.28.20t 49.36.30 49.56.31 49.61.32 49.80.33 49.82.34 49.86.44 49.88.45 49.46.46 49.47.47 49.48.48 49.26.50t 50.95.1t 50.20.2t 50.22.3t 50.46.4 50.48.5 50.49.6 50.82.7 51.95.1 51.97.11 51.19.13 51.20.15t 51.22.23t 51.27.24t 51.34.25 51.82.26 51.87.27 51.53.28 52.95.1 52.96.14t 52.19.24t 52.20.25t 52.22.31t 52.33.32t 52.61.33 52.78.34 52.82.35 52.86.36 52.88.37 52.89.38 52.55.39 53.95.1 53.19.3 53.20.5t 53.22.6t 53.25.7t 53.28.8t 53.61.9 53.80.10 53.82.11 54.95.1 54.19.14 54.20.15t 54.21.26t 54.22.27t 54.28.35t 54.40.36 54.82.37 54.85.38 54.87.39 54.89.40 54.50.41 54.51.42 54.53.43 54.55.44 54.58.45 54.56.46 55.95.1 55.19.14 55.20.16t 55.22.24t 55.30.32 55.82.33 55.85.34 55.89.35 55.53.36 55.57.37 56.95.1 56.97.3 56.20.4t 56.22.5t 56.28.6t 56.46.7 56.48.8 56.80.9 56.82.10 56.87.11 56.26.12t 57.95.1 57.20.3t 57.22.4t 57.80.5 57.82.6 57.89.7 57.26.8t 58.95.1 58.19.9t 58.20.10t 58.22.11t 58.33.12 58.48.13 58.49.14 58.61.15 58.80.16 58.82.17 58.89.18 58.55.19 58.56.20 58.57.21 59.95.1t 59.18.2t 59.87.3 60.95.1 60.18.11t 60.62.12 61.95.1 61.20.10t 61.23.11t 61.80.12 61.82.13 61.87.14 61.69.15 62.95.1 62.18.15t 62.23.16t 62.82.17 63.95.1 63.18.27 63.23.38t 63.82.39 63.60.40 63.62.41 63.64.59 64.95.1t 64.18.2 64.82.4 64.62.5 65.95.1t 65.18.13 65.82.15 65.94.16 65.62.17 66.95.1t 66.18.2t 66.19.3 66.20.4t 66.82.5 67.95.1 67.20.3t 67.23.4 67.80.6 67.82.7 67.87.17 67.61.18 67.66.19 68.95.1t 68.18.11 68.20.13t 68.88.14 68.65.15 68.67.16 69.95.1 69.18.17t 69.20.27t 69.23.28 69.79.29 69.75.30 69.80.31 69.82.32 69.87.33 69.93.34 69.63.35 69.65.36 70.95.1 70.6.15 70.8.16 70.17.17 70.43.18 70.69.19 70.73.20 70.20.21t 70.71.22t 71.19.1 71.21.21 71.22.41t 71.25.72t 71.26.74t 71.27.82t 71.28.84t 71.91.102 71.87.104 71.93.108 71.88.124 71.89.126 71.9.128 71.85.130 71.90.132 72.94.1 72.17.3 72.19.7 72.24.9t 72.28.11t 72.91.13 73.23.1 73.75.28 73.76.36 73.77.38 73.78.48 73.80.50 73.81.67 73.86.69 74.95.1 74.19.12t 74.23.14 74.80.16 74.82.17 74.26.18t 75.95.1 75.80.3 76.95.1 76.26.3t 76.86.4 76.75.5 76.80.6 76.81.7 77.95.1 77.97.11 77.23.13 77.86.14 77.80.15 77.83.16 78.96.1t 78.95.2 78.97.4 78.19.5t 78.23.6 78.26.7t 78.80.8 79.95.1 79.18.15t 79.20.16t 79.21.17 79.23.19 79.89.21 79.80.22 79.82.23 79.26.25t 80.95.1 81.95.1 81.23.3 82.95.1 82.20.19t 82.23.20 82.87.39 82.80.40 82.26.41t 83.95.1 83.23.3t 84.11.1 84.17.3 84.20.5t 84.43.7 84.54.9 84.69.11 84.70.13 86.95.1 88.95.1t 89.95.1 90.95.1t 92.95.1t 94.95.1t";

export const ROOT = "packages/core/src/";

export const FILES = MODULES.split(" ").map((token) => {
  const [path = "", lines = "0", count = "0"] = token.split(":");

  return [path, Number(lines), Number(count)] as const;
});

/** Core's folders, folded into the layers a reader names; root modules are the public API. */
export const LAYERS = [
  { id: "engine", tint: "blue" },
  { id: "api", tint: "pink" },
  { id: "contract", tint: "orange" },
  { id: "fold", tint: "teal" },
  { id: "util", tint: "red" },
  { id: "store", tint: "yellow" },
  { id: "runtime", tint: "purple" },
  { id: "extend", tint: "green" },
  { id: "agent", tint: "brown" },
  { id: "packages", tint: "gray" },
] as const;

export type Import = Readonly<{ from: number; to: number; line: number; typeOnly: boolean }>;

export type Star = {
  readonly id: number;
  readonly label: string;
  readonly path: string | null;
  readonly lines: number;
  readonly exports: number;
  readonly layer: number;
  readonly radius: number;
  readonly imports: Import[];
  readonly importers: Import[];
};

function findLayer(path: string): number {
  const folder = path.includes("/") ? (path.split("/")[0] ?? "") : "api";
  const name = ["env", "drive", "builtins"].includes(folder) ? "runtime" : folder;

  return Math.max(
    0,
    LAYERS.findIndex((layer) => layer.id === name),
  );
}

/** Tarjan's components over the imports `follow` keeps: the modules that sit in a cycle. */
function findCycles(stars: readonly Star[], follow: (edge: Import) => boolean) {
  const [order, low] = [new Map<number, number>(), new Map<number, number>()];
  const [stack, found]: [number[], Set<number>] = [[], new Set()];

  const visit = (id: number): void => {
    order.set(id, order.size);
    low.set(id, order.get(id) ?? 0);
    stack.push(id);

    for (const edge of stars[id]?.imports ?? []) {
      if (!follow(edge)) continue;

      if (!order.has(edge.to)) visit(edge.to);
      else if (!stack.includes(edge.to)) continue;
      low.set(id, Math.min(low.get(id) ?? 0, low.get(edge.to) ?? 0));
    }

    if (low.get(id) !== order.get(id)) return;
    const members = stack.splice(stack.lastIndexOf(id));

    if (members.length > 1) for (const member of members) found.add(member);
  };

  for (const star of stars) if (!order.has(star.id)) visit(star.id);

  return found;
}

function buildGraph() {
  const stars: Star[] = [...FILES, ...PACKAGES.map((name) => [name, 0, 0] as const)].map(
    ([label, lines, count], id) => ({
      id,
      label,
      path: id < FILES.length ? label : null,
      lines,
      exports: count,
      layer: id < FILES.length ? findLayer(label) : LAYERS.length - 1,
      radius: id < FILES.length ? 0.14 + Math.sqrt(lines) * 0.012 : 0.42,
      imports: [],
      importers: [],
    }),
  );
  const imports: Import[] = [];

  for (const token of IMPORTS.split(" ")) {
    const [from = -1, to = -1, line = 1] = token.replace("t", "").split(".").map(Number);
    const source = stars[from];
    const target = stars[to];

    if (source === undefined || target === undefined) continue;
    const edge = { from, to, line, typeOnly: token.endsWith("t") };
    source.imports.push(edge);
    target.importers.push(edge);
    imports.push(edge);
  }

  return {
    stars,
    imports,
    runtimeCycles: findCycles(stars, (edge) => !edge.typeOnly).size,
    typeCycles: findCycles(stars, () => true).size,
  };
}

export const GRAPH = buildGraph();

export const VALUE_IMPORTS = GRAPH.imports.filter((edge) => !edge.typeOnly);

/** The five modules imported most, labelled in the galaxy and charted when WebGL2 is missing. */
export const HUBS = GRAPH.stars
  .filter((star) => star.path !== null)
  .toSorted((left, right) => right.importers.length - left.importers.length)
  .slice(0, 5);
