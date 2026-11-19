import type { SessionId } from "@nyte-ai/sdk";
import type { parsePatchFiles } from "@nyte-ai/ui/diffs";
import { loadDeferred, readDeferred } from "../lib/deferred.tsx";
import { shineAgent } from "../light/light.ts";
import type { ChatEdit } from "../workbench/editor/chat-changes.ts";
import { lineChanges } from "../workbench/editor/line-changes.ts";

interface DesignPatch {
  readonly design: string;
  readonly patch: string;
  readonly session: SessionId;
  readonly at: number;
}

interface Pending {
  readonly path: string;
  readonly patch: string;
  readonly session: SessionId;
  readonly until: number;
}

const PLACE_MS = 5_000;

export const designFile = (design: string): boolean =>
  design.startsWith("design/") && (design.endsWith(".jsx") || design.endsWith(".css"));

export interface AgentLights {
  notice(edits: readonly ChatEdit[] | undefined): void;
  place(): void;
  dispose(): void;
}

export function followAgentLights(input: {
  readonly folder: string;
  readonly readText: (path: string) => string | undefined;
  readonly since: number;
}): AgentLights {
  const seen = new Set<string>();
  let pending: readonly Pending[] = [];
  let disposed = false;

  const place = (): void => {
    if (disposed || pending.length === 0) return;
    const parse = readDeferred("workbench")?.parsePatchFiles;

    if (parse === undefined) {
      void loadDeferred("workbench").then(place, () => undefined);

      return;
    }

    const now = Date.now();

    const placed = pending.map((made) => {
      const text = input.readText(made.path);

      return { made, spans: text === undefined ? undefined : agentSpans(parse, made.patch, text) };
    });

    pending = placed.flatMap((entry) =>
      entry.spans === undefined && entry.made.until > now ? [entry.made] : [],
    );

    for (const entry of placed)
      for (const span of entry.spans ?? [])
        shineAgent(
          { kind: "span", path: entry.made.path, ...span },
          { kind: "agent", session: entry.made.session },
        );
  };

  return {
    notice(edits) {
      if (disposed) return;
      const now = Date.now();

      const fresh = designPatches(input.folder, edits).filter((made) => {
        const key = `${made.session}\n${String(made.at)}\n${made.design}\n${made.patch}`;

        if (seen.has(key)) return false;
        seen.add(key);

        return made.at >= input.since;
      });

      if (fresh.length === 0) return;

      pending = [
        ...pending,
        ...fresh.map((made) => ({
          path: `${input.folder}/${made.design}`,
          patch: made.patch,
          session: made.session,
          until: now + PLACE_MS,
        })),
      ];

      place();
    },
    place,
    dispose() {
      disposed = true;
      pending = [];
      seen.clear();
    },
  };
}

function agentSpans(
  parse: typeof parsePatchFiles,
  patch: string,
  text: string,
): readonly { readonly start: number; readonly end: number }[] | undefined {
  const diff = parse(patch)[0]?.files[0];

  if (diff === undefined) return [];
  const lines = text.split("\n").map((line) => line.replace(/\r$/u, ""));
  let offset = 0;

  const starts = text.split("\n").map((line) => {
    const start = offset;
    offset += line.length + 1;

    return start;
  });

  const added = lineChanges(diff).filter((change) => change.added.length > 0);

  const fits = added.every((change) =>
    change.added.every((line, index) => lines[change.start - 1 + index] === line),
  );

  if (!fits) return undefined;

  return added.map((change) => {
    const first = change.start - 1;
    const last = first + change.added.length - 1;

    return {
      start: starts[first] ?? 0,
      end: (starts[last] ?? 0) + (lines[last]?.length ?? 0),
    };
  });
}

function designPatches(
  folder: string,
  edits: readonly ChatEdit[] | undefined,
): readonly DesignPatch[] {
  if (edits === undefined) return [];

  return edits.flatMap((edit) => {
    const design = edit.path.startsWith(`${folder}/`)
      ? edit.path.slice(folder.length + 1)
      : edit.path;

    return designFile(design) ? edit.patches.map((made) => ({ ...made, design })) : [];
  });
}
