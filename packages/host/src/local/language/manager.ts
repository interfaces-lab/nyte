import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyTextChange, asId, compile, isJson, SdkError, textOffset } from "@nyte-ai/schema";
import type {
  DiagnosticsFrame,
  Json,
  LanguageServerId,
  LanguageServerState,
  LanguageServerView,
  TextChange,
  TextPosition,
} from "@nyte-ai/schema";
import type { ExecutionEnv, LanguageService } from "@nyte-ai/core";
import { Type } from "typebox";
import { feed } from "../feed.ts";
import type { FeedSink } from "../feed.ts";
import { findExecutable, projectBins } from "../process/command.ts";
import {
  readDiagnostics,
  readHover,
  readInlayHints,
  readLocations,
  readPrepareRename,
  readProgress,
  readPublishedDiagnostics,
  readSignatureHelp,
  readSymbols,
  readTextEdits,
  readWorkspaceEdit,
  toLspPosition,
  toLspRange,
} from "./lsp.ts";
import type { Place } from "./lsp.ts";
import {
  answerConfiguration,
  initializeParams,
  NO_CAPABILITIES,
  readInitialize,
} from "./initialize.ts";
import { codeActions, completion, resolveCodeAction, resolveCompletion } from "./assist.ts";
import { connectLsp, LspError, REQUEST_CANCELLED } from "./rpc.ts";
import type { Document, Run, Servers, Slot, Synced } from "./state.ts";
import { findLinters, findProjectRoot, findServer } from "./servers.ts";
import type { ServerSpec } from "./servers.ts";

/** A server that dies more than `RESTARTS` times within `RESTART_WINDOW_MS` stays failed until a client opens a file again. */
export const RESTART_LIMIT = { restarts: 3, windowMs: 3 * 60_000 } as const;

/** A server with no request and no document change for this long shuts down; the next one starts it again. */
export const IDLE_MS = 10 * 60_000;

const START_DEADLINE_MS = 30_000;

const STOP_GRACE_MS = 2000;

const LOG_LINES = 200;

const ApplyEditRequest = compile(Type.Object({ edit: Type.Unknown() }));

const LogMessage = compile(Type.Object({ message: Type.String() }));

interface Report {
  readonly diagnostics: DiagnosticsFrame["diagnostics"];
  readonly raw: readonly Json[];
}

interface Published {
  readonly frame: DiagnosticsFrame;
  readonly reports: ReadonlyMap<Slot, Report>;
}

export function localLanguage(
  env: ExecutionEnv,
  options: {
    readonly trusted: () => Promise<boolean>;
    readonly servers?: Readonly<Record<string, string>>;
  },
): LanguageService {
  const workspace = env.cwd;
  const slots = new Map<string, Slot>();
  const documents = new Map<string, Document>();
  const published = new Map<string, Published>();
  const statusSinks = new Set<FeedSink<readonly LanguageServerView[]>>();
  const diagnosticSinks = new Set<FeedSink<readonly DiagnosticsFrame[]>>();
  let watching: AsyncIterator<unknown> | null = null;
  let completing = new AbortController();
  let closed = false;

  const absolute = (path: string): string => (isAbsolute(path) ? path : join(workspace, path));

  const within = (path: string): string => {
    const inside = relative(workspace, path);

    return inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)
      ? path
      : inside.split(sep).join("/");
  };

  const uri = (path: string): string => pathToFileURL(path).href;

  const place: Place = (address) =>
    address.startsWith("file:") ? within(fileURLToPath(address)) : null;

  const view = (slot: Slot): LanguageServerView => ({
    language: slot.spec.language,
    server: slot.spec.program,
    root: within(slot.root),
    state: slot.state,
    version: slot.version,
    executable: slot.executable,
  });

  const views = (): readonly LanguageServerView[] => [...slots.values()].map(view);

  const setState = (slot: Slot, state: LanguageServerState): void => {
    slot.state = state;
    const current = views();

    for (const sink of statusSinks) sink.push(current);
  };

  const record = (slot: Slot, text: string): void => {
    slot.log.push(...text.split("\n").filter((line) => line.trim() !== ""));
    slot.log.splice(0, Math.max(0, slot.log.length - LOG_LINES));
  };

  const touch = (slot: Slot): void => {
    if (slot.idle !== null) clearTimeout(slot.idle);
    slot.idle = setTimeout(() => void rest(slot), IDLE_MS);
    slot.idle.unref?.();
  };

  const findSlot = async (spec: ServerSpec, path: string): Promise<Slot> => {
    const root = await findProjectRoot(spec, path, workspace);
    const key = `${spec.program}\u0000${root}`;
    const found = slots.get(key);

    if (found !== undefined) return found;

    const slot: Slot = {
      spec,
      root,
      state: { kind: "idle" },
      run: null,
      starting: null,
      restarts: [],
      version: null,
      executable: null,
      idle: null,
      answers: 0,
      completion: null,
      actions: null,
      log: [],
    };

    slots.set(key, slot);

    return slot;
  };

  const holders = (document: Document): readonly Slot[] => [document.slot, ...document.linters];

  const findLinterSlots = async (path: string): Promise<readonly Slot[]> =>
    Promise.all((await findLinters(path, workspace)).map((spec) => findSlot(spec, path)));

  const forget = (document: Document): void => {
    documents.delete(document.path);

    for (const holder of holders(document)) closeIn(holder.run, document.path);
  };

  const attach = async (slot: Slot, document: Document): Promise<void> => {
    const run = await ready(slot);

    if (run !== null && documents.get(document.path) === document) openIn(run, document);
  };

  const openIn = (run: Run, document: Document): void => {
    if (!run.initialized || run.opened.has(document.path)) return;
    run.opened.add(document.path);
    run.rpc.notify("textDocument/didOpen", {
      textDocument: {
        uri: uri(document.path),
        languageId: document.languageId,
        version: document.version,
        text: document.text,
      },
    });
  };

  const closeIn = (run: Run | null, path: string): void => {
    if (run === null || !run.opened.delete(path)) return;
    run.rpc.notify("textDocument/didClose", { textDocument: { uri: uri(path) } });
  };

  const handlers = (slot: Slot, run: () => Run | null) => ({
    notification(method: string, params: unknown): void {
      if (method === "textDocument/publishDiagnostics") publish(slot, params);
      else if (method === "$/progress") progress(slot, run(), params);
      else if (
        (method === "window/logMessage" || method === "window/showMessage") &&
        LogMessage.Check(params)
      ) {
        record(slot, params.message);
      }
    },
    async request(method: string, params: unknown): Promise<Json> {
      if (method === "workspace/configuration") {
        return answerConfiguration(slot.spec.settings, params);
      }

      if (method === "workspace/workspaceFolders") {
        return [{ uri: uri(slot.root), name: basename(slot.root) }];
      }

      if (method === "workspace/applyEdit") return applyEdit(run(), params);

      return null;
    },
    stderr: (text: string) => record(slot, text),
  });

  const applyEdit = (run: Run | null, params: unknown): Json => {
    const collecting = run?.collecting ?? null;

    if (collecting === null || !ApplyEditRequest.Check(params)) {
      return {
        applied: false,
        failureReason: "Nyte takes a server's edits only while it resolves a code action.",
      };
    }
    const read = readWorkspaceEdit(params.edit, place);

    if (read.kind === "refused") return { applied: false, failureReason: read.reason };
    collecting.push(read.edit);

    return { applied: true };
  };

  const progress = (slot: Slot, run: Run | null, params: unknown): void => {
    const report = readProgress(params);

    if (run === null || report === null) return;

    if (report.kind === "end") run.progress.delete(report.token);
    else {
      run.progress.set(report.token, {
        title: report.title ?? run.progress.get(report.token)?.title ?? "",
        percent: report.percent,
      });
    }

    if (slot.run === run && run.initialized) setState(slot, workingState(run));
  };

  const workingState = (run: Run): LanguageServerState => {
    const last = [...run.progress.values()].at(-1);

    return last === undefined
      ? { kind: "ready" }
      : { kind: "busy", title: last.title, percent: last.percent };
  };

  const publish = (slot: Slot, params: unknown): void => {
    const found = readPublishedDiagnostics(params);

    if (found === null || !found.uri.startsWith("file:")) return;
    const path = fileURLToPath(found.uri);
    const document = documents.get(path);

    if (found.version !== null && document !== undefined && document.version !== found.version) {
      return;
    }

    const reports = new Map<Slot, Report>(published.get(path)?.reports).set(slot, {
      diagnostics: [...readDiagnostics(found.diagnostics, place)],
      raw: found.diagnostics.filter(isJson),
    });

    const frame: DiagnosticsFrame = {
      path: within(path),
      version: document?.owner === "client" ? document.version : null,
      diagnostics: [...reports.values()].flatMap((report) => report.diagnostics),
    };

    published.set(path, { frame, reports });

    for (const sink of diagnosticSinks) sink.push([frame]);
  };

  const start = (slot: Slot): Promise<Run | null> => {
    if (slot.starting !== null) return slot.starting;

    if (slot.run !== null) return Promise.resolve(slot.run.initialized ? slot.run : null);
    slot.starting = launch(slot)
      .catch((error: unknown) => {
        setState(slot, {
          kind: "failed",
          reason: `${slot.spec.program} could not start: ${message(error)}`,
        });

        return null;
      })
      .finally(() => {
        slot.starting = null;
      });

    return slot.starting;
  };

  const launch = async (slot: Slot): Promise<Run | null> => {
    const pinned = options.servers?.[slot.spec.program];

    const executable = await findExecutable(pinned ?? slot.spec.program, projectBins(slot.root));

    slot.executable = executable;

    if (executable === null) {
      setState(slot, { kind: "missing", hint: slot.spec.hint });

      return null;
    }

    if (!(await options.trusted())) {
      setState(slot, { kind: "untrusted" });

      return null;
    }

    setState(slot, { kind: "starting" });

    const job = await env
      .exec([executable, ...slot.spec.arguments], { cwd: slot.root, stdio: "protocol" })
      .catch((error: unknown) => {
        setState(slot, {
          kind: "failed",
          reason: `${slot.spec.program} could not start: ${message(error)}`,
        });

        return null;
      });

    if (job === null) return null;
    let current: Run | null = null;

    const rpc = connectLsp(
      job,
      handlers(slot, () => current),
    );

    const run: Run = {
      id: asId<"language-server">(crypto.randomUUID()),
      job,
      rpc,
      opened: new Set(),
      progress: new Map(),
      capabilities: NO_CAPABILITIES,
      initialized: false,
      stopping: false,
      collecting: null,
    };

    current = run;
    slot.run = run;
    void job.settled().then(
      (end) => exited(slot, run, end.kind === "exited" ? end.code : null),
      () => exited(slot, run, null),
    );

    const prepared = await slot.spec.prepare(slot.root);

    const answer = await rpc
      .request(
        "initialize",
        initializeParams(slot.root, prepared.options),
        AbortSignal.timeout(START_DEADLINE_MS),
      )
      .catch((error: unknown) => error);

    if (slot.run !== run) return null;
    const initialized = readInitialize(answer);

    if (initialized === null) {
      const reason =
        answer instanceof LspError && answer.code === REQUEST_CANCELLED
          ? `${slot.spec.program} did not answer within ${START_DEADLINE_MS / 1000} seconds of starting.`
          : `${slot.spec.program} could not start: ${answer instanceof Error ? answer.message : "it answered initialize unreadably"}.`;

      run.stopping = true;
      slot.run = null;
      setState(slot, { kind: "failed", reason });
      await job.stop().catch(() => undefined);

      return null;
    }

    run.capabilities = initialized.capabilities;
    slot.version =
      [initialized.version, prepared.runsOn].filter((part) => part !== null).join(", ") || null;
    rpc.notify("initialized", {});
    rpc.notify("workspace/didChangeConfiguration", { settings: slot.spec.settings });
    run.initialized = true;

    for (const document of documents.values()) {
      if (holders(document).includes(slot)) openIn(run, document);
    }

    setState(slot, workingState(run));
    touch(slot);
    watchFiles();

    return run;
  };

  const exited = (slot: Slot, run: Run, code: number | null): void => {
    if (slot.run !== run) return;
    slot.run = null;

    if (run.stopping || closed) return;
    record(slot, `${slot.spec.program} exited with code ${code ?? "none"}.`);
    const now = Date.now();
    slot.restarts = slot.restarts.filter((at) => now - at <= RESTART_LIMIT.windowMs);

    if (slot.restarts.length >= RESTART_LIMIT.restarts) {
      setState(slot, {
        kind: "failed",
        reason: `${slot.spec.program} stopped ${RESTART_LIMIT.restarts + 1} times in ${RESTART_LIMIT.windowMs / 60_000} minutes. Open a file to start it again.${tail(slot)}`,
      });

      return;
    }

    slot.restarts.push(now);
    setState(slot, { kind: "starting" });
    void Promise.resolve(slot.starting).then(() => (closed ? null : start(slot)));
  };

  const stop = async (slot: Slot): Promise<void> => {
    const run = slot.run;

    if (run === null) return;
    run.stopping = true;
    slot.run = null;
    await run.rpc
      .request("shutdown", null, AbortSignal.timeout(STOP_GRACE_MS))
      .catch(() => undefined);
    run.rpc.notify("exit", null);
    await run.job.settled({ signal: AbortSignal.timeout(STOP_GRACE_MS) }).catch(() => undefined);
    await run.job.stop().catch(() => undefined);
  };

  const rest = async (slot: Slot): Promise<void> => {
    slot.idle = null;

    if (slot.run === null) return;

    for (const document of documents.values()) {
      if (document.slot === slot && document.owner === "disk") forget(document);
    }

    setState(slot, { kind: "idle" });
    await stop(slot);
  };

  const ready = async (slot: Slot): Promise<Run | null> => {
    if (closed) return null;
    touch(slot);

    if (slot.run !== null && slot.starting === null) return slot.run.initialized ? slot.run : null;

    if (
      slot.state.kind === "missing" ||
      slot.state.kind === "failed" ||
      slot.state.kind === "untrusted"
    ) {
      return null;
    }

    return start(slot);
  };

  const refreshFromDisk = async (slot: Slot): Promise<void> => {
    await Promise.all(
      [...documents.values()].flatMap((document) =>
        document.slot === slot && document.owner === "disk"
          ? [
              (async () => {
                const text = await readText(document.path);

                if (text === null) {
                  forget(document);

                  return;
                }

                if (text === document.text) return;
                document.version += 1;
                document.text = text;
                sendChange(document, [{ range: null, text }]);
              })(),
            ]
          : [],
      ),
    );
  };

  const written = async (path: string): Promise<void> => {
    const document = documents.get(path);

    if (document?.owner !== "client") return;

    const runs = holders(document).flatMap((slot) =>
      slot.run !== null && slot.run.opened.has(path) && slot.run.capabilities.save !== "none"
        ? [slot.run]
        : [],
    );

    if (runs.length === 0 || (await readText(path)) !== document.text) return;
    const textDocument = { uri: uri(path) };

    for (const run of runs) {
      run.rpc.notify(
        "textDocument/didSave",
        run.capabilities.save === "text" ? { textDocument, text: document.text } : { textDocument },
      );
    }
  };

  const sync = async (path: string): Promise<Synced | null> => {
    const full = absolute(path);
    const found = findServer(full);

    if (found === null || closed) return null;
    const slot = documents.get(full)?.slot ?? (await findSlot(found.spec, full));
    await refreshFromDisk(slot);

    if (!documents.has(full)) {
      const text = await readText(full);
      const linters = await findLinterSlots(full);

      if (text === null) return null;

      if (!documents.has(full)) {
        const document: Document = {
          path: full,
          languageId: found.languageId,
          slot,
          linters,
          owner: "disk",
          text,
          version: 0,
        };

        documents.set(full, document);

        for (const linter of linters) void attach(linter, document);
      }
    }

    const document = documents.get(full);
    const run = await ready(slot);

    if (run === null || document === undefined || documents.get(full) !== document) return null;
    openIn(run, document);

    return { run, document, slot };
  };

  const sendChange = (document: Document, changes: readonly TextChange[]): void => {
    for (const slot of holders(document)) {
      const run = slot.run;

      if (run === null || !run.initialized || !run.opened.has(document.path)) continue;

      const incremental =
        run.capabilities.incremental && changes.every((change) => change.range !== null);

      run.rpc.notify("textDocument/didChange", {
        textDocument: { uri: uri(document.path), version: document.version },
        contentChanges: incremental
          ? changes.flatMap((change) =>
              change.range === null ? [] : [{ range: toLspRange(change.range), text: change.text }],
            )
          : [{ text: document.text }],
      });
    }
  };

  const ask = async <T>(
    path: string,
    empty: T,
    method: string,
    params: (target: { readonly uri: string; readonly document: Document }) => Json,
    read: (value: unknown, document: Document) => T,
  ): Promise<T> => {
    const synced = await sync(path);

    if (synced === null) return empty;

    const answer = await synced.run.rpc
      .request(method, params({ uri: uri(synced.document.path), document: synced.document }))
      .catch((error: unknown) => {
        if (!(error instanceof LspError)) throw error;
        record(synced.slot, `${method} failed: ${error.message}`);

        return undefined;
      });

    return answer === undefined ? empty : read(answer, synced.document);
  };

  const at = (address: string, position: TextPosition) => ({
    textDocument: { uri: address },
    position: toLspPosition(position),
  });

  const findRun = (server: LanguageServerId): { readonly slot: Slot; readonly run: Run } | null => {
    for (const slot of slots.values()) {
      if (slot.run?.id === server && slot.run.initialized) return { slot, run: slot.run };
    }

    return null;
  };

  const watchFiles = (): void => {
    if (watching !== null || closed) return;
    const iterator = env.files.watch()[Symbol.asyncIterator]();
    watching = iterator;

    void (async () => {
      for (;;) {
        const next = await iterator.next();

        if (next.done === true) return;

        for (const slot of slots.values()) {
          const run = slot.run;

          if (run === null || !run.initialized) continue;

          const changes = next.value.flatMap((event) => {
            const full = absolute(event.path);

            const wanted =
              findServer(full)?.spec === slot.spec || slot.spec.markers.includes(basename(full));

            if (!wanted || !full.startsWith(`${slot.root}${sep}`)) return [];

            const held = documents.get(full);

            if (held?.owner === "disk") forget(held);

            return [
              {
                uri: uri(full),
                type: event.kind === "created" ? 1 : event.kind === "modified" ? 2 : 3,
              },
            ];
          });

          if (changes.length > 0) run.rpc.notify("workspace/didChangeWatchedFiles", { changes });
        }

        for (const event of next.value) await written(absolute(event.path));
      }
    })().catch(() => {
      watching = null;
    });
  };

  const servers: Servers = {
    place,
    uri,
    sync,
    findRun,
    touch,
    claimCompletion() {
      completing.abort();
      completing = new AbortController();

      return completing.signal;
    },
    published: (slot, path) => published.get(path)?.reports.get(slot)?.raw ?? [],
  };

  return {
    status: async () => views(),
    watchStatus: () =>
      feed((sink) => {
        statusSinks.add(sink);
        sink.push(views());

        return () => statusSinks.delete(sink);
      }),
    async open(input) {
      const full = absolute(input.path);
      const found = findServer(full);

      if (found === null || closed) return null;
      const slot = await findSlot(found.spec, full);

      const linters = await findLinterSlots(full);

      const held = documents.get(full);

      for (const holder of held === undefined ? [] : holders(held)) closeIn(holder.run, full);

      const document: Document = {
        path: full,
        languageId: found.languageId,
        slot,
        linters,
        owner: "client",
        text: input.text,
        version: input.version,
      };

      documents.set(full, document);

      for (const holder of holders(document)) {
        if (
          holder.state.kind === "missing" ||
          holder.state.kind === "failed" ||
          holder.state.kind === "untrusted"
        ) {
          holder.restarts = [];
          setState(holder, { kind: "idle" });
        }
      }

      for (const linter of linters) void attach(linter, document);
      await attach(slot, document);

      return view(slot);
    },
    async change(input) {
      const document = documents.get(absolute(input.path));

      if (document === undefined || document.owner !== "client") {
        throw new SdkError("unknown", `${input.path} is not open. Open it first.`);
      }

      if (input.version <= document.version) {
        throw new SdkError(
          "stale",
          `${input.path} is at version ${document.version}, so version ${input.version} is stale. Open it again to start over.`,
        );
      }

      document.text = input.changes.reduce(applyTextChange, document.text);
      document.version = input.version;
      sendChange(document, input.changes);

      for (const holder of holders(document)) {
        touch(holder);

        if (holder.run === null) void ready(holder);
      }

      return null;
    },
    async close(input) {
      const full = absolute(input.path);
      const document = documents.get(full);

      if (document?.owner !== "client") return null;
      forget(document);

      for (const holder of holders(document)) touch(holder);

      return null;
    },
    diagnostics: () =>
      feed<readonly DiagnosticsFrame[]>(
        (sink) => {
          diagnosticSinks.add(sink);
          sink.push([...published.values()].map((entry) => entry.frame));

          return () => diagnosticSinks.delete(sink);
        },
        (waiting, next) => [
          ...waiting.filter((frame) => !next.some((fresh) => fresh.path === frame.path)),
          ...next,
        ],
      ),
    completion: (input) => completion(servers, input),
    resolveCompletion: (input) => resolveCompletion(servers, input),
    hover: (input) =>
      ask(
        input.path,
        null,
        "textDocument/hover",
        (target) => at(target.uri, input.position),
        readHover,
      ),
    definition: (input) =>
      ask(
        input.path,
        [],
        "textDocument/definition",
        (target) => at(target.uri, input.position),
        (value) => readLocations(value, place),
      ),
    typeDefinition: (input) =>
      ask(
        input.path,
        [],
        "textDocument/typeDefinition",
        (target) => at(target.uri, input.position),
        (value) => readLocations(value, place),
      ),
    references: (input) =>
      ask(
        input.path,
        [],
        "textDocument/references",
        (target) => ({
          ...at(target.uri, input.position),
          context: { includeDeclaration: input.includeDeclaration },
        }),
        (value) => readLocations(value, place),
      ),
    symbols: (input) =>
      ask(
        input.path,
        [],
        "textDocument/documentSymbol",
        (target) => ({ textDocument: { uri: target.uri } }),
        readSymbols,
      ),
    prepareRename: (input) =>
      ask(
        input.path,
        null,
        "textDocument/prepareRename",
        (target) => at(target.uri, input.position),
        (value, document) =>
          readPrepareRename(value, (range) =>
            document.text.slice(
              textOffset(document.text, range.start),
              textOffset(document.text, range.end),
            ),
          ),
      ),
    async rename(input) {
      const synced = await sync(input.path);

      if (synced === null) {
        return { kind: "refused", reason: `No language server can rename in ${input.path}.` };
      }

      const answer = await synced.run.rpc
        .request("textDocument/rename", {
          ...at(uri(synced.document.path), input.position),
          newName: input.name,
        })
        .catch((error: unknown) => {
          if (error instanceof LspError) return error;
          throw error;
        });

      if (answer instanceof LspError) return { kind: "refused", reason: answer.message };

      return answer === null
        ? { kind: "refused", reason: "There is nothing to rename here." }
        : readWorkspaceEdit(answer, place);
    },
    codeActions: (input) => codeActions(servers, input),
    resolveCodeAction: (input) => resolveCodeAction(servers, input),
    async format(input) {
      const synced = await sync(input.path);

      if (synced === null || !synced.run.capabilities.formats) {
        return {
          kind: "unavailable",
          reason: `No language server formats ${basename(input.path)}.`,
        };
      }

      return synced.run.rpc
        .request("textDocument/formatting", {
          textDocument: { uri: uri(synced.document.path) },
          options: input.options,
        })
        .then(
          (answer) => ({ kind: "edits", edits: readTextEdits(answer) }) as const,
          (error: unknown) => {
            if (!(error instanceof LspError)) throw error;
            record(synced.slot, `textDocument/formatting failed: ${error.message}`);

            return { kind: "failed", reason: error.message } as const;
          },
        );
    },
    signatureHelp: (input) =>
      ask(
        input.path,
        null,
        "textDocument/signatureHelp",
        (target) => at(target.uri, input.position),
        readSignatureHelp,
      ),
    inlayHints: (input) =>
      ask(
        input.path,
        [],
        "textDocument/inlayHint",
        (target) => ({ textDocument: { uri: target.uri }, range: toLspRange(input.range) }),
        readInlayHints,
      ),
    async trustChanged(trusted) {
      if (trusted) {
        for (const slot of slots.values()) {
          if (slot.state.kind === "untrusted") {
            setState(slot, { kind: "idle" });

            if ([...documents.values()].some((document) => holders(document).includes(slot))) {
              void ready(slot);
            }
          }
        }

        return;
      }

      await Promise.all(
        [...slots.values()].map(async (slot) => {
          if (slot.state.kind === "missing") return;
          setState(slot, { kind: "untrusted" });
          await stop(slot);
        }),
      );
    },
    async shutdown() {
      closed = true;
      void watching?.return?.();
      watching = null;

      for (const sink of [...statusSinks, ...diagnosticSinks]) sink.end();

      await Promise.all(
        [...slots.values()].map(async (slot) => {
          if (slot.idle !== null) clearTimeout(slot.idle);
          slot.idle = null;
          await stop(slot);
        }),
      );
    },
  };
}

async function readText(path: string): Promise<string | null> {
  return readFile(path, "utf8").catch(() => null);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tail(slot: Slot): string {
  const last = slot.log.slice(-3).join(" ");

  return last === "" ? "" : ` Its log ends: ${last}`;
}
