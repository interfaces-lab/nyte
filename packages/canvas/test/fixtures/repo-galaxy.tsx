import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Badge,
  BarChart,
  Grid,
  Heading,
  Sparkline,
  Stack,
  Stat,
  Switch,
  Table,
  Text,
  Toggle,
  ToggleGroup,
  useColorScheme,
} from "nyte/canvas";

/** Every non-test module under packages/core/src, one per token: path:lines:exports. */
const MODULES =
  "agent/agent-loop.ts:372:11 agent/compaction.ts:875:5 agent/request.ts:372:8 agent/tool-runner.ts:832:7 agent/transcript.ts:782:3 agent/turn.ts:928:1 api/connection.ts:203:2 api/head.ts:352:5 api/host.ts:92:2 api/part-schema.ts:55:4 api/part.ts:665:3 api/server.ts:52:1 api/session.ts:653:5 builtins/delegation.ts:426:1 builtins/environment.ts:448:1 builtins/mcp.ts:80:1 builtins/system-prompt.ts:30:1 compose.ts:620:5 contract/fold.ts:244:19 contract/host.ts:326:26 contract/kernel.ts:504:31 contract/parts.ts:221:18 contract/plugin.ts:352:29 contract/records.ts:361:28 contract/server.ts:133:4 contract/session.ts:166:6 contract/store.ts:62:5 contract/tools.ts:71:3 contract/workspace.ts:720:35 drive/execution.ts:864:6 engine/admission.ts:842:4 engine/batches.ts:251:3 engine/branch-summary.ts:247:3 engine/contributions.ts:38:4 engine/durable.ts:618:11 engine/fence.ts:142:5 engine/jobs.ts:707:4 engine/lease.ts:61:2 engine/mentions.ts:40:1 engine/move.ts:332:2 engine/part-definitions.ts:33:2 engine/principals.ts:237:6 engine/receipts.ts:326:7 engine/runs.ts:330:5 engine/waits.ts:629:9 env/browser.ts:211:2 env/environment.ts:427:6 env/mcp.ts:85:3 env/trust.ts:85:4 env/workspaces.ts:619:5 extend/activation.ts:97:1 extend/hooks.ts:359:2 extend/models.ts:638:6 extend/plugin-api.ts:237:4 extend/plugin-runtime.ts:932:5 extend/registry.ts:493:5 extend/resources.ts:513:5 extend/setting-layers.ts:134:3 extend/settings.ts:214:4 fold/bus.ts:60:1 fold/calls.ts:184:2 fold/commit.ts:137:5 fold/draft.ts:237:19 fold/fold.ts:867:3 fold/paths.ts:188:1 fold/project.ts:189:3 fold/reads.ts:55:3 fold/seen.ts:115:1 fold/view.ts:134:3 fold/watch.ts:657:4 harness.ts:337:16 index.ts:133:19 server.ts:14:7 store.ts:70:10 store/inspect.ts:201:1 store/log.ts:52:5 store/memory-store.ts:213:1 store/migrations.ts:633:12 store/model-state.ts:251:3 store/parts.ts:252:9 store/refs.ts:85:16 store/session-index.ts:89:3 store/session.ts:429:36 store/wait-index.ts:103:10 testing.ts:16:8 util/callable.ts:5:1 util/content.ts:30:3 util/dev-log.ts:144:2 util/iterable.ts:196:4 util/json-schema.ts:65:3 util/line-diff.ts:216:1 util/process-environment.ts:22:2 util/text.ts:8:1 util/trace.ts:196:15 util/usage.ts:34:2";

/** The workspace packages core imports; their ids follow the files'. */
const PACKAGES: readonly string[] = ["@nyte-ai/schema", "@nyte-ai/ai", "typebox"];

/** One import per token: importer.imported.line, with a trailing t when it is type-only. */
const IMPORTS =
  "0.95.1t 0.96.18t 1.95.1 1.96.29t 1.19.31 1.20.32t 1.21.39 1.23.40 1.33.42 1.52.43 1.61.44 1.66.45 1.79.46 1.80.47 1.82.48 1.87.62 1.89.63 1.92.64 1.2.65 1.94.66 1.4.67 1.26.68t 2.95.1 2.96.24 2.19.29 2.20.30t 2.23.31 2.52.33 2.61.34 2.80.35 2.82.36 2.87.37 2.89.38 2.94.39 3.97.1 3.95.3 3.19.32 3.20.34t 3.21.35 3.23.37 3.27.39t 3.28.40t 3.34.41 3.43.42 3.55.43 3.61.44 3.79.45 3.80.46 3.82.47 3.87.58 3.89.59 3.26.60t 4.95.1 4.96.28t 4.19.30 4.20.31t 4.21.32 4.22.33t 4.23.34 4.28.36t 4.66.37 4.80.38 4.82.39 4.89.46 4.26.47t 4.56.48 4.55.49 5.95.1 5.96.18t 5.19.20 5.20.22t 5.23.29 5.34.31 5.35.32 5.47.33 5.43.34 5.52.35 5.61.36 5.66.37 5.79.38 5.80.39 5.82.40 5.87.42 5.0.43 5.1.52 5.2.53 5.3.54 5.4.56 5.93.57 5.94.58 6.95.1 6.19.3 6.20.11t 6.22.12t 6.25.13t 6.28.14t 6.29.15 6.41.16 6.49.17 6.58.18 6.74.19 6.8.20 6.12.21 7.95.1 7.18.16t 7.19.17t 7.20.18t 7.23.19t 7.25.20t 7.30.21 7.39.22 7.58.23 7.61.24 7.66.25 7.68.26 7.80.27 7.82.28 7.92.47 8.95.1t 8.19.2t 8.20.3t 8.88.4 9.21.1t 9.89.8 10.95.1 10.19.11 10.20.13t 10.21.14t 10.23.23 10.34.25 10.40.27 10.61.28 10.79.29 10.80.30 10.82.31 10.85.43 10.86.44 10.89.45 10.9.46 11.20.1t 11.24.2t 11.29.3 11.31.4 11.39.5 11.41.6 11.42.7 11.80.8 12.95.1 12.19.22t 12.20.23t 12.21.24t 12.23.25 12.25.27t 12.30.28 12.33.29 12.34.30 12.35.31 12.42.32 12.43.33 12.44.34 12.55.35 12.56.36 12.58.37 12.61.38 12.79.39 12.80.40 12.82.41 12.88.53 12.7.54 12.10.55 12.26.56t 13.97.1 13.95.2 13.21.13 13.22.14t 13.25.15t 13.27.16t 13.92.17 14.95.1 14.97.3 14.22.4t 14.27.5t 14.28.6t 14.86.7 14.90.8 14.93.9 15.95.1t 15.22.2t 15.28.3t 16.22.1t 17.95.1 17.96.14t 17.1.15 17.2.16 17.3.17 17.5.18 17.6.19 17.8.20 17.11.21 17.10.22 17.12.23 17.13.24 17.14.25 17.15.26 17.16.27 17.18.28t 17.19.29 17.20.31t 17.21.40t 17.24.41t 17.22.42t 17.23.43 17.26.45t 17.28.46t 17.29.53 17.36.54 17.40.55 17.41.56 17.44.57 17.45.58 17.46.59 17.47.60 17.49.61 17.52.62 17.53.63 17.54.64 17.55.71 17.56.72 17.57.73 17.58.74 17.59.75 17.63.76 17.69.77 17.78.78 17.79.79 17.80.80 17.82.81 17.87.82 18.95.1t 18.23.36t 19.95.1 19.96.44t 19.22.45t 19.25.46t 19.26.47t 19.28.48t 20.95.1t 20.18.37t 20.19.38t 20.21.47t 20.22.48t 20.23.61t 20.25.62t 20.26.63t 20.27.64t 20.28.65t 21.95.1 21.97.23 21.89.24 21.22.25t 21.27.26t 22.95.1t 22.19.29t 22.21.30t 22.25.31t 22.27.32t 22.28.33t 23.95.1 23.97.43 23.25.45t 24.95.1t 24.19.22t 24.21.29t 24.22.30t 24.25.31t 24.28.32t 25.95.1t 25.21.40t 26.95.1t 27.95.1t 27.19.16t 27.25.17t 27.28.18t 28.95.1t 28.19.66t 28.25.67t 28.27.68t 29.95.1 29.96.16 29.3.17 29.18.18t 29.19.19 29.20.20t 29.23.21 29.30.23 29.34.24 29.35.25 29.37.26 29.39.27 29.43.28 29.44.29 29.61.30 29.66.31 29.80.32 29.82.33 29.86.44 29.87.45 29.26.46t 30.95.1 30.18.21t 30.19.22t 30.20.23t 30.23.24t 30.25.25t 30.61.26 30.66.27 30.80.28 30.82.29 30.86.47 30.87.48 30.32.49 30.33.50 30.35.51 30.38.52 30.42.53 30.93.54 30.26.55t 31.95.1 31.20.10t 31.25.11t 31.28.12t 31.61.13 31.82.14 31.86.15 31.42.16 31.44.17 31.26.18t 32.95.1 32.20.13t 32.23.14t 32.61.15 32.66.16 32.80.17 32.82.18 32.35.31 32.26.32t 33.95.1 33.20.3t 34.95.1 34.20.14t 34.23.15 34.27.17t 34.61.18 34.79.19 34.80.20 34.82.21 34.83.22 34.87.23 34.37.24 34.44.25 34.26.26t 35.95.1t 35.20.10t 35.23.11 35.61.12 35.66.13 35.79.14 35.80.15 35.82.16 35.26.26t 36.95.1 36.19.14 36.20.16t 36.28.17t 36.82.18 36.87.19 36.88.20 36.30.21 36.34.22 36.44.23 37.87.1 38.95.1t 38.20.2t 39.95.1 39.20.13t 39.23.14t 39.25.15t 39.61.16 39.66.17 39.80.18 39.82.19 39.86.34 39.32.35 39.35.36 39.42.37 40.95.1t 40.21.2 41.95.1 41.19.3t 41.20.4t 41.23.5 41.61.7 41.80.8 41.82.9 41.26.10t 42.95.1 42.19.12 42.20.13t 42.23.14t 42.25.15t 42.61.16 42.66.17 42.80.18 42.82.19 42.35.28 42.44.29 42.26.30t 43.95.1 43.18.13t 43.19.14 43.20.15t 43.23.16 43.25.18t 43.61.19 43.66.20 43.79.21 43.80.22 43.83.23 43.82.24 43.30.37 43.35.38 43.44.39 43.26.40t 44.95.1 44.20.14t 44.23.15 44.61.17 44.66.19 44.79.20 44.80.21 44.82.22 44.83.23 44.87.35 44.26.36t 45.95.1 45.20.3t 45.28.4t 45.36.5 45.86.6 46.95.1 46.20.3t 46.23.4 46.28.6t 46.31.21 46.80.22 46.82.23 46.45.24 46.26.25t 47.95.1 47.20.3t 47.28.4t 47.82.5 47.46.6 47.48.7 48.20.1t 48.23.2t 48.80.3 48.82.4 48.46.5 49.95.1 49.19.16t 49.20.17t 49.23.18 49.28.20t 49.36.30 49.56.31 49.61.32 49.80.33 49.82.34 49.86.44 49.88.45 49.46.46 49.47.47 49.48.48 49.26.50t 50.95.1t 50.20.2t 50.22.3t 50.46.4 50.48.5 50.49.6 50.82.7 51.95.1 51.97.11 51.19.13 51.20.15t 51.22.23t 51.27.24t 51.34.25 51.82.26 51.87.27 51.53.28 52.95.1 52.96.14t 52.19.24t 52.20.25t 52.22.31t 52.33.32t 52.61.33 52.78.34 52.82.35 52.86.36 52.88.37 52.89.38 52.55.39 53.95.1 53.19.3 53.20.5t 53.22.6t 53.25.7t 53.28.8t 53.61.9 53.80.10 53.82.11 54.95.1 54.19.14 54.20.15t 54.21.26t 54.22.27t 54.28.35t 54.40.36 54.82.37 54.85.38 54.87.39 54.89.40 54.50.41 54.51.42 54.53.43 54.55.44 54.58.45 54.56.46 55.95.1 55.19.14 55.20.16t 55.22.24t 55.30.32 55.82.33 55.85.34 55.89.35 55.53.36 55.57.37 56.95.1 56.97.3 56.20.4t 56.22.5t 56.28.6t 56.46.7 56.48.8 56.80.9 56.82.10 56.87.11 56.26.12t 57.95.1 57.20.3t 57.22.4t 57.80.5 57.82.6 57.89.7 57.26.8t 58.95.1 58.19.9t 58.20.10t 58.22.11t 58.33.12 58.48.13 58.49.14 58.61.15 58.80.16 58.82.17 58.89.18 58.55.19 58.56.20 58.57.21 59.95.1t 59.18.2t 59.87.3 60.95.1 60.18.11t 60.62.12 61.95.1 61.20.10t 61.23.11t 61.80.12 61.82.13 61.87.14 61.69.15 62.95.1 62.18.15t 62.23.16t 62.82.17 63.95.1 63.18.27 63.23.38t 63.82.39 63.60.40 63.62.41 63.64.59 64.95.1t 64.18.2 64.82.4 64.62.5 65.95.1t 65.18.13 65.82.15 65.94.16 65.62.17 66.95.1t 66.18.2t 66.19.3 66.20.4t 66.82.5 67.95.1 67.20.3t 67.23.4 67.80.6 67.82.7 67.87.17 67.61.18 67.66.19 68.95.1t 68.18.11 68.20.13t 68.88.14 68.65.15 68.67.16 69.95.1 69.18.17t 69.20.27t 69.23.28 69.79.29 69.75.30 69.80.31 69.82.32 69.87.33 69.93.34 69.63.35 69.65.36 70.95.1 70.6.15 70.8.16 70.17.17 70.43.18 70.69.19 70.73.20 70.20.21t 70.71.22t 71.19.1 71.21.21 71.22.41t 71.25.72t 71.26.74t 71.27.82t 71.28.84t 71.91.102 71.87.104 71.93.108 71.88.124 71.89.126 71.9.128 71.85.130 71.90.132 72.94.1 72.17.3 72.19.7 72.24.9t 72.28.11t 72.91.13 73.23.1 73.75.28 73.76.36 73.77.38 73.78.48 73.80.50 73.81.67 73.86.69 74.95.1 74.19.12t 74.23.14 74.80.16 74.82.17 74.26.18t 75.95.1 75.80.3 76.95.1 76.26.3t 76.86.4 76.75.5 76.80.6 76.81.7 77.95.1 77.97.11 77.23.13 77.86.14 77.80.15 77.83.16 78.96.1t 78.95.2 78.97.4 78.19.5t 78.23.6 78.26.7t 78.80.8 79.95.1 79.18.15t 79.20.16t 79.21.17 79.23.19 79.89.21 79.80.22 79.82.23 79.26.25t 80.95.1 81.95.1 81.23.3 82.95.1 82.20.19t 82.23.20 82.87.39 82.80.40 82.26.41t 83.95.1 83.23.3t 84.11.1 84.17.3 84.20.5t 84.43.7 84.54.9 84.69.11 84.70.13 86.95.1 88.95.1t 89.95.1 90.95.1t 92.95.1t 94.95.1t";

const ROOT = "packages/core/src/";

const FILES = MODULES.split(" ").map((token) => {
  const [path = "", lines = "0", exports = "0"] = token.split(":");

  return [path, Number(lines), Number(exports)] as const;
});

/** Core's folders, folded into the layers a reader names; root modules are the public API. */
const LAYERS = [
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

type Import = Readonly<{ from: number; to: number; line: number; typeOnly: boolean }>;

type Star = {
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
    ([label, lines, exports], id) => ({
      id,
      label,
      path: id < FILES.length ? label : null,
      lines,
      exports,
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

const GRAPH = buildGraph();

const VALUE_IMPORTS = GRAPH.imports.filter((edge) => !edge.typeOnly);

/** The five modules imported most, labelled in the galaxy and charted when WebGL2 is missing. */
const HUBS = GRAPH.stars
  .filter((star) => star.path !== null)
  .toSorted((left, right) => right.importers.length - left.importers.length)
  .slice(0, 5);

/** Seeded start positions, so every load forms the same galaxy; each layer pulls toward a point on a sphere. */
function createSimulation() {
  const position = Float32Array.from(
    { length: STARS * 3 },
    (_, index) => ((Math.sin(index * 12.9898 + 78.233) * 43_758.5453) % 1) * 0.6,
  );
  const anchors = new Float32Array(LAYERS.length * 3);

  LAYERS.forEach((_, index) => {
    const y = 1 - ((index + 0.5) / LAYERS.length) * 2;
    const ring = Math.sqrt(1 - y * y) * 6;
    anchors.set([Math.cos(index * 2.4) * ring, y * 3.8, Math.sin(index * 2.4) * ring], index * 3);
  });

  return { position, velocity: new Float32Array(position.length), anchors, alpha: 1 };
}

/** One step of the layout: stars repel, imports pull like springs, layers gather, the whole drifts to the centre. */
function tick(simulation: ReturnType<typeof createSimulation>): void {
  const { position: p, velocity: v, anchors, alpha } = simulation;
  const count = STARS;
  const nudge = (at: number, by: number): void => {
    v[at] = (v[at] ?? 0) + by;
  };

  for (let left = 0; left < count * 3; left += 3)
    for (let right = left + 3; right < count * 3; right += 3) {
      const dx = (p[left] ?? 0) - (p[right] ?? 0);
      const dy = (p[left + 1] ?? 0) - (p[right + 1] ?? 0);
      const dz = (p[left + 2] ?? 0) - (p[right + 2] ?? 0);
      const squared = Math.max(dx * dx + dy * dy + dz * dz, 0.09);
      const push = (1.6 * alpha) / (squared * Math.sqrt(squared));
      for (const [axis, delta] of [dx, dy, dz].entries()) {
        nudge(left + axis, delta * push);
        nudge(right + axis, -delta * push);
      }
    }

  for (const edge of GRAPH.imports) {
    const [from, to] = [edge.from * 3, edge.to * 3];
    const d = [0, 1, 2].map((axis) => (p[to + axis] ?? 0) - (p[from + axis] ?? 0));
    const distance = Math.hypot(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0) || 0.01;
    const strength = GRAPH.stars[edge.to]?.path === null ? 0.004 : edge.typeOnly ? 0.02 : 0.045;
    const pull = ((distance - 2.4) / distance) * strength * alpha;

    for (let axis = 0; axis < 3; axis += 1) {
      nudge(from + axis, (d[axis] ?? 0) * pull);
      nudge(to + axis, -(d[axis] ?? 0) * pull);
    }
  }

  for (const star of GRAPH.stars)
    for (let axis = 0; axis < 3; axis += 1) {
      const at = star.id * 3 + axis;
      const here = p[at] ?? 0;
      const toward = ((anchors[star.layer * 3 + axis] ?? 0) - here) * 0.012 - here * 0.002;
      v[at] = ((v[at] ?? 0) + toward * alpha) * 0.86;
      p[at] = here + (v[at] ?? 0);
    }

  simulation.alpha *= 0.988;
}

type Camera = { yaw: number; pitch: number; distance: number };

const HOME: Camera = { yaw: 0.6, pitch: 0.32, distance: 30 };

const FIELD_OF_VIEW = (38 * Math.PI) / 180;

/** Column-major projection times view, for an orbit around the origin. */
function viewProjection(camera: Camera, aspect: number): Float32Array {
  const focal = 1 / Math.tan(FIELD_OF_VIEW / 2);
  const [near, far] = [0.5, 120];
  const { yaw, pitch, distance } = camera;
  const [ex, ey] = [Math.cos(pitch) * Math.sin(yaw) * distance, Math.sin(pitch) * distance];
  const ez = Math.cos(pitch) * Math.cos(yaw) * distance;
  const length = Math.hypot(ex, ey, ez);
  const [fx, fy, fz] = [ex / length, ey / length, ez / length];
  const side = Math.hypot(fz, fx) || 1;
  const [sx, sz] = [fz / side, -fx / side];
  const [ux, uy, uz] = [fy * sz, fz * sx - fx * sz, -fy * sx];
  const view = [
    [sx, ux, fx, 0],
    [0, uy, fy, 0],
    [sz, uz, fz, 0],
    [-(sx * ex + sz * ez), -(ux * ex + uy * ey + uz * ez), -(fx * ex + fy * ey + fz * ez), 1],
  ];
  const [a, c, d] = [focal / aspect, (far + near) / (near - far), (2 * far * near) / (near - far)];
  const columns = view.flatMap(([x = 0, y = 0, z = 0, w = 0]) => [
    a * x,
    focal * y,
    c * z + d * w,
    -z,
  ]);

  return Float32Array.from(columns);
}

type Rgb = readonly [number, number, number];

type Palette = { readonly layers: readonly Rgb[]; readonly ink: Rgb; readonly dark: boolean };

type Frame = {
  readonly matrix: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
  readonly time: number;
  readonly palette: Palette;
  readonly position: Float32Array;
  readonly emphasis: Float32Array;
  readonly focus: number | null;
};

type Renderer = { readonly detail: string; draw(frame: Frame): void; dispose(): void };

const NODE_VERTEX = `#version 300 es
uniform mat4 u_matrix; uniform float u_scale;
in vec3 a_pos; in vec4 a_color; in float a_radius;
out vec4 v_color; out float v_fog;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  gl_PointSize = max(a_radius * u_scale / gl_Position.w * 2.8, 2.0);
  v_fog = clamp(1.4 - gl_Position.w / 45.0, 0.35, 1.0);
  v_color = a_color;
}`;

const NODE_FRAGMENT = `#version 300 es
precision highp float;
uniform float u_glow; in vec4 v_color; in float v_fog; out vec4 color;
void main() {
  vec2 p = (gl_PointCoord * 2.0 - 1.0) * 1.4;
  float r = length(p), edge = fwidth(r), core = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, r);
  vec3 normal = vec3(p, sqrt(max(0.0, 1.0 - dot(p, p))));
  float light = 0.62 + 0.38 * max(dot(normal, normalize(vec3(-0.45, 0.55, 0.7))), 0.0);
  float rim = pow(1.0 - normal.z, 3.0) * 0.35;
  float halo = exp(-r * r * 1.4) * u_glow * (1.0 - core);
  float a = (core + halo * 0.55) * v_color.a * v_fog;
  color = vec4(mix(v_color.rgb, v_color.rgb * light + rim, core) * a, a);
}`;

const LINE_VERTEX = `#version 300 es
uniform mat4 u_matrix; in vec3 a_pos; in vec4 a_color; out vec4 v_color;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  v_color = vec4(a_color.rgb, a_color.a * clamp(1.45 - gl_Position.w / 45.0, 0.25, 1.0));
}`;

const SPARK_VERTEX = `#version 300 es
uniform mat4 u_matrix; uniform float u_time; uniform float u_ratio;
in vec3 a_from; in vec3 a_to; in vec4 a_color; in float a_phase;
out vec4 v_color;
void main() {
  float t = fract(a_phase + u_time * 0.9 / max(distance(a_from, a_to), 0.5));
  gl_Position = u_matrix * vec4(mix(a_from, a_to, t), 1.0);
  gl_PointSize = 3.2 * u_ratio;
  float fog = clamp(1.45 - gl_Position.w / 45.0, 0.25, 1.0);
  v_color = vec4(a_color.rgb, a_color.a * sin(t * 3.14159) * fog);
}`;

const FLAT_FRAGMENT = `#version 300 es
precision highp float;
uniform float u_round; in vec4 v_color; out vec4 color;
void main() {
  float dot = 1.0 - smoothstep(0.2, 1.0, length(gl_PointCoord * 2.0 - 1.0));
  float a = v_color.a * mix(1.0, dot, u_round);
  color = vec4(v_color.rgb * a, a);
}`;

/** Links one program and lays out its interleaved vertex buffer, attribute by attribute. */
function createBatch(
  gl: WebGL2RenderingContext,
  shaders: readonly [string, string],
  layout: string,
  vertices: number,
) {
  const program = gl.createProgram();

  shaders.forEach((source, index) => {
    const shader = gl.createShader(index === 0 ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER);

    if (shader === null) throw new Error("WebGL2 refused a shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true)
      throw new Error(gl.getShaderInfoLog(shader) ?? "A shader did not compile.");
    gl.attachShader(program, shader);
  });
  gl.linkProgram(program);
  const attributes = layout.split(" ").map((entry) => entry.split(":"));
  const stride = attributes.reduce((sum, [, size]) => sum + Number(size), 0);
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  const data = new Float32Array(vertices * stride);
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
  let offset = 0;

  for (const [name = "", size = "0"] of attributes) {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, Number(size), gl.FLOAT, false, stride * 4, offset * 4);
    offset += Number(size);
  }

  gl.bindVertexArray(null);

  return { program, vao, buffer, data, stride };
}

type Batch = ReturnType<typeof createBatch>;

const SPARKS = 2;

const SPARK_COUNT = VALUE_IMPORTS.length * SPARKS;

const STARS = GRAPH.stars.length;

/** Stars from the far side to the near one, so halos overlap correctly. */
function depthOrder(frame: Frame): readonly number[] {
  const { matrix: m, position: p } = frame;
  const depth = (id: number): number =>
    (m[3] ?? 0) * (p[id * 3] ?? 0) +
    (m[7] ?? 0) * (p[id * 3 + 1] ?? 0) +
    (m[11] ?? 0) * (p[id * 3 + 2] ?? 0);

  return GRAPH.stars.map((star) => star.id).toSorted((left, right) => depth(right) - depth(left));
}

function edgeColor(frame: Frame, edge: Import): readonly [number, number, number, number] {
  const { palette, emphasis, focus } = frame;
  const shown = Math.min(emphasis[edge.from] ?? 0, emphasis[edge.to] ?? 0);
  const rgb = palette.layers[GRAPH.stars[edge.from]?.layer ?? 0] ?? palette.ink;

  if (focus !== null && (edge.from === focus || edge.to === focus)) return [...rgb, 0.95];
  return [...rgb, (edge.typeOnly ? 0.07 : 0.2) * (focus === null ? 1 : 0.35) * shown];
}

function createWebGL(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext("webgl2", { antialias: true, premultipliedAlpha: true });

  if (gl === null) return null;
  const batch = (shaders: readonly [string, string], layout: string, count: number) =>
    createBatch(gl, shaders, layout, count);
  const nodes = batch([NODE_VERTEX, NODE_FRAGMENT], "a_pos:3 a_color:4 a_radius:1", STARS);
  const lines = batch([LINE_VERTEX, FLAT_FRAGMENT], "a_pos:3 a_color:4", GRAPH.imports.length * 2);
  const sparks = batch(
    [SPARK_VERTEX, FLAT_FRAGMENT],
    "a_from:3 a_to:3 a_color:4 a_phase:1",
    SPARK_COUNT,
  );
  const debug = gl.getExtension("WEBGL_debug_renderer_info");

  const run = (target: Batch, frame: Frame, mode: number, uniforms: Record<string, number>) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, target.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, target.data);
    gl.useProgram(target.program);
    gl.uniformMatrix4fv(gl.getUniformLocation(target.program, "u_matrix"), false, frame.matrix);

    for (const [name, value] of Object.entries(uniforms))
      gl.uniform1f(gl.getUniformLocation(target.program, name), value);
    gl.bindVertexArray(target.vao);
    gl.drawArrays(mode, 0, target.data.length / target.stride);
  };

  return {
    detail: debug === null ? "WebGL2" : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
    draw(frame) {
      const { position, palette } = frame;
      const at = (id: number): Float32Array => position.subarray(id * 3, id * 3 + 3);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      GRAPH.imports.forEach((edge, index) => {
        const color = edgeColor(frame, edge);
        lines.data.set(
          [...at(edge.from), ...color, ...at(edge.to), ...color],
          index * 2 * lines.stride,
        );
      });
      run(lines, frame, gl.LINES, { u_round: 0 });

      VALUE_IMPORTS.forEach((edge, index) => {
        const [red, green, blue, alpha] = edgeColor(frame, edge);
        const strength = Math.min(1, alpha * (palette.dark ? 3.2 : 2.4));

        for (let spark = 0; spark < SPARKS; spark += 1) {
          const phase = (index * 0.618 + spark / SPARKS) % 1;
          sparks.data.set(
            [...at(edge.from), ...at(edge.to), red, green, blue, strength, phase],
            (index * SPARKS + spark) * sparks.stride,
          );
        }
      });

      if (palette.dark) gl.blendFunc(gl.ONE, gl.ONE);
      run(sparks, frame, gl.POINTS, { u_time: frame.time, u_ratio: frame.ratio, u_round: 1 });
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      depthOrder(frame).forEach((id, slot) => {
        const star = GRAPH.stars[id];

        if (star === undefined) return;
        const rgb = palette.layers[star.layer] ?? palette.ink;
        nodes.data.set([...at(id), ...rgb, frame.emphasis[id] ?? 0, star.radius], slot * 8);
      });
      run(nodes, frame, gl.POINTS, {
        u_scale: canvas.height / (2 * Math.tan(FIELD_OF_VIEW / 2)),
        u_glow: palette.dark ? 1 : 0.45,
      });
      gl.bindVertexArray(null);
    },
    dispose() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

function project(frame: Frame, id: number) {
  const { matrix: m, position: p } = frame;
  const [x = 0, y = 0, z = 0] = p.subarray(id * 3, id * 3 + 3);
  const row = (at: number): number =>
    (m[at] ?? 0) * x + (m[at + 4] ?? 0) * y + (m[at + 8] ?? 0) * z + (m[at + 12] ?? 0);
  const w = row(3);

  return { x: ((row(0) / w + 1) / 2) * frame.width, y: ((1 - row(1) / w) / 2) * frame.height, w };
}

function screenRadius(frame: Frame, star: Star, w: number): number {
  return (star.radius * frame.height) / (2 * Math.tan(FIELD_OF_VIEW / 2)) / w;
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgb(${rgb.map((channel) => Math.round(channel * 255)).join(" ")} / ${alpha.toFixed(3)})`;
}

/** Resolves the theme's chart hues and ink from probes the kit itself paints, through a 1px canvas. */
function readPalette(root: HTMLElement, dark: boolean): Palette | null {
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

  if (probe === null) return null;
  const color = (selector: string): Rgb => {
    const element = root.querySelector(selector);
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = element === null ? "gray" : getComputedStyle(element).color;
    probe.fillRect(0, 0, 1, 1);
    const [red = 0, green = 0, blue = 0] = probe.getImageData(0, 0, 1, 1).data;

    return [red / 255, green / 255, blue / 255];
  };

  return {
    layers: LAYERS.map((_, index) => color(`[data-probe="${index}"] > span`)),
    ink: color('[data-probe="ink"]'),
    dark,
  };
}

const STAGE_HEIGHT = 440;

function percentile(values: readonly number[], share: number): number {
  const sorted = values.toSorted((left, right) => left - right);

  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
}

const SWATCH = { display: "inline-block", width: 8, height: 8, borderRadius: 4 } as const;

function Details({ star }: { readonly star: Star | undefined }) {
  if (star === undefined)
    return (
      <Table
        caption="Most imported"
        columns={[
          { key: "module", label: "Module" },
          { key: "count", label: "Importers", align: "end" },
        ]}
        rows={HUBS.map((hub) => ({ module: hub.label, count: hub.importers.length }))}
      />
    );
  const cell = (edge: Import | undefined, outgoing: boolean) => {
    const other = edge === undefined ? undefined : GRAPH.stars[outgoing ? edge.to : edge.from];
    const path = outgoing ? star.path : other?.path;

    if (edge === undefined || other === undefined) return "";
    const text = outgoing ? other.label : `${other.label}:${edge.line}`;

    return path === null || path === undefined ? (
      text
    ) : (
      <a href={`${ROOT}${path}:${edge.line}`}>{text}</a>
    );
  };
  const rows = [0, 1, 2, 3, 4].map((index) => ({
    by: cell(star.importers[index], false),
    to: cell(star.imports[index], true),
  }));

  return (
    <Table
      caption={
        star.path === null
          ? `${star.label}, a workspace package`
          : `${star.label} · ${star.lines} lines · ${star.exports} exports`
      }
      columns={[
        { key: "by", label: `Imported by (${star.importers.length})`, width: "50%" },
        { key: "to", label: `Imports (${star.imports.length})` },
      ]}
      rows={rows}
    />
  );
}

const absolute = { position: "absolute", left: 0, top: 0 } as const;

export default function RepoGalaxy() {
  const scheme = useColorScheme();
  const [still] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [gpu, setGpu] = useState(true);
  const [focus, setFocus] = useState<number | null>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [renderer, setRenderer] = useState<"WebGL2" | "chart">();
  const [simulation] = useState(createSimulation);
  const rootRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const hudRef = useRef<HTMLSpanElement>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const focusRef = useRef<number | null>(null);
  const settingsRef = useRef({ hidden, palette, still });

  useLayoutEffect(() => {
    settingsRef.current = { hidden, palette, still };
  });

  useLayoutEffect(() => {
    const root = probeRef.current;

    if (root === null) return;
    const read = (): void => setPalette(readPalette(root, scheme === "dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true });

    return () => observer.disconnect();
  }, [scheme]);

  useEffect(() => {
    const [canvas, stage, root] = [canvasRef.current, stageRef.current, rootRef.current];

    if (canvas === null || stage === null || root === null) return;
    let drawing: Renderer | null = null;

    try {
      drawing = gpu ? createWebGL(canvas) : null;
    } catch {
      drawing = null;
    }

    setRenderer(drawing === null ? "chart" : "WebGL2");
    root.dataset["renderer"] = drawing?.detail ?? "Kit chart fallback";

    if (drawing === null) return;
    const camera: Camera = { ...HOME };
    const pointer = { x: 0, y: 0, inside: false, down: false, dragged: false, lastX: 0, lastY: 0 };
    const emphasis = new Float32Array(STARS).fill(1);
    const size = { width: stage.clientWidth, height: STAGE_HEIGHT, ratio: 1 };
    const intervals: number[] = [];
    const work: number[] = [];
    const clock = { time: 0, frames: 0, last: 0, handle: 0, idle: 0, suppress: 0, pointer: 0 };

    if (settingsRef.current.still) while (simulation.alpha > 0.002) tick(simulation);

    const resize = (): void => {
      size.width = stage.clientWidth;
      size.ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(size.width * size.ratio);
      canvas.height = Math.round(size.height * size.ratio);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);

    const hover = (next: number | null): void => {
      if (next === focusRef.current) return;
      focusRef.current = next;
      setFocus(next);
    };

    const pick = (frame: Frame): number | null => {
      let best: { readonly id: number; readonly score: number } | null = null;

      for (const star of GRAPH.stars) {
        const point = project(frame, star.id);

        if ((emphasis[star.id] ?? 0) < 0.5 || point.w <= 0) continue;
        const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y);
        const reach = Math.max(screenRadius(frame, star, point.w) + 4, 9);
        const score = distance + point.w * 0.01;

        if (distance < reach && (best === null || score < best.score))
          best = { id: star.id, score };
      }

      return best?.id ?? null;
    };

    const place = (frame: Frame): void => {
      const [current, anchor] = [focusRef.current, anchorRef.current];
      const taken: { readonly x: number; readonly y: number; readonly width: number }[] = [];

      const star = current === null ? undefined : GRAPH.stars[current];

      [star, ...HUBS].forEach((hub, index) => {
        const label = labelRefs.current[index];

        if (label === null || label === undefined) return;
        label.style.opacity = "0";

        if (hub === undefined) return;
        const point = project(frame, hub.id);
        const [x, y] = [point.x + screenRadius(frame, hub, point.w) + 6, point.y - 8];
        const width = label.offsetWidth;
        const clear = !taken.some(
          (other) => Math.abs(other.y - y) < 16 && x < other.x + other.width && other.x < x + width,
        );
        const lit = index === 0 || ((emphasis[hub.id] ?? 0) > 0.5 && current !== hub.id);
        const shown = clear && lit && point.w > 0;

        label.style.transform = `translate(${x}px, ${y}px)`;

        if (!shown) return;
        taken.push({ x, y, width });
        label.style.opacity = String(Math.min(1, 1.7 - point.w / 45));
      });

      if (anchor !== null)
        anchor.style.display = star === undefined || star.path === null ? "none" : "block";

      if (star === undefined || anchor === null) return;
      const point = project(frame, star.id);
      const radius = Math.max(screenRadius(frame, star, point.w), 6) + 4;
      anchor.style.width = `${radius * 2}px`;
      anchor.style.height = `${radius * 2}px`;
      anchor.style.transform = `translate(${point.x - radius}px, ${point.y - radius}px)`;
    };

    const loop = (now: number): void => {
      clock.handle = requestAnimationFrame(loop);
      const started = performance.now();
      const delta = clock.last === 0 ? 16.7 : now - clock.last;
      const step = Math.min(delta, 50) / 1000;
      clock.last = now;
      const settings = settingsRef.current;

      if (settings.palette === null) return;

      if (simulation.alpha > 0.002) tick(simulation);
      const current = focusRef.current;

      if (!settings.still) clock.time += step;

      const resting =
        !pointer.down && (current === null || !pointer.inside) && now - clock.idle > 1200;

      if (!settings.still && resting) camera.yaw += step * 0.12;
      const near = new Set(
        current === null
          ? []
          : [
              current,
              ...(GRAPH.stars[current]?.imports.map((edge) => edge.to) ?? []),
              ...(GRAPH.stars[current]?.importers.map((edge) => edge.from) ?? []),
            ],
      );

      const ease = Math.min(1, delta / 90);

      for (const star of GRAPH.stars) {
        const shown = !settings.hidden.includes(LAYERS[star.layer]?.id ?? "");
        const target = shown ? (current === null || near.has(star.id) ? 1 : 0.18) : 0;
        const value = emphasis[star.id] ?? 0;
        emphasis[star.id] = settings.still ? target : value + (target - value) * ease;
      }

      const frame: Frame = {
        ...size,
        matrix: viewProjection(camera, size.width / size.height),
        time: clock.time,
        palette: settings.palette,
        position: simulation.position,
        emphasis,
        focus: current,
      };

      if (pointer.inside && !pointer.down) hover(pick(frame));
      drawing.draw(frame);
      place(frame);
      work.push(performance.now() - started);
      intervals.push(delta);

      intervals.splice(0, intervals.length - 120);
      work.splice(0, work.length - 120);
      clock.frames += 1;

      if (clock.frames % 30 !== 0) return;
      const median = percentile(intervals, 0.5);
      const busy = percentile(work, 0.95);
      root.dataset["frameP50"] = median.toFixed(2);
      root.dataset["frameP95"] = percentile(intervals, 0.95).toFixed(2);
      root.dataset["workP95"] = busy.toFixed(2);

      if (hudRef.current !== null)
        hudRef.current.textContent = `WebGL2 · ${Math.round(1000 / median)} fps · ${busy.toFixed(1)} ms`;
    };
    clock.handle = requestAnimationFrame(loop);

    const orbit = (yaw: number, pitch: number, zoom: number): void => {
      clock.idle = performance.now();
      camera.yaw += yaw;
      camera.pitch = Math.max(-1.3, Math.min(1.3, camera.pitch + pitch));
      camera.distance = Math.max(10, Math.min(70, camera.distance * zoom));
    };

    const locate = (event: PointerEvent): void => {
      const bounds = stage.getBoundingClientRect();
      pointer.x = event.clientX - bounds.left;
      pointer.y = event.clientY - bounds.top;
    };

    const release = (): void => {
      if (pointer.dragged) clock.suppress = performance.now() + 80;
      pointer.down = false;

      if (stage.hasPointerCapture(clock.pointer)) stage.releasePointerCapture(clock.pointer);
    };

    const abort = new AbortController();
    const { signal } = abort;
    const listen = <Name extends keyof HTMLElementEventMap>(
      name: Name,
      handler: (event: HTMLElementEventMap[Name]) => void,
    ): void => stage.addEventListener(name, handler, { signal, passive: name !== "wheel" });

    listen("pointerdown", (event) => {
      locate(event);
      pointer.down = true;
      pointer.dragged = false;
      Object.assign(pointer, { lastX: event.clientX, lastY: event.clientY });
      clock.pointer = event.pointerId;
    });
    listen("pointermove", (event) => {
      locate(event);
      pointer.inside = true;
      clock.idle = performance.now();
      const [dx, dy] = [event.clientX - pointer.lastX, event.clientY - pointer.lastY];

      if (!pointer.down || (!pointer.dragged && Math.hypot(dx, dy) < 4)) return;

      if (!pointer.dragged) {
        stage.setPointerCapture(event.pointerId);
        hover(null);
      }

      Object.assign(pointer, { dragged: true, lastX: event.clientX, lastY: event.clientY });
      orbit(-dx * 0.008, dy * 0.008, 1);
    });
    listen("pointerup", release);
    listen("pointercancel", release);
    listen("pointerleave", () => {
      pointer.inside = false;

      if (!pointer.down) hover(null);
    });
    listen("wheel", (event) => {
      event.preventDefault();
      orbit(0, 0, Math.exp(event.deltaY * 0.0012));
    });
    canvas.addEventListener("webglcontextlost", () => setGpu(false), { signal });
    window.addEventListener(
      "click",
      (event) => {
        if (performance.now() > clock.suppress) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      { signal, capture: true },
    );

    return () => {
      cancelAnimationFrame(clock.handle);
      observer.disconnect();
      abort.abort();
      drawing.dispose();
    };
  }, [gpu, simulation]);

  const star = focus === null ? undefined : GRAPH.stars[focus];
  const opens = star !== undefined && star.path !== null;

  return (
    <div ref={rootRef}>
      <Stack gap={3}>
        <Stack gap={0}>
          <Heading level={3}>How packages/core imports itself</Heading>
          <Text size="sm" tone="secondary">
            {`${FILES.length} modules and ${GRAPH.imports.length} imports, laid out by a live force simulation. Drag to orbit, scroll to zoom, click a star to open its file.`}
          </Text>
        </Stack>
        <div
          ref={stageRef}
          role="img"
          aria-label={`Import graph of packages/core: ${FILES.length} modules, ${GRAPH.imports.length} imports.`}
          style={{
            position: "relative",
            height: STAGE_HEIGHT,
            overflow: "hidden",
            touchAction: "none",
            cursor: focus === null ? "grab" : "pointer",
            display: renderer === "chart" ? "none" : "block",
          }}
        >
          <canvas
            key={gpu ? "gpu" : "cpu"}
            ref={canvasRef}
            style={{ ...absolute, width: "100%", height: STAGE_HEIGHT }}
          />
          {[star, ...HUBS].map((hub, index) => (
            <div
              key={index === 0 ? "focus" : hub?.id}
              ref={(element) => {
                labelRefs.current[index] = element;
              }}
              style={{ ...absolute, pointerEvents: "none", opacity: 0, whiteSpace: "nowrap" }}
            >
              <Text size="xs" tone={index === 0 ? "primary" : "secondary"} mono>
                {hub?.label ?? ""}
              </Text>
            </div>
          ))}
          <a
            ref={anchorRef}
            href={opens ? `${ROOT}${star.path}:1` : "#"}
            aria-label={opens ? `Open ${ROOT}${star.path}` : undefined}
            draggable={false}
            style={{ ...absolute, display: "none", borderRadius: "50%" }}
          />
          <div style={{ position: "absolute", top: 8, right: 8, pointerEvents: "none" }}>
            <Badge tone="info">
              <span ref={hudRef}>WebGL2</span>
            </Badge>
          </div>
        </div>
        {renderer === "chart" ? (
          <BarChart
            data={HUBS.map((hub) => ({ module: hub.label, importers: hub.importers.length }))}
            keys={["importers"]}
            indexBy="module"
            layout="horizontal"
            height={STAGE_HEIGHT}
          />
        ) : null}
        <Stack direction="row" justify="between" align="center" wrap gap={2}>
          <ToggleGroup
            multiple
            value={LAYERS.flatMap((layer) => (hidden.includes(layer.id) ? [] : [layer.id]))}
            onValueChange={(shown: string[]) =>
              setHidden(LAYERS.flatMap((layer) => (shown.includes(layer.id) ? [] : [layer.id])))
            }
          >
            {LAYERS.map((layer, index) => (
              <Toggle key={layer.id} value={layer.id} size="xs">
                <span
                  aria-hidden="true"
                  style={{
                    ...SWATCH,
                    backgroundColor: rgba(palette?.layers[index] ?? [0.5, 0.5, 0.5], 1),
                  }}
                />
                {layer.id}
              </Toggle>
            ))}
          </ToggleGroup>
          <Switch label="WebGL" checked={gpu} onCheckedChange={setGpu} />
        </Stack>
        <Grid columns={2} gap={4}>
          <Grid columns={2} gap={3}>
            {[
              {
                label: "Modules",
                value: FILES.length,
                detail: `plus ${PACKAGES.length} packages`,
                tone: "neutral" as const,
              },
              {
                label: "Imports",
                value: GRAPH.imports.length,
                detail: `${VALUE_IMPORTS.length} carry values`,
                tone: "neutral" as const,
              },
              {
                label: "Runtime cycles",
                value: GRAPH.runtimeCycles,
                detail: `${GRAPH.typeCycles} modules cycle through types`,
                tone: GRAPH.runtimeCycles > 0 ? ("warning" as const) : ("success" as const),
              },
              {
                label: "Most imported",
                value: HUBS[0]?.importers.length ?? 0,
                detail: HUBS[0]?.label,
                tone: "neutral" as const,
              },
            ].map((stat) => (
              <Stat key={stat.label} {...stat} />
            ))}
          </Grid>
          <div style={{ minHeight: 176, minWidth: 0, overflow: "hidden" }}>
            <Details star={star} />
          </div>
        </Grid>
      </Stack>
      <div
        ref={probeRef}
        aria-hidden="true"
        style={{ ...absolute, width: 0, height: 0, overflow: "hidden" }}
      >
        {LAYERS.map((layer, index) => (
          <div key={layer.id} data-probe={index}>
            <Sparkline values={[0, 1]} tint={layer.tint} />
          </div>
        ))}
        <span data-probe="ink" style={{ color: "var(--nyte-content-primary)" }} />
      </div>
    </div>
  );
}
