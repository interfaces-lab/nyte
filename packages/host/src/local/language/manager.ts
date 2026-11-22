import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyTextChange, asId, compile, findLanguage, SdkError } from "@nyte-ai/schema";
import type {
  Json,
  LanguageRefresh,
  LanguageServerId,
  LanguageServerState,
  LanguageServerView,
  TextChange,
} from "@nyte-ai/schema";
import type { ExecutionEnv, LanguageService } from "@nyte-ai/core";
import { Type } from "typebox";
import { feed } from "../feed.ts";
import type { FeedSink } from "../feed.ts";
import { findExecutable, hostNode, projectBins } from "../process/command.ts";
import {
  codeActions,
  completion,
  documentLinks,
  resolveCodeAction,
  resolveCompletion,
  resolveDocumentLink,
} from "./assist.ts";
import {
  findProvider,
  listFeatures,
  NO_CAPABILITIES,
  operatesOn,
  PROVIDERS,
  register,
  unregister,
  watches,
} from "./capabilities.ts";
import { diagnosticReports } from "./diagnostics.ts";
import { languageFeatures } from "./features.ts";
import { languageHierarchies } from "./hierarchy.ts";
import { answerConfiguration, initializeParams, readInitialize } from "./initialize.ts";
import type { Installer } from "./install.ts";
import { readProgress, readWorkspaceEdit, toLspRange } from "./lsp.ts";
import type { Place } from "./lsp.ts";
import { openProject, passesProbe } from "./project.ts";
import { connectLsp, LspError, METHOD_NOT_FOUND, REQUEST_CANCELLED } from "./rpc.ts";
import { findServers } from "./servers.ts";
import type { ServerSpec } from "./spec.ts";
import type { Document, Run, Servers, Slot, Synced, Target } from "./state.ts";

export const RESTART_LIMIT = { restarts: 3, windowMs: 3 * 60_000 } as const;

export const IDLE_MS = 10 * 60_000;

const START_DEADLINE_MS = 30_000;

const STOP_GRACE_MS = 2000;

const LOG_LINES = 200;

const FILE_NOTICES = [
  { kind: "created", provider: "filesCreated" },
  { kind: "removed", provider: "filesDeleted" },
] as const;

const ApplyEditRequest = compile(Type.Object({ edit: Type.Unknown() }));

const LogMessage = compile(Type.Object({ message: Type.String() }));

export function localLanguage(
  env: ExecutionEnv,
  options: {
    readonly trusted: () => Promise<boolean>;
    readonly servers?: Readonly<Record<string, string>>;
    readonly installer?: Installer;
  },
): LanguageService {
  const workspace = env.cwd;
  const slots = new Map<string, Slot>();
  const documents = new Map<string, Document>();
  const statusSinks = new Set<FeedSink<readonly LanguageServerView[]>>();
  const refreshSinks = new Set<FeedSink<readonly LanguageRefresh[]>>();
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

  const uri = (path: string): string => pathToFileURL(absolute(path)).href;

  const place: Place = (address) => {
    if (!address.startsWith("file:")) return null;

    try {
      return within(fileURLToPath(address));
    } catch {
      return null;
    }
  };

  const record = (slot: Slot, text: string): void => {
    slot.log.push(...text.split("\n").filter((line) => line.trim() !== ""));
    slot.log.splice(0, Math.max(0, slot.log.length - LOG_LINES));
  };

  const reports = diagnosticReports({
    place,
    within,
    uri,
    record,
    document: (path) => documents.get(path),
  });

  const view = (slot: Slot): LanguageServerView => ({
    languages: [...slot.spec.languages],
    server: slot.spec.name,
    root: within(slot.root),
    state: slot.state,
    version: slot.version,
    executable: slot.executable,
    features: slot.run !== null && slot.run.initialized ? [...listFeatures(slot.run)] : [],
  });

  const views = (): readonly LanguageServerView[] => [...slots.values()].map(view);

  const announce = (): void => {
    const current = views();

    for (const sink of statusSinks) sink.push(current);
  };

  const setState = (slot: Slot, state: LanguageServerState): void => {
    slot.state = state;
    announce();
  };

  const touch = (slot: Slot): void => {
    if (slot.idle !== null) clearTimeout(slot.idle);
    slot.idle = setTimeout(() => void rest(slot), IDLE_MS);
    slot.idle.unref?.();
  };

  const findSlot = (spec: ServerSpec, root: string): Slot => {
    const key = `${spec.name}\u0000${root}`;
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
      hierarchies: { callHierarchy: null, typeHierarchy: null },
      links: new Map(),
      log: [],
    };

    slots.set(key, slot);

    return slot;
  };

  const forget = (document: Document): void => {
    documents.delete(document.path);

    for (const slot of document.slots) closeIn(slot, document.path);
  };

  const attach = async (slot: Slot, document: Document): Promise<void> => {
    const run = await ready(slot);

    if (run !== null && documents.get(document.path) === document) openIn({ slot, run }, document);
  };

  const openIn = (target: Target, document: Document): void => {
    const run = target.run;

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
    reports.pull(target, document);
  };

  const closeIn = (slot: Slot, path: string): void => {
    const run = slot.run;

    slot.links.delete(uri(path));

    if (run === null || !run.opened.delete(path)) return;
    run.rpc.notify("textDocument/didClose", { textDocument: { uri: uri(path) } });
    reports.drop(slot, run, path);
  };

  const pullOpened = (target: Target): void => {
    for (const path of target.run.opened) {
      const document = documents.get(path);

      if (document !== undefined) reports.pull(target, document);
    }
  };

  const refresh = (asked: LanguageRefresh): void => {
    for (const sink of refreshSinks) sink.push([asked]);
  };

  const handlers = (slot: Slot, current: () => Run | null) => ({
    notification(method: string, params: unknown): void {
      if (method === "textDocument/publishDiagnostics") reports.publish(slot, params);
      else if (method === "$/progress") progress(slot, current(), params);
      else if (
        (method === "window/logMessage" || method === "window/showMessage") &&
        LogMessage.Check(params)
      ) {
        record(slot, params.message);
      }
    },
    async request(method: string, params: unknown): Promise<Json> {
      const run = current();

      switch (method) {
        case "workspace/configuration":
          return answerConfiguration(run?.settings ?? slot.spec.settings, params);
        case "workspace/workspaceFolders":
          return [{ uri: uri(slot.root), name: basename(slot.root) }];
        case "workspace/applyEdit":
          return applyEdit(run, params);
        case "client/registerCapability":
        case "client/unregisterCapability":
          if (run === null) return null;

          if (method === "client/registerCapability") register(run.registrations, params);
          else unregister(run.registrations, params);
          announce();
          pullOpened({ slot, run });

          return null;
        case "workspace/semanticTokens/refresh":
          refresh("semanticTokens");

          return null;
        case "workspace/inlayHint/refresh":
          refresh("inlayHints");

          return null;
        case "workspace/diagnostic/refresh":
          if (run !== null) pullOpened({ slot, run });

          return null;
        case "window/workDoneProgress/create":
        case "window/showMessageRequest":
          return null;
        default: {
          const reply = slot.spec.replies?.[method];

          if (reply === undefined) {
            throw new LspError(METHOD_NOT_FOUND, `Nyte does not answer ${method}.`);
          }

          return reply;
        }
      }
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

  const start = (slot: Slot): Promise<Run | null> => {
    if (slot.starting !== null) return slot.starting;

    if (slot.run !== null) return Promise.resolve(slot.run.initialized ? slot.run : null);
    slot.starting = launch(slot)
      .catch((error: unknown) => {
        setState(slot, {
          kind: "failed",
          reason: `${slot.spec.name} could not start: ${message(error)}`,
        });

        return null;
      })
      .finally(() => {
        slot.starting = null;
      });

    return slot.starting;
  };

  const locate = async (
    slot: Slot,
  ): Promise<{
    readonly command: readonly string[];
    readonly env: Readonly<Record<string, string>>;
    readonly version: string | null;
  } | null> => {
    const spec = slot.spec;
    const configured = options.servers?.[spec.name];
    const found = await findExecutable(configured ?? spec.program, projectBins(slot.root));

    const download =
      configured === undefined && options.installer !== undefined && spec.install !== null
        ? { installer: options.installer, source: spec.install }
        : null;

    slot.executable = found;

    if (found === null && download === null) {
      setState(slot, { kind: "missing", hint: spec.installHint });

      return null;
    }

    if (!(await options.trusted())) {
      setState(slot, { kind: "untrusted" });

      return null;
    }

    if (
      spec.runtime !== null &&
      !(await passesProbe(spec.runtime.program, spec.runtime.probe, slot.root))
    ) {
      setState(slot, { kind: "missing", hint: spec.runtime.installHint });

      return null;
    }

    if (
      found !== null &&
      (spec.probe === null || (await passesProbe(found, spec.probe, slot.root)))
    ) {
      return { command: [found], env: {}, version: null };
    }

    if (download === null) {
      setState(slot, {
        kind: "missing",
        hint: `${found} is there but does not run. ${spec.installHint}`,
      });

      return null;
    }

    setState(slot, { kind: "installing", percent: null });

    const installed = await download.installer
      .install(download.source, (percent) => {
        if (slot.state.kind === "installing") setState(slot, { kind: "installing", percent });
      })
      .catch((error: unknown) => {
        setState(slot, { kind: "missing", hint: `${message(error)} ${spec.installHint}` });

        return null;
      });

    if (installed === null) return null;
    slot.executable = installed.path;

    const version = download.source.version;

    if (installed.kind === "binary") return { command: [installed.path], env: {}, version };
    const node = hostNode();

    return { command: [...node.command, installed.path], env: node.env, version };
  };

  const launch = async (slot: Slot): Promise<Run | null> => {
    const located = await locate(slot);

    if (located === null || closed) return null;
    setState(slot, { kind: "starting" });

    const prepared =
      slot.spec.prepare === undefined
        ? {}
        : await slot.spec.prepare(openProject(slot.root, options.installer));

    if (closed) return null;

    if (!(await options.trusted())) {
      setState(slot, { kind: "untrusted" });

      return null;
    }

    const job = await env
      .exec([...located.command, ...slot.spec.arguments], {
        cwd: slot.root,
        env: located.env,
        stdio: "protocol",
      })
      .catch((error: unknown) => {
        setState(slot, {
          kind: "failed",
          reason: `${slot.spec.name} could not start: ${message(error)}`,
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
      registrations: new Map(),
      capabilities: NO_CAPABILITIES,
      settings: prepared.settings ?? slot.spec.settings,
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

    const answer = await rpc
      .request(
        "initialize",
        initializeParams(
          slot.root,
          prepared.initializationOptions ?? slot.spec.initializationOptions,
        ),
        AbortSignal.timeout(START_DEADLINE_MS),
      )
      .catch((error: unknown) => error);

    if (slot.run !== run) return null;
    const initialized = readInitialize(answer);

    if (initialized === null) {
      const reason =
        answer instanceof LspError && answer.code === REQUEST_CANCELLED
          ? `${slot.spec.name} did not answer within ${START_DEADLINE_MS / 1000} seconds of starting.`
          : `${slot.spec.name} could not start: ${answer instanceof Error ? answer.message : "it answered initialize unreadably"}.`;

      run.stopping = true;
      slot.run = null;
      setState(slot, { kind: "failed", reason });
      await job.stop().catch(() => undefined);

      return null;
    }

    run.capabilities = initialized.capabilities;

    const reported =
      initialized.version === null
        ? null
        : (slot.spec.readVersion?.(initialized.version) ?? initialized.version);

    slot.version =
      [reported ?? located.version, prepared.runsOn ?? null]
        .filter((part) => part !== null)
        .join(", ") || null;
    rpc.notify("initialized", {});
    rpc.notify("workspace/didChangeConfiguration", { settings: run.settings });
    run.initialized = true;

    for (const document of documents.values()) {
      if (document.slots.includes(slot)) openIn({ slot, run }, document);
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
    record(slot, `${slot.spec.name} exited with code ${code ?? "none"}.`);
    const now = Date.now();
    slot.restarts = slot.restarts.filter((at) => now - at <= RESTART_LIMIT.windowMs);

    if (slot.restarts.length >= RESTART_LIMIT.restarts) {
      setState(slot, {
        kind: "failed",
        reason: `${slot.spec.name} stopped ${RESTART_LIMIT.restarts + 1} times in ${RESTART_LIMIT.windowMs / 60_000} minutes. Open a file to start it again.${tail(slot)}`,
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
      if (
        document.owner === "disk" &&
        document.slots.every((holder) => holder === slot || holder.run === null)
      ) {
        forget(document);
      }
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

  const refreshFromDisk = async (holders: readonly Slot[]): Promise<void> => {
    await Promise.all(
      [...documents.values()].flatMap((document) =>
        document.owner === "disk" && document.slots.some((slot) => holders.includes(slot))
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

    const targets = document.slots.flatMap((slot) =>
      slot.run !== null && slot.run.opened.has(path) ? [{ slot, run: slot.run }] : [],
    );

    if (targets.length === 0 || (await readText(path)) !== document.text) return;
    const textDocument = { uri: uri(path) };

    for (const target of targets) {
      const save = target.run.capabilities.save;

      if (save !== "none") {
        target.run.rpc.notify(
          "textDocument/didSave",
          save === "text" ? { textDocument, text: document.text } : { textDocument },
        );
      }

      reports.pull(target, document);
    }
  };

  const findSlots = async (
    path: string,
  ): Promise<{ readonly languageId: string; readonly slots: readonly Slot[] } | null> => {
    const found = closed ? null : await findServers(path, workspace);

    return found === null || found.servers.length === 0
      ? null
      : {
          languageId: found.languageId,
          slots: found.servers.map((server) => findSlot(server.spec, server.root)),
        };
  };

  const sync = async (path: string): Promise<Synced | null> => {
    const full = absolute(path);

    if (!documents.has(full)) {
      const found = await findSlots(full);
      const text = found === null ? null : await readText(full);

      if (found === null || text === null) return null;

      if (!documents.has(full)) {
        documents.set(full, {
          path: full,
          languageId: found.languageId,
          slots: found.slots,
          owner: "disk",
          text,
          version: 0,
        });
      }
    }

    const held = documents.get(full);

    if (held === undefined || closed) return null;
    await refreshFromDisk(held.slots);
    const document = documents.get(full);

    if (document === undefined) return null;
    const runs = await Promise.all(document.slots.map(ready));

    if (documents.get(full) !== document) return null;

    const targets = document.slots.flatMap((slot, index) => {
      const run = runs[index] ?? null;

      return run === null ? [] : [{ slot, run }];
    });

    for (const target of targets) openIn(target, document);

    return { document, targets };
  };

  const sendChange = (document: Document, changes: readonly TextChange[]): void => {
    for (const slot of document.slots) {
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
      reports.pull({ slot, run }, document);
    }
  };

  const running = (): readonly Target[] =>
    [...slots.values()].flatMap((slot) =>
      slot.run !== null && slot.run.initialized ? [{ slot, run: slot.run }] : [],
    );

  const findRun = (server: LanguageServerId): Target | null =>
    running().find((target) => target.run.id === server) ?? null;

  const watchFiles = (): void => {
    if (watching !== null || closed) return;
    const iterator = env.files.watch()[Symbol.asyncIterator]();
    watching = iterator;

    void (async () => {
      for (;;) {
        const next = await iterator.next();

        if (next.done === true) return;
        const events = next.value.map((event) => ({ ...event, full: absolute(event.path) }));

        for (const event of events) {
          const held = documents.get(event.full);

          if (held?.owner === "disk") forget(held);
        }

        for (const target of running()) {
          const spec = target.slot.spec;
          const root = target.slot.root;

          const changes = events.flatMap((event) => {
            const language = findLanguage(event.full)?.name;

            const wanted =
              (language !== undefined && spec.languages.includes(language)) ||
              spec.rootMarkers.includes(basename(event.full)) ||
              watches(target.run, event.full, root);

            return wanted && event.full.startsWith(`${root}${sep}`)
              ? [
                  {
                    uri: uri(event.full),
                    type: event.kind === "created" ? 1 : event.kind === "modified" ? 2 : 3,
                  },
                ]
              : [];
          });

          if (changes.length > 0) {
            target.run.rpc.notify("workspace/didChangeWatchedFiles", { changes });
          }

          for (const notice of FILE_NOTICES) {
            const provider = findProvider(target.run, notice.provider, null);

            const files =
              provider === null
                ? []
                : events.flatMap((event) =>
                    event.kind === notice.kind &&
                    event.full.startsWith(`${root}${sep}`) &&
                    operatesOn(provider, event.full, null)
                      ? [{ uri: uri(event.full) }]
                      : [],
                  );

            if (files.length > 0) {
              target.run.rpc.notify(PROVIDERS[notice.provider].method, { files });
            }
          }
        }

        for (const event of events) await written(event.full);
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
    running,
    touch,
    record,
    claimCompletion() {
      completing.abort();
      completing = new AbortController();

      return completing.signal;
    },
    reported: (slot, path) => reports.reported(slot, path),
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
      const found = await findSlots(full);

      if (found === null) return [];
      const held = documents.get(full);

      for (const slot of held?.slots ?? []) closeIn(slot, full);

      const document: Document = {
        path: full,
        languageId: found.languageId,
        slots: found.slots,
        owner: "client",
        text: input.text,
        version: input.version,
      };

      documents.set(full, document);

      for (const slot of found.slots) {
        if (
          slot.state.kind === "missing" ||
          slot.state.kind === "failed" ||
          slot.state.kind === "untrusted"
        ) {
          slot.restarts = [];
          setState(slot, { kind: "idle" });
        }
      }

      await Promise.all(found.slots.map((slot) => attach(slot, document)));

      return found.slots.map(view);
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

      for (const slot of document.slots) {
        touch(slot);

        if (slot.run === null) void ready(slot);
      }

      return null;
    },
    async close(input) {
      const document = documents.get(absolute(input.path));

      if (document?.owner !== "client") return null;
      forget(document);

      for (const slot of document.slots) touch(slot);

      return null;
    },
    diagnostics: () => reports.watch(),
    refreshes: () =>
      feed<readonly LanguageRefresh[]>(
        (sink) => {
          refreshSinks.add(sink);

          return () => refreshSinks.delete(sink);
        },
        (waiting, next) => [...new Set([...waiting, ...next])],
      ),
    completion: (input) => completion(servers, input),
    resolveCompletion: (input) => resolveCompletion(servers, input),
    codeActions: (input) => codeActions(servers, input),
    resolveCodeAction: (input) => resolveCodeAction(servers, input),
    documentLinks: (input) => documentLinks(servers, input),
    resolveDocumentLink: (input) => resolveDocumentLink(servers, input),
    ...languageFeatures(servers),
    ...languageHierarchies(servers),
    async trustChanged(trusted) {
      if (trusted) {
        for (const slot of slots.values()) {
          if (slot.state.kind === "untrusted") {
            setState(slot, { kind: "idle" });

            if ([...documents.values()].some((document) => document.slots.includes(slot))) {
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
      reports.end();

      for (const sink of [...statusSinks, ...refreshSinks]) sink.end();

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
