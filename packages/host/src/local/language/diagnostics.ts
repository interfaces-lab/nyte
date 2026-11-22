import { fileURLToPath } from "node:url";
import { compile, isJson } from "@nyte-ai/schema";
import type { DiagnosticsFrame, Json } from "@nyte-ai/schema";
import { Type } from "typebox";
import { feed } from "../feed.ts";
import type { FeedSink } from "../feed.ts";
import { findProvider } from "./capabilities.ts";
import { readDiagnostics, readPublishedDiagnostics } from "./lsp.ts";
import type { Place } from "./lsp.ts";
import { LspError } from "./rpc.ts";
import type { Document, Run, Slot, Target } from "./state.ts";

const DocumentReport = Type.Union([
  Type.Object({
    kind: Type.Literal("full"),
    resultId: Type.Optional(Type.String()),
    items: Type.Array(Type.Unknown()),
  }),
  Type.Object({ kind: Type.Literal("unchanged"), resultId: Type.String() }),
]);

const PulledReport = compile(
  Type.Intersect([
    DocumentReport,
    Type.Object({
      relatedDocuments: Type.Optional(Type.Record(Type.String(), DocumentReport)),
    }),
  ]),
);

interface Report {
  readonly diagnostics: DiagnosticsFrame["diagnostics"];
  readonly raw: readonly Json[];
}

interface Reported {
  pushed: Report | null;
  pulled: Report | null;
}

interface Pulling {
  readonly cancel: AbortController;
  readonly resultId: string | null;
}

export interface DiagnosticReports {
  publish(slot: Slot, params: unknown): void;
  pull(target: Target, document: Document): void;
  drop(slot: Slot, run: Run, path: string): void;
  reported(slot: Slot, path: string): readonly Json[];
  watch(): AsyncIterable<readonly DiagnosticsFrame[]>;
  end(): void;
}

export function diagnosticReports(input: {
  readonly place: Place;
  within(path: string): string;
  uri(path: string): string;
  document(path: string): Document | undefined;
  record(slot: Slot, text: string): void;
}): DiagnosticReports {
  const files = new Map<
    string,
    { frame: DiagnosticsFrame; readonly reports: Map<Slot, Reported> }
  >();

  const pulling = new WeakMap<Run, Map<string, Pulling>>();
  const sinks = new Set<FeedSink<readonly DiagnosticsFrame[]>>();

  const read = (raw: readonly unknown[]): Report => ({
    diagnostics: [...readDiagnostics(raw, input.place)],
    raw: raw.filter(isJson),
  });

  const set = (slot: Slot, path: string, change: Partial<Reported>): void => {
    const file = files.get(path) ?? {
      frame: { path: input.within(path), version: null, diagnostics: [] },
      reports: new Map<Slot, Reported>(),
    };

    const document = input.document(path);

    file.reports.set(slot, { pushed: null, pulled: null, ...file.reports.get(slot), ...change });
    file.frame = {
      path: file.frame.path,
      version: document?.owner === "client" ? document.version : null,
      diagnostics: [...file.reports.values()].flatMap((reported) => [
        ...(reported.pushed?.diagnostics ?? []),
        ...(reported.pulled?.diagnostics ?? []),
      ]),
    };
    files.set(path, file);

    for (const sink of sinks) sink.push([file.frame]);
  };

  const requests = (run: Run): Map<string, Pulling> => {
    const found = pulling.get(run) ?? new Map<string, Pulling>();

    pulling.set(run, found);

    return found;
  };

  return {
    publish(slot, params) {
      const found = readPublishedDiagnostics(params);

      if (found === null || !found.uri.startsWith("file:")) return;
      const path = fileURLToPath(found.uri);
      const document = input.document(path);

      if (found.version !== null && document !== undefined && document.version !== found.version) {
        return;
      }

      set(slot, path, { pushed: read(found.diagnostics) });
    },
    pull(target, document) {
      const provider = findProvider(target.run, "diagnostics", document);

      if (provider === null) return;
      const held = requests(target.run);
      const last = held.get(document.path);
      const cancel = new AbortController();

      last?.cancel.abort();
      held.set(document.path, { cancel, resultId: last?.resultId ?? null });

      void target.run.rpc
        .request(
          "textDocument/diagnostic",
          {
            textDocument: { uri: input.uri(document.path) },
            ...(typeof provider.identifier === "string" ? { identifier: provider.identifier } : {}),
            ...(last === undefined || last.resultId === null
              ? {}
              : { previousResultId: last.resultId }),
          },
          cancel.signal,
        )
        .then(
          (answer) => {
            if (cancel.signal.aborted || !PulledReport.Check(answer)) return;
            held.set(document.path, { cancel, resultId: answer.resultId ?? null });

            if (answer.kind === "full") {
              set(target.slot, document.path, { pulled: read(answer.items) });
            }

            for (const related of Object.entries(answer.relatedDocuments ?? {})) {
              if (related[1].kind === "full" && related[0].startsWith("file:")) {
                set(target.slot, fileURLToPath(related[0]), { pulled: read(related[1].items) });
              }
            }
          },
          (error: unknown) => {
            if (!(error instanceof LspError)) throw error;

            if (!cancel.signal.aborted) {
              input.record(target.slot, `textDocument/diagnostic failed: ${error.message}`);
            }
          },
        );
    },
    drop(slot, run, path) {
      const held = requests(run);

      held.get(path)?.cancel.abort();
      held.delete(path);

      const pulled = files.get(path)?.reports.get(slot)?.pulled ?? null;

      if (pulled !== null) set(slot, path, { pulled: null });
    },
    reported(slot, path) {
      const found = files.get(path)?.reports.get(slot);

      return [...(found?.pushed?.raw ?? []), ...(found?.pulled?.raw ?? [])];
    },
    watch: () =>
      feed<readonly DiagnosticsFrame[]>(
        (sink) => {
          sinks.add(sink);
          sink.push([...files.values()].map((file) => file.frame));

          return () => sinks.delete(sink);
        },
        (waiting, next) => [
          ...waiting.filter((frame) => !next.some((fresh) => fresh.path === frame.path)),
          ...next,
        ],
      ),
    end() {
      for (const sink of sinks) sink.end();
    },
  };
}
