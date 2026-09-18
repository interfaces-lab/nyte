/**
 * The interactive shell: one host, one followed session, one composer. Every
 * durable fact on screen comes from `SessionState`; every submission goes
 * through the outbox. Local `!` commands never enter the job or model loop.
 */
import process from "node:process";
import { basename, resolve } from "node:path";
import { homedir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import open from "open";
import {
  CliRenderEvents,
  createCliRenderer,
  decodePasteBytes,
  PasteEvent,
  SyntaxStyle,
} from "@opentui/core";
import type { ClipboardService, CliRenderer, KeyEvent } from "@opentui/core";
import { formatSkillInvocation } from "@nyte-ai/core/plugins";
import { createTrustStore, pluginWatchTargets, resolveHostPlugins } from "@nyte-ai/host";
import { createOtelExport } from "@nyte-ai/host/otel";
import { createUsageScanCaches, readAccountUsage, readLocalUsage } from "@nyte-ai/host/usage";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@nyte-ai/ai";
import type { Api, AuthInteraction, Model } from "@nyte-ai/ai";
import { collectAbandoned, projectTree } from "@nyte-ai/client";
import { isTerminalPhase } from "@nyte-ai/protocol";
import { DEFAULT_LANDING, MAIN, sessionId, watchPluginDirectories } from "@nyte-ai/core";
import type {
  CommandInfo,
  Oid,
  RunInfo,
  SelectionReply,
  SessionId,
  SessionInfo,
  SettingInfo,
  ThinkingLevel,
  TrustedWorkspace,
} from "@nyte-ai/core";
import type { JsonValue, Skill } from "@nyte-ai/schema";
import { loginProvider, logoutProvider } from "./auth.ts";
import { readAuthPrompt } from "./auth-prompt.ts";
import {
  cachedAuthenticatedModels,
  defaultModel,
  loadAuthenticatedModels,
  requireProvider,
} from "./catalog.ts";
import {
  DialogImagePreview,
  ComposerParts,
  createClipboardAdapter,
  createTuiClipboard,
  discoverMentionFiles,
  PASTE_COLLAPSE_LINES,
  pasteLineCount,
  resolveComposerImagePaste,
  resolveComposerPaste,
  SessionDrafts,
} from "./composer.ts";
import type { ComposerDraft, MentionFile } from "./composer.ts";
import { ComposerDocument } from "./composer-document.ts";
import { startLocalShell } from "./local-shell.ts";
import type { ShellExecution, ShellProcess } from "./local-shell.ts";
import {
  ANSWER_COMPOSER_PLACEHOLDER,
  BUSY_COMPOSER_PLACEHOLDER,
  COMPOSER_PLACEHOLDER,
  keycap,
} from "./constants.ts";
import { editInExternalEditor, resolveExternalEditor } from "./external-editor.ts";
import { ComposerActions, composerHints, openActionPalette } from "./composer-actions.ts";
import type { ComposerOperation } from "./composer-actions.ts";
import { openDiagnosticReport } from "./diagnostic-report.ts";
import { sessionRecovery } from "./flags.ts";
import type { RunFlags } from "./flags.ts";
import {
  clockDuration,
  retryCause,
  shortId,
  TERMINAL_TITLE_BASE,
  terminalTitle,
  userText,
} from "./format.ts";
import type { PowerlineState } from "./format.ts";
import type { Host } from "./host.ts";
import {
  ctrlCAction,
  DoubleEscape,
  matchesKey,
  matchesKeyName,
  nextThinkingLevel,
  registerChatLayer,
  registerSelectionKeys,
} from "./keymap.ts";
import { laneRoles, nextToSteer } from "./lanes.ts";
import type { LaneRoles } from "./lanes.ts";
import { Outbox } from "./outbox.ts";
import { SentMessages } from "./sent-messages.ts";
import { ModelPicker } from "./model-picker.ts";
import type { ModelSelection } from "./model-picker.ts";
import { gutterRows, laneMark, queuedPromptText, rowLane } from "./pending-gutter.ts";
import { PickerCancelled } from "./picker.ts";
import type { Choice, InlineMenu } from "./picker.ts";
import { PluginProvider } from "./plugins.ts";
import { browseHistory, PromptHistory } from "./prompt-history.ts";
import {
  hostFallbacks,
  openWorkspaceHost,
  resolveRuntime,
  signedOutRuntime,
  targetSession,
  tuiPlugins,
} from "./run.ts";
import type { Runtime } from "./run.ts";
import { TUI_RENDERER_CONFIG } from "./rendering.ts";
import { SessionConfigurator } from "./session-config.ts";
import type { ConfigPatch, RunChoice, SubmissionSlot } from "./session-config.ts";
import { SessionObserver, waitingCall } from "@nyte-ai/client";
import { TaskBrowser } from "./task-browser.ts";
import type { SessionState, SessionUpdate, WaitingCall } from "@nyte-ai/client";
import { FileSettingsStore } from "./settings.ts";
import type { ResolvedSettings, SettingsPatch } from "./settings.ts";
import { mountShell } from "./app/App.tsx";
import {
  clearNotice,
  closePanel,
  holdSlot,
  notice,
  openInlineMenu,
  openPanel,
  patchStatus,
  releaseSlot,
  selectChoice,
  selectSelection,
  setHints,
  setInputText,
  setSlotRows,
} from "./app/ui.ts";
import type { SelectChoiceOptions, Shell } from "./app/ui.ts";
import {
  availableSlashCommands,
  expandInlineSkills,
  hasInlineSkills,
  parseComposerSubmission,
  promptDraft,
  resolveSlashCommand,
} from "./slash.ts";
import type {
  BuiltinSlashName,
  ComposerSubmission,
  ParsedSlashCommand,
  SlashSetting,
} from "./slash.ts";
import { SlashAutocomplete } from "./slash-autocomplete.ts";
import { registerSyntaxParsers } from "./syntax-parsers.ts";
import { isThemeChoice, resolveThemeMode, themeForMode } from "./theme.ts";
import type { ThemeMode } from "./theme.ts";
import { TreeSelector } from "./tree-selector.ts";
import type { TreeFilter } from "./tree-selector.ts";
import { describeUpdateOutcome, selfUpdate } from "./update.ts";
import type { UpdateProgress } from "./update.ts";
import { updateSeverity } from "./cli-style.ts";
import { UsagePanel } from "./usage-panel.ts";
import { usageCard } from "./usage.ts";
import { checkForUpdate } from "./version.ts";
import { readWorkspaceStatus } from "./workspace.ts";
import { requestWorkspaceTrust } from "./workspace-trust.ts";

type TuiExit =
  | { readonly kind: "quit" }
  | { readonly kind: "signal"; readonly signal: "SIGINT" | "SIGTERM" };

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function scheduleAt(until: number, onDeadline: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = (): void => {
    const remaining = until - Date.now();
    if (remaining > 0) {
      timer = setTimeout(check, Math.min(remaining, MAX_TIMER_DELAY_MS));
      return;
    }
    timer = undefined;
    onDeadline();
  };
  timer = setTimeout(check, Math.min(Math.max(0, until - Date.now()), MAX_TIMER_DELAY_MS));
  return () => clearTimeout(timer);
}

const THEME_CHOICES: readonly Choice[] = [
  { id: "auto", label: "auto", description: "Follow the terminal's color scheme" },
  { id: "dark", label: "dark" },
  { id: "light", label: "light" },
];

/** pi's "Summarize branch?" answers, in its order. */
const SUMMARY_CHOICES: readonly Choice[] = [
  { id: "none", label: "No summary", description: "Leave the branch as it is" },
  { id: "summarize", label: "Summarize", description: "Keep what the branch was about" },
  {
    id: "custom",
    label: "Summarize with custom prompt",
    description: "Say what the summary should focus on",
  },
];

/**
 * One setting the shell can open or apply: `/settings` lists these, and
 * `/<id>` opens one or applies `/<id> <choice>` to it. Plugin settings join
 * the same list, so nothing about a specific plugin leaks into the shell.
 */
interface SettingRow {
  readonly id: string;
  readonly label: string;
  readonly current: () => string;
  readonly choices: () => readonly Choice[];
  readonly load?: () => Promise<readonly Choice[]>;
  readonly open?: () => Promise<void>;
  readonly apply: (choiceId: string) => Promise<void>;
}

/** The label of a row's current choice, for the settings list. */
function settingValue(row: SettingRow): string {
  const current = row.current();
  return row.choices().find((choice) => choice.id === current)?.label ?? current;
}

/** The choice `/<setting> <argument>` names: by id, by label, or a bare model id under any provider. */
function matchChoice(choices: readonly Choice[], argument: string): Choice | undefined {
  return choices.find(
    (choice) =>
      choice.id === argument || choice.label === argument || choice.id.endsWith(`/${argument}`),
  );
}

/** Resolve core's projected model in the catalog for client controls. */
function selectedConfig(state: SessionState, runtime: Runtime, fallback: RunChoice): RunChoice {
  // Selected inputs may omit defaults that core recorded on a previous run.
  const model = state.info.config.model ?? state.config.model;
  return {
    model:
      model?.provider === undefined
        ? fallback.model
        : (runtime.models.getModel(model.provider, model.id) ?? fallback.model),
    thinkingLevel:
      state.info.config.thinkingLevel ?? state.config.thinkingLevel ?? fallback.thinkingLevel,
  };
}

function userPrompts(state: SessionState): string[] {
  return state.transcript.items.flatMap((item) =>
    item.kind === "turn"
      ? item.parts.flatMap((part) => {
          if (part.kind !== "user") return [];
          const text = userText(part.content);
          return text.trim() === "" ? [] : [promptDraft(text)];
        })
      : [],
  );
}

/** The last user message of the branch, when nothing answered it. */
/**
 * The turn an aborted run hands back to the composer: a lone user request.
 * A completion's continuation turn has no user part, so a stop after a
 * background result landed retracts nothing and keeps the result in context.
 */
function unansweredRequest(
  state: SessionState,
): Extract<SessionState["transcript"]["items"][number], { kind: "turn" }> | undefined {
  const last = state.transcript.items.at(-1);
  if (last?.kind !== "turn") return undefined;
  const parts = last.parts;
  return parts.length === 1 && parts[0]?.kind === "user" ? last : undefined;
}

function modelChoiceId(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

function modelChoices(runtime: Runtime, available: readonly Model<Api>[]): Choice[] {
  return available.map((model) => ({
    id: modelChoiceId(model),
    label: model.name === "" ? model.id : model.name,
    description:
      model.name === model.id
        ? requireProvider(runtime.models, model.provider).name
        : `${requireProvider(runtime.models, model.provider).name} · ${model.id}`,
  }));
}

function createTuiRenderer(): Promise<CliRenderer> {
  // Grammars are registered before the first renderer so the tree-sitter
  // worker knows them the moment it starts.
  registerSyntaxParsers();
  return createCliRenderer({
    ...TUI_RENDERER_CONFIG,
    exitOnCtrlC: false,
    autoFocus: false,
    enableMouseMovement: true,
    clearOnShutdown: true,
  });
}

/**
 * A message on its way back into the composer: one a move retracted, or one
 * whose configuration never reached core. It lands only into an empty
 * composer, so a draft typed meanwhile is never overwritten, and it survives
 * a session switch until then.
 */
type Handback = (
  | { readonly content: SessionState["pending"][number]["content"]; readonly draft?: never }
  | { readonly draft: ComposerDraft; readonly content?: never }
) & {
  /** The retracted commit, when a move produced this; absent for an unsent message. */
  readonly commit?: Oid;
  readonly notice: string;
};

/**
 * Everything the shell knows about the followed session, rebuilt on a switch.
 * The observer publishes state; the outbox publishes what is still sending;
 * `sent` bridges the two by identity.
 */
interface FollowedSession {
  readonly sessionId: SessionId;
  readonly observer: SessionObserver;
  readonly outbox: Outbox;
  readonly sent: SentMessages;
  /** What the user asked the next run to use, ahead of core's acknowledgement. */
  readonly config: SessionConfigurator;
  state: SessionState;
  commands: ReadonlyMap<string, CommandInfo>;
  skills: ReadonlyMap<string, Skill>;
  settings: readonly SettingInfo[];
  completionCommands: ReturnType<typeof availableSlashCommands>;
  /** The plugin status items, as last listed or as `status_changed` said. */
  statusItems: readonly string[];
  stop(): void;
}

export async function runTui(
  flags: RunFlags,
  suppliedRenderer?: CliRenderer,
  output: Pick<typeof process.stdout, "write"> | undefined = suppliedRenderer === undefined
    ? process.stdout
    : undefined,
): Promise<TuiExit> {
  const renderer = suppliedRenderer ?? (await createTuiRenderer());
  const roles = laneRoles(DEFAULT_LANDING);
  const shell = await mountShell({
    renderer,
    initialTheme: themeForMode(resolveThemeMode("auto", renderer.themeMode)),
    roles,
    openPath: (path) => {
      void open(path).catch(() => undefined);
    },
  });
  patchStatus(shell, { workspace: basename(process.cwd()) });
  shell.setUi("loading", "Checking workspace…");
  shell.input.onSubmit = () => notice(shell, "Still starting. Your draft is saved here.");
  const shutdown: { exit: TuiExit } = { exit: { kind: "quit" } };
  let resumeId: SessionId | undefined;
  const startupAbort = new AbortController();
  const destroyed = new Promise<void>((resolveDestroyed) => {
    renderer.once("destroy", () => {
      startupAbort.abort();
      resolveDestroyed();
    });
  });
  const failures: string[] = [];
  const cleanup = async (resource: string, dispose: () => unknown): Promise<void> => {
    try {
      await dispose();
    } catch (cause) {
      failures.push(`${resource} cleanup failed: ${errorMessage(cause)}`);
    }
  };
  const requestShutdown = (requested: TuiExit = { kind: "quit" }): void => {
    if (requested.kind === "signal") shutdown.exit = requested;
    // Disposal clears the followed session before the terminal has shut down.
    resumeId ??= app?.sessionId;
    try {
      void app
        ?.dispose()
        .catch((cause) => failures.push(`TUI cleanup failed: ${errorMessage(cause)}`));
    } catch (cause) {
      failures.push(`TUI cleanup failed: ${errorMessage(cause)}`);
    } finally {
      renderer.destroy();
    }
  };
  const onSigint = (): void => requestShutdown({ kind: "signal", signal: "SIGINT" });
  const onSigterm = (): void => requestShutdown({ kind: "signal", signal: "SIGTERM" });
  const onStartupKey = (key: KeyEvent): void => {
    if (
      ctrlCAction(key, { selecting: shell.ui.selecting, prompting: false, hasDraft: false }) ===
      undefined
    )
      return;
    key.preventDefault();
    key.stopPropagation();
    requestShutdown({ kind: "signal", signal: "SIGINT" });
  };
  const takeNoticeBack = (): void => {
    if (!shell.root.isDestroyed) clearNotice(shell);
  };
  const onStartupTheme = (): void => {
    shell.setTheme(themeForMode(resolveThemeMode("auto", renderer.themeMode)));
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  renderer.keyInput.on("keypress", onStartupKey);
  renderer.keyInput.on("keypress", takeNoticeBack);
  renderer.on(CliRenderEvents.THEME_MODE, onStartupTheme);
  let host: Host | undefined;
  const otel = createOtelExport({ serviceName: "nyte-tui" });
  let app: Interactive | undefined;
  const disposers: (() => void)[] = [];
  const boot = async (): Promise<void> => {
    const trustStore = createTrustStore();
    const resolution = await trustStore.resolve(process.cwd());
    if (startupAbort.signal.aborted) return;
    let workspace: TrustedWorkspace;
    if (resolution.kind === "trusted") {
      workspace = resolution.workspace;
    } else {
      shell.input.blur();
      shell.input.focusable = false;
      const decision = await requestWorkspaceTrust({
        renderer,
        theme: shell.theme,
        cwd: resolution.cwd,
        signal: startupAbort.signal,
        nextId: shell.nextId,
      });
      if (startupAbort.signal.aborted) return;
      if (decision !== "trust") {
        requestShutdown();
        return;
      }
      workspace = await trustStore.trust(resolution.cwd);
      if (startupAbort.signal.aborted) return;
      shell.input.focusable = true;
      shell.focus.reset();
    }
    shell.setUi("loading", "Loading settings…");
    const settingsStore = new FileSettingsStore();
    const settings = await settingsStore.read(workspace.cwd);
    if (startupAbort.signal.aborted) return;
    shell.setScrollAcceleration(settings.scrollAcceleration);
    renderer.off(CliRenderEvents.THEME_MODE, onStartupTheme);
    const updateTheme = (): void => {
      shell.setTheme(themeForMode(resolveThemeMode(settings.theme, renderer.themeMode)));
    };
    updateTheme();
    renderer.on(CliRenderEvents.THEME_MODE, updateTheme);
    disposers.push(() => renderer.off(CliRenderEvents.THEME_MODE, updateTheme));
    shell.setUi("loading", "Loading providers…");
    const bootNotices: string[] = [];
    const signedIn = await resolveRuntime(flags, settings);
    if (startupAbort.signal.aborted) return;
    const runtime = signedIn ?? (await signedOutRuntime(flags, settings));
    if (startupAbort.signal.aborted) return;
    if (signedIn === undefined) bootNotices.push("Not signed in. /login connects a provider.");
    if (
      signedIn === undefined &&
      flags.provider !== undefined &&
      runtime.provider.id !== flags.provider
    )
      bootNotices.push(
        `${flags.provider} has no models until you sign in; opened on ${runtime.provider.id} instead. /login ${flags.provider} connects it.`,
      );
    const fallback = hostFallbacks(runtime, settings, flags);
    patchStatus(shell, {
      provider: fallback.model.provider,
      model: fallback.model.id,
      effort: fallback.thinkingLevel,
    });
    shell.setUi("loading", "Loading workspace plugins…");
    const opened = await openWorkspaceHost({
      workspace,
      settings,
      runtime,
      model: fallback.model,
      thinkingLevel: fallback.thinkingLevel,
      telemetry: otel.telemetry,
      report: (message) => bootNotices.push(message),
    });
    // Keep ownership even if startup was cancelled while plugins were loading.
    host = opened;
    if (startupAbort.signal.aborted) return;
    renderer.off(CliRenderEvents.THEME_MODE, updateTheme);
    app = new Interactive({
      renderer,
      shell,
      host,
      runtime,
      roles,
      settings,
      settingsStore,
      workspace,
      fallback,
      themeMode: resolveThemeMode(settings.theme, renderer.themeMode),
      onSettings: () => {},
      requestShutdown,
    });
    renderer.keyInput.off("keypress", onStartupKey);
    await app.start(flags);
    if (startupAbort.signal.aborted) return;
    for (const message of bootNotices) notice(shell, message, shell.theme.warning);
  };
  const booting = boot().catch((cause: unknown) => {
    failures.unshift(`error: ${errorMessage(cause)}`);
    requestShutdown();
  });
  try {
    await Promise.race([booting, destroyed]);
    await destroyed;
  } finally {
    startupAbort.abort();
    // Startup can still acquire a host after terminal destruction. Settle it
    // before closing resources so nothing reports after the recovery command.
    await booting;
    resumeId ??= app?.sessionId;
    await cleanup("TUI", () => app?.dispose());
    for (const dispose of disposers.splice(0).toReversed()) {
      await cleanup("Host attachment", dispose);
    }
    renderer.off(CliRenderEvents.THEME_MODE, onStartupTheme);
    renderer.keyInput.off("keypress", onStartupKey);
    renderer.keyInput.off("keypress", takeNoticeBack);
    await cleanup("Terminal", () => renderer.destroy());
    await cleanup("Host", async () => {
      const outcome = await host?.close();
      if (outcome?.kind === "failed") {
        for (const failure of outcome.failures) {
          failures.push(`${failure.resource} cleanup failed: ${errorMessage(failure.cause)}`);
        }
      }
    });
    await cleanup("Telemetry", () => otel.shutdown());
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
  // Restoration ends in escape bytes, not a newline. Keep the final two lines
  // plain even in raw PTY captures, and report every failure before them.
  if (failures.length > 0 || resumeId !== undefined) output?.write("\n");
  for (const failure of failures) output?.write(`${failure}\n`);
  if (resumeId !== undefined) {
    output?.write(`To resume previous session\n${sessionRecovery(resumeId).command}\n`);
  }
  if (failures.length > 0 && shutdown.exit.kind !== "signal") process.exit(1);
  return shutdown.exit;
}

interface InteractiveOptions {
  readonly renderer: CliRenderer;
  readonly shell: Shell;
  readonly host: Host;
  readonly runtime: Runtime;
  readonly roles: LaneRoles;
  readonly settings: ResolvedSettings;
  readonly settingsStore: FileSettingsStore;
  readonly workspace: TrustedWorkspace;
  readonly fallback: RunChoice;
  readonly themeMode: ThemeMode;
  readonly onSettings: (settings: ResolvedSettings) => void;
  readonly requestShutdown: () => void;
  readonly clipboard?: ClipboardService;
}

class Interactive {
  private readonly usageCaches = createUsageScanCaches();
  private readonly tasks: TaskBrowser;
  private tuiPlugins: PluginProvider;
  private readonly renderer: CliRenderer;
  private readonly shell: Shell;
  private readonly host: Host;
  private readonly runtime: Runtime;
  private readonly roles: LaneRoles;
  private readonly settingsStore: FileSettingsStore;
  private workspace: TrustedWorkspace;
  private stopPluginWatch: (() => void) | undefined;
  private changingDirectory = false;
  private readonly fallback: RunChoice;
  private readonly options: InteractiveOptions;
  private settings: ResolvedSettings;
  private themeMode: ThemeMode;
  private session: FollowedSession | undefined;
  private readonly composerParts = new ComposerParts();
  private readonly attachmentPreview: DialogImagePreview;
  private readonly clipboard: ReturnType<typeof createTuiClipboard>;
  private pasting: Promise<void> | undefined;
  private queueMenu: InlineMenu | undefined;
  private queueSelection: string | undefined;
  private readonly queueEdits = new Map<
    SessionId,
    { readonly lane: string; readonly draft: ComposerDraft } & (
      | { readonly kind: "pending"; readonly change: Oid }
      | { readonly kind: "sending"; readonly content: SessionState["pending"][number]["content"] }
    )
  >();
  private readonly drafts = new SessionDrafts();
  /** Recovery belongs to the session, independently of which one the shell follows. */
  private readonly handbacks = new Map<SessionId, Handback[]>();
  private readonly promptHistory = new PromptHistory();
  private readonly doubleEscape = new DoubleEscape();
  private readonly document: ComposerDocument;
  private hintsScheduled = false;
  private autocomplete: SlashAutocomplete | undefined;
  private composerActions: ComposerActions | undefined;
  private mentionFiles: readonly MentionFile[] = [];
  private mentionController: AbortController | undefined;
  private readonly disposers: (() => void)[] = [];
  /** Sessions this process drives; a run started here keeps going after switching away. */
  private readonly attachments = new Map<SessionId, () => void>();
  private submitting = false;
  private pasteSubmission: SubmissionSlot | undefined;
  private pasteFailures = 0;
  /** The open question menu, so a wait that ends elsewhere can close it. */
  private asking: AbortController | undefined;
  private waiting: WaitingCall | undefined;
  private compaction: AbortController | undefined;
  private authenticating: AbortController | undefined;
  private authenticationLink: { readonly url: string; readonly copy: string } | undefined;
  /** Local commands belong to this TUI, never to a core run or task. */
  private readonly shellCommands = new Map<
    string,
    {
      readonly sessionId: SessionId;
      readonly head: string;
      readonly process: ShellProcess;
      retention: "pending" | "attached" | "exclude" | "discarded";
    }
  >();
  private activeShell: ShellProcess | undefined;
  private editingExternally = false;
  private switchingSession = false;
  private lastPluginSignature: string | undefined;
  private readonly stopped = new AbortController();
  private disposed = false;
  private closing: Promise<void> | undefined;
  private pendingVisual:
    | {
        readonly session: FollowedSession;
        readonly previous: SessionState | undefined;
        readonly reset: boolean;
      }
    | undefined;

  constructor(options: InteractiveOptions) {
    this.options = options;
    this.renderer = options.renderer;
    this.shell = options.shell;
    this.host = options.host;
    this.runtime = options.runtime;
    this.roles = options.roles;
    this.settingsStore = options.settingsStore;
    this.workspace = options.workspace;
    this.fallback = options.fallback;
    this.settings = options.settings;
    this.themeMode = options.themeMode;
    this.document = new ComposerDocument(options.shell.input);
    this.renderer.setFrameCallback(this.flushVisual);
    this.disposers.push(() => this.renderer.removeFrameCallback(this.flushVisual));
    this.clipboard =
      options.clipboard === undefined
        ? createTuiClipboard(options.renderer)
        : createClipboardAdapter(options.clipboard);
    this.attachmentPreview = new DialogImagePreview(options.renderer, options.shell.theme);
    options.shell.previewSlot.add(this.attachmentPreview.container);
    this.disposers.push(() => {
      this.attachmentPreview.close();
      void this.clipboard.dispose().catch(this.reportError);
    });
    this.tasks = new TaskBrowser({
      shell: options.shell,
      nyte: options.host.nyte,
      onClose: () => this.refreshHints(),
      onChange: () => {
        this.refreshQuestion();
        // A child's step lands in its delegation card in the parent transcript.
        if (this.session === undefined) return;
        this.pendingVisual ??= {
          session: this.session,
          previous: this.session.state,
          reset: false,
        };
        this.renderer.requestRender();
      },
      onError: (cause) => this.reportError(cause),
    });
    this.tuiPlugins = new PluginProvider({
      shell: options.shell,
      workspace: options.workspace,
      client: options.host.nyte,
      sessionID: () => this.sessionId,
    });
    options.shell.pendingGutter.onOpen = (row) => {
      void this.openQueue(rowId(row)).catch(this.reportError);
    };
    options.shell.pendingGutter.onReorder = (item, before) => {
      const session = this.session;
      if (
        session === undefined ||
        options.shell.ui.selecting ||
        this.queueEdits.has(session.sessionId)
      )
        return;
      void this.reorder(session, item.change, item.lane, before?.change ?? null).catch(
        this.reportError,
      );
    };
    options.shell.pendingTail.onOpen = options.shell.pendingGutter.onOpen;
    options.shell.pendingTail.onReorder = options.shell.pendingGutter.onReorder;
  }

  get sessionId(): SessionId | undefined {
    return this.session?.sessionId;
  }

  async start(flags: RunFlags): Promise<void> {
    this.shell.setUi("loading", "Loading session…");
    patchStatus(this.shell, this.initialStatus());
    this.refreshWorkspace();
    this.wireComposer();
    this.wireKeymap();
    // The terminal switched scheme; follow it unless a mode is pinned.
    const onTerminalTheme = (mode: ThemeMode): void => {
      if (this.settings.theme === "auto" && mode !== this.themeMode) {
        void this.changeTheme(mode).catch(this.reportError);
      }
    };
    this.renderer.on(CliRenderEvents.THEME_MODE, onTerminalTheme);
    this.disposers.push(() => this.renderer.off(CliRenderEvents.THEME_MODE, onTerminalTheme));
    const info = await targetSession(this.host.nyte, flags.resume);
    if (this.disposed) return;
    await this.follow(info);
    if (this.disposed) return;
    this.watchWorkspacePlugins();
    void loadAuthenticatedModels(this.runtime.models).catch(() => undefined);
    void this.refreshMentionFiles();
    void this.checkUpdate();
    this.renderer.requestRender();
  }

  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.disposed = true;
    this.mentionController?.abort();
    this.cancelPasteSubmission();
    this.pendingVisual = undefined;
    this.stopped.abort();
    this.shell.dismissInfoPanel?.();
    this.tasks.dispose();
    void this.tuiPlugins.dispose().catch(this.reportError);
    this.closeQueue();
    this.asking?.abort();
    this.compaction?.abort();
    this.stopPluginWatch?.();
    this.session?.stop();
    this.session = undefined;
    for (const detach of this.attachments.values()) detach();
    this.attachments.clear();
    for (const dispose of this.disposers.splice(0).toReversed()) {
      try {
        dispose();
      } catch {}
    }
    this.autocomplete?.destroy();
    this.renderer.setTerminalTitle(TERMINAL_TITLE_BASE);
    this.closing = Promise.all(
      [...this.shellCommands.values()].map((entry) => entry.process.done),
    ).then(() => {
      this.shellCommands.clear();
    });
    return this.closing;
  }

  // -------------------------------------------------------------------------
  // The followed session
  // -------------------------------------------------------------------------

  private requireSession(): FollowedSession {
    if (this.session === undefined) throw new Error("No session is open");
    return this.session;
  }

  private get state(): SessionState | undefined {
    return this.session?.state;
  }

  private get busy(): boolean {
    return (
      this.compaction !== undefined ||
      this.state?.compaction !== undefined ||
      (this.state?.run !== undefined && !isTerminalPhase(this.state.run.phase))
    );
  }

  /** The configuration the user selected, reconciled with core's selected inputs. */
  private get config(): RunChoice {
    return this.session?.config.selected ?? this.fallback;
  }

  /** Point the shell at a session: stop following the old one, snapshot the new one. */
  private async follow(info: SessionInfo): Promise<void> {
    const cwd = await this.host.sessionCwd(info.sessionId);
    const workspace =
      cwd === this.workspace.cwd
        ? this.workspace
        : cwd === this.options.workspace.cwd
          ? this.options.workspace
          : await this.trustDirectory(cwd);
    if (this.disposed) return;
    if (info.activation.kind !== "active" && cwd !== this.host.cwd) {
      await this.relocateSession(info.sessionId, workspace);
    }
    await this.useWorkspace(workspace);
    if (this.disposed) return;
    this.shell.dismissInfoPanel?.();
    this.tasks.close();
    this.closeQueue();
    this.asking?.abort();
    this.asking = undefined;
    this.waiting = undefined;
    this.compaction?.abort();
    this.compaction = undefined;
    const switching = this.session !== undefined;
    this.cancelPasteSubmission();
    this.pasting = undefined;
    this.saveDraft();
    this.session?.stop();
    this.session = undefined;
    this.pendingVisual = undefined;
    this.shell.view.clear();
    this.shell.setUi("loading", "Loading session…");
    if (switching) this.restoreDraft(info.sessionId);
    if (!this.attachments.has(info.sessionId)) {
      this.attachments.set(info.sessionId, this.host.attach(info.sessionId));
    }
    let current: FollowedSession | undefined;
    const outbox = new Outbox({
      send: (input) => this.host.nyte.messages.send({ sessionId: info.sessionId, ...input }),
      onReceipt: (entry, receipt) => current?.sent.receipt(entry, receipt),
      onChange: (entries) => {
        if (current === undefined) return;
        current.sent.sending(entries);
        if (this.session === current) this.syncGutter(current);
      },
    });
    const observer = new SessionObserver(this.host.nyte, {
      sessionId: info.sessionId,
      head: MAIN,
      selectionVersion: () => current?.config.version ?? 0,
      onError: (error) => {
        if (this.session === current)
          notice(this.shell, `Session watch failed: ${error.message}`, this.shell.theme.error);
      },
      retryMs: 500,
    });
    observer.subscribe((update) => {
      const { state, selectedVersion } = update;
      if (current === undefined || this.session !== current) return;
      const previous = current.state;
      current.state = state;
      if (selectedVersion !== undefined) current.config.observeSelected(selectedVersion);
      if (update.kind === "metadata") this.refreshStatus(current);
      else this.render(current, previous, update);
    });
    const config = new SessionConfigurator({
      configure: (patch) =>
        this.host.nyte.sessions.configure({
          sessionId: info.sessionId,
          ...(patch.model === undefined
            ? {}
            : { model: { provider: patch.model.provider, id: patch.model.id } }),
          ...(patch.thinkingLevel === undefined ? {} : { thinkingLevel: patch.thinkingLevel }),
        }),
      readSelected: () =>
        current === undefined
          ? this.fallback
          : selectedConfig(current.state, this.runtime, this.fallback),
      onChange: (selected) => {
        if (current === undefined || this.session !== current) return;
        patchStatus(this.shell, {
          provider: selected.model.provider,
          model: selected.model.id,
          effort: selected.thinkingLevel,
        });
      },
      onAcknowledged: (choice, patch) => {
        if (current === undefined || this.session !== current) return;
        this.persistChoice(choice, patch);
        observer.refresh();
      },
    });
    const followed: FollowedSession = {
      sessionId: info.sessionId,
      observer,
      outbox,
      sent: new SentMessages({
        // The same observer `render` hears: its snapshot reaches `sent.snapshot` before the promise settles.
        resync: () => observer.resync(),
        onChange: () => {
          if (current !== undefined && this.session === current) this.syncGutter(current);
        },
      }),
      config,
      state: {
        sessionId: info.sessionId,
        head: MAIN,
        seq: 0,
        info,
        config: info.config,
        transcript: { items: [], tip: null },
        pending: [],
        run: undefined,
        compaction: undefined,
        overlay: [],
        parked: [],
        context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 0 },
        expectedTip: undefined,
      },
      commands: new Map(),
      skills: new Map(),
      settings: [],
      completionCommands: [],
      statusItems: [],
      stop: () => {
        observer.close();
        config.dispose();
      },
    };
    current = followed;
    this.session = followed;
    this.refreshHints();
    try {
      await observer.start();
    } catch (cause) {
      // The observer retries a failed read itself; its start rejects only once
      // `stop` closed it, which a switch or shutdown does before the read lands.
      if (this.session === followed) throw cause;
      return;
    }
    if (this.session !== followed) return;
    this.promptHistory.replace(userPrompts(followed.state));
    this.tuiPlugins.refresh();
    this.renderer.setTerminalTitle(terminalTitle(followed.state.info.name));
    await this.refreshContributions(followed);
    await this.tuiPlugins.reconcile();
    if (!this.disposed && this.session === followed) this.shell.setUi("loading", undefined);
  }

  private async refreshContributions(session: FollowedSession): Promise<void> {
    const [commands, skills, settings, statusItems] = await Promise.all([
      this.host.nyte.plugins.commands.list({ sessionId: session.sessionId }),
      this.host.nyte.plugins.resources.list({ sessionId: session.sessionId }),
      this.host.nyte.plugins.settings.list({ sessionId: session.sessionId }),
      this.host.nyte.plugins.status.list({ sessionId: session.sessionId }),
    ]);
    if (this.disposed || this.session !== session) return;
    session.commands = new Map(commands.map((command) => [command.name, command]));
    session.skills = new Map(skills.map((skill) => [skill.name, skill]));
    session.statusItems = statusItems;
    this.applySettingsList(session, settings);
    this.refreshAutocomplete();
  }

  /** The plugin settings as last listed; badges from their current choices lead the status items. */
  private applySettingsList(session: FollowedSession, listed: readonly SettingInfo[]): void {
    session.settings = listed;
    const commands = availableSlashCommands(
      session.commands,
      this.slashSettings(session),
      session.skills,
    );
    // Badge-only refreshes must not reset the completion the user selected.
    if (!isDeepStrictEqual(commands, session.completionCommands))
      session.completionCommands = commands;
    const badges = listed.flatMap((setting) => {
      const status = setting.choices.find((choice) => choice.id === setting.current)?.status;
      return status === undefined ? [] : [status];
    });
    patchStatus(this.shell, { statuses: [...badges, ...session.statusItems] });
  }

  /** Draw one published state, and react to the event that produced it. Only a snapshot replaces the transcript. */
  private render(
    session: FollowedSession,
    previous: SessionState | undefined,
    update: Exclude<SessionUpdate, { kind: "metadata" }>,
  ): void {
    const { state } = session;
    const event = update.kind === "event" ? update.event : undefined;
    const snapshot = update.kind === "snapshot";
    if (snapshot) session.sent.snapshot(state.pending, state.transcript.items);
    // Fold and react to every event, but reconcile only the latest visual state
    // before a frame. A resnapshot must still reset even if deltas follow it.
    this.pendingVisual = {
      session,
      previous: snapshot
        ? undefined
        : this.pendingVisual === undefined
          ? previous
          : this.pendingVisual.previous,
      reset: snapshot || this.pendingVisual?.reset === true,
    };
    this.renderer.requestRender();
    this.tasks.update(state, event);
    if (event === undefined) return;
    this.tuiPlugins.emit(event);
    if (session.sent.event(event, state.head)) this.syncGutter(session);
    switch (event.kind) {
      case "activation_changed":
        return;
      case "job":
        return;
      case "run":
        if (event.head !== state.head) return;
        if (
          isTerminalPhase(event.run.phase) &&
          previous?.run !== undefined &&
          !isTerminalPhase(previous.run.phase)
        ) {
          this.onRunEnded(session, event.run);
        }
        if (event.run.phase.kind === "retry") {
          notice(
            this.shell,
            `${retryCause(event.run.phase.error)} Retrying in ${clockDuration(Math.max(0, event.run.phase.at - Date.now()))} (attempt ${String(event.run.attempts)})`,
            this.shell.theme.warning,
          );
        }
        return;
      case "compaction":
        return;
      case "effect":
        return;
      case "commit":
        if (event.head !== state.head) return;
        if (event.item.commit.body.kind === "message") {
          if (event.item.commit.body.message.role === "user") {
            this.promptHistory.replace(userPrompts(state));
          }
        }
        return;
      case "plugins_changed": {
        void this.refreshContributions(session).catch(() => undefined);
        const failed = event.plugins.filter((plugin) => plugin.status === "failed");
        const signature = event.plugins
          .map((plugin) =>
            plugin.status === "failed" ? `${plugin.id}!${plugin.error}` : plugin.id,
          )
          .join(" ");
        if (signature === this.lastPluginSignature) return;
        this.lastPluginSignature = signature;
        if (failed.length > 0) {
          notice(
            this.shell,
            failed.map((plugin) => `plugin ${plugin.id} failed: ${plugin.error}`),
            this.shell.theme.error,
          );
        }
        return;
      }
      case "diagnostic":
        notice(
          this.shell,
          `${event.owner}: ${event.message}`,
          event.level === "error" ? this.shell.theme.error : undefined,
        );
        return;
      case "deleted":
        notice(this.shell, "This chat was deleted. /new starts another.", this.shell.theme.warning);
        return;
      case "notification":
        // The plugin said what; the terminal's own notification channel says it.
        this.renderer.triggerNotification(event.message, event.title ?? "Nyte");
        if (event.sound && process.stdout.isTTY) process.stdout.write("\u0007");
        return;
      case "status_changed":
        session.statusItems = event.items;
        this.applySettingsList(session, session.settings);
        return;
      case "landed":
      case "queue_cancelled":
      case "queued":
      case "config_queued":
      case "head_moved":
      case "stack":
      case "fact":
      case "synced":
      case "text_delta":
      case "reasoning_delta":
      case "tool_progress":
        return;
      default: {
        const _exhaustive: never = event;
        return _exhaustive;
      }
    }
  }

  private readonly flushVisual = async (): Promise<void> => {
    const pending = this.pendingVisual;
    this.pendingVisual = undefined;
    if (this.disposed || pending === undefined || this.session !== pending.session) return;
    const { state } = pending.session;
    this.shell.view.sync(state, { reset: pending.reset });
    if (pending.reset) this.restoreShellCards(pending.session);
    const handbacks = this.handbacks.get(pending.session.sessionId);
    const handback = handbacks?.[0];
    if (
      handbacks !== undefined &&
      handback !== undefined &&
      state.expectedTip === undefined &&
      !state.transcript.items.some(
        (item) =>
          item.kind === "turn" &&
          item.parts.some((part) => part.kind === "user" && part.commit === handback.commit),
      )
    ) {
      // The watcher, not the move reply, determines which transcript is painted.
      // Never overwrite a draft typed while that durable move was completing:
      // the handback waits until the composer is empty again.
      if (
        this.shell.input.plainText.trim() === "" &&
        !this.shell.ui.prompting &&
        !this.queueEdits.has(pending.session.sessionId)
      ) {
        handbacks.shift();
        if (handbacks.length === 0) this.handbacks.delete(pending.session.sessionId);
        if (handback.draft !== undefined) {
          this.composerParts.restore(handback.draft.parts);
          setInputText(this.shell.input, handback.draft.text);
          notice(this.shell, handback.notice, this.shell.theme.warning);
        } else this.handBack(handback.content, handback.notice);
      }
    }
    if (state.pending !== pending.previous?.pending) this.syncGutter(pending.session);
    if (
      state.info.config !== pending.previous?.info.config ||
      state.config !== pending.previous?.config ||
      state.context !== pending.previous?.context
    )
      this.refreshStatus(pending.session);
    if (!this.shell.ui.prompting) {
      this.shell.input.placeholder =
        waitingCall(state)?.selection.other !== undefined
          ? ANSWER_COMPOSER_PLACEHOLDER
          : this.busy
            ? BUSY_COMPOSER_PLACEHOLDER
            : COMPOSER_PLACEHOLDER;
    }
    if (!this.shell.ui.selecting && !this.shell.ui.prompting) this.refreshHints();
    if (state.info.name !== pending.previous?.info.name)
      this.renderer.setTerminalTitle(terminalTitle(state.info.name));
  };

  private onRunEnded(session: FollowedSession, run: RunInfo): void {
    if (run.phase.kind === "failed")
      notice(this.shell, `Error: ${run.phase.error}`, this.shell.theme.error);
    this.refreshWorkspace();
    // A run stopped before it answered hands its message back to the composer,
    // the same round trip double-escape makes, minus the picker.
    if (
      run.phase.kind === "aborted" &&
      this.shell.input.plainText.trim() === "" &&
      !this.queueEdits.has(session.sessionId)
    ) {
      const request = unansweredRequest(session.state);
      const sent = request?.parts[0];
      if (sent?.kind === "user") void this.retract(session, sent.commit).catch(this.reportError);
    }
  }

  private async retract(session: FollowedSession, commit: Oid): Promise<void> {
    const outcome = await this.host.nyte.heads.move({
      sessionId: session.sessionId,
      to: commit,
      expect: session.state.transcript.tip,
    });
    if (outcome.kind !== "moved" || outcome.restored === undefined) return;
    this.stageHandback(session.sessionId, {
      content: outcome.restored.content,
      commit: outcome.restored.commit,
      notice: "Stopped. Message is back in the composer.",
    });
  }

  /** Queue a handback for the session it belongs to; a session not followed now keeps it until it is. */
  private stageHandback(id: SessionId, handback: Handback): void {
    if (this.disposed) return;
    const handbacks = this.handbacks.get(id) ?? [];
    handbacks.push(handback);
    this.handbacks.set(id, handbacks);
    const session = this.session;
    if (session?.sessionId !== id) return;
    // The watcher may have delivered the move before its request resolved.
    this.pendingVisual ??= { session, previous: session.state, reset: false };
    this.renderer.requestRender();
  }

  private handBack(content: SessionState["pending"][number]["content"], told: string): void {
    setInputText(this.shell.input, this.composerParts.load(content));
    this.promptHistory.resetBrowse();
    if (!this.shell.ui.selecting && !this.shell.ui.prompting) this.focusComposer();
    notice(this.shell, told, this.shell.theme.ok);
  }

  private refreshQuestion(): void {
    const session = this.session;
    if (this.disposed || session === undefined) return;
    const waiting = waitingCall(session.state) ?? this.tasks.waiting;
    if (waiting?.sessionId === this.waiting?.sessionId && waiting?.waitId === this.waiting?.waitId)
      return;
    this.waiting = waiting;
    this.asking?.abort();
    // The cancelled picker's finally opens the next call after it releases focus.
    if (waiting !== undefined) this.askQuestion(session, waiting);
  }

  /**
   * Parked selections accept one row, several rows, or typed text according to
   * their protocol data. Escape leaves the call parked; its durable deadline
   * closes the panel without sending a reply.
   */
  private askQuestion(session: FollowedSession, waiting: WaitingCall): void {
    if (this.asking !== undefined || this.authenticating !== undefined) return;
    this.shell.dismissInfoPanel?.();
    if (this.shell.ui.selecting || this.shell.ui.prompting) return;
    const asking = new AbortController();
    const cancelDeadline =
      waiting.until === undefined ? undefined : scheduleAt(waiting.until, () => asking.abort());
    this.asking = asking;
    void (async () => {
      try {
        const { selection } = waiting;
        const title =
          waiting.sessionId === session.sessionId
            ? selection.title
            : `Subagent ${shortId(waiting.sessionId)}: ${selection.title}`;
        const reply = await selectSelection(
          this.shell,
          { ...selection, title },
          {
            signal: asking.signal,
            cancelLabel: "later",
          },
        );
        await this.answer(waiting, reply);
        // A reply may change a setting, as consent does; the badges read settings.
        await this.refreshBadges();
      } catch (cause) {
        if (!(cause instanceof PickerCancelled)) throw cause;
      } finally {
        cancelDeadline?.();
        if (this.asking === asking) this.asking = undefined;
        if (
          !this.disposed &&
          this.session === session &&
          !this.shell.ui.selecting &&
          !this.shell.ui.prompting
        ) {
          this.refreshHints();
          if (this.waiting !== undefined && this.waiting !== waiting)
            this.askQuestion(session, this.waiting);
        }
      }
    })().catch(this.reportError);
  }

  /** Replies to the parked call. A wait that already ended is reported, never re-sent as a message. */
  private async answer(waiting: WaitingCall, reply: SelectionReply): Promise<void> {
    const durableReply: JsonValue =
      reply.other === undefined
        ? { choices: [...reply.choices] }
        : { choices: [...reply.choices], other: reply.other };
    const outcome = await this.host.nyte.runs.reply({
      sessionId: waiting.sessionId,
      runId: waiting.runId,
      callId: waiting.callId,
      waitId: waiting.waitId,
      reply: durableReply,
    });
    if (outcome.kind !== "signalled") {
      notice(this.shell, "That question is no longer waiting", this.shell.theme.warning);
    }
  }

  private syncGutter(session: FollowedSession): void {
    const rows = sessionRows(session);
    // Enter's messages take the shape of the turns they become; ctrl+enter's wait in the compact rows.
    const steering = rows.filter((row) => rowLane(row) === this.roles.steer);
    const queued = rows.filter((row) => rowLane(row) !== this.roles.steer);
    this.shell.pendingTail.sync(steering, { hint: queued.length === 0 });
    this.shell.pendingGutter.sync(queued);
    if (this.queueMenu !== undefined || this.queueSelection !== undefined) {
      const choices = this.queueChoices();
      this.queueMenu?.setChoices(choices, this.queueSelection);
      if (choices.some((choice) => choice.id === this.queueSelection))
        this.queueSelection = undefined;
    }
    patchStatus(this.shell, { queued: rows.length });
  }

  // -------------------------------------------------------------------------
  // Status line
  // -------------------------------------------------------------------------

  private initialStatus(): Partial<PowerlineState> {
    const config = this.config;
    return {
      workspace: basename(this.workspace.cwd),
      provider: config.model.provider,
      model: config.model.id,
      effort: config.thinkingLevel,
      statuses: [],
      queued: 0,
    };
  }

  private refreshStatus(session: FollowedSession): void {
    const { state } = session;
    const config = session.config.selected;
    patchStatus(this.shell, {
      provider: config.model.provider,
      model: config.model.id,
      effort: config.thinkingLevel,
      tokens: state.context.usageTokens,
      window: state.context.contextWindow,
      pct: state.context.percent ?? 0,
    });
    void this.refreshBadges();
  }

  private refreshWorkspace(): void {
    const cwd = this.workspace.cwd;
    void readWorkspaceStatus(cwd).then((workspace) => {
      if (!this.disposed && this.workspace.cwd === cwd) patchStatus(this.shell, workspace);
    });
  }

  /** Re-list the plugin settings: a command or an apply may have changed a current choice. */
  private async refreshBadges(): Promise<void> {
    const session = this.session;
    if (session === undefined) return;
    try {
      const listed = await this.host.nyte.plugins.settings.list({ sessionId: session.sessionId });
      if (this.session !== session) return;
      this.applySettingsList(session, listed);
      this.refreshAutocomplete();
    } catch {
      return;
    }
  }

  private composerBlocked(): string | undefined {
    if (this.session === undefined) return "Wait for the session to open";
    if (this.shell.ui.prompting || this.shell.ui.selecting)
      return "Another panel owns the keyboard";
    if (this.renderer.hasSelection) return "Text selection owns the keyboard";
    if (this.authenticating !== undefined) return "Finish authentication first";
    if (this.changingDirectory || this.switchingSession) return "Wait for the workspace switch";
    if (this.submitting) return "A message is being submitted";
    return undefined;
  }

  private refreshHints(): void {
    this.document.during(() => this.paintHints());
  }

  /** One hint pass inside an open document scope, so its many getters share one read. */
  private paintHints(): void {
    if (this.disposed || this.shell.root.isDestroyed) return;
    if (this.authenticating !== undefined) {
      setHints(
        this.shell,
        this.authenticationLink === undefined
          ? "esc cancel authentication"
          : `${keycap("auth.open")} open browser · ${keycap("auth.copy")} copy · esc cancel authentication`,
      );
      return;
    }
    if (this.shell.ui.selecting || this.shell.ui.prompting) return;
    this.flushShellMarkers();
    setHints(this.shell, composerHints(this.shell));
  }

  /** Event-driven refreshes from one turn collapse into a single pass. */
  private scheduleHints(): void {
    if (this.hintsScheduled) return;
    this.hintsScheduled = true;
    queueMicrotask(() => {
      this.hintsScheduled = false;
      this.refreshHints();
    });
  }

  // -------------------------------------------------------------------------
  // Composer
  // -------------------------------------------------------------------------

  private wireComposer(): void {
    const syntax = SyntaxStyle.create();
    this.shell.input.syntaxStyle = syntax;
    const styleId = syntax.registerStyle("attachment", {
      fg: this.shell.theme.pasteForeground,
      bg: this.shell.theme.pasteBackground,
    });
    // A key's resolution shares one draft read; the focused editor edits only after dispatch.
    this.disposers.push(
      this.shell.keymap.intercept("key", () => this.document.open()),
      this.shell.keymap.intercept("key:after", () => this.document.close()),
    );
    const autocomplete = new SlashAutocomplete({
      renderer: this.renderer,
      keymap: this.shell.keymap,
      enabled: () => this.composerBlocked() === undefined,
      input: this.shell.input,
      readText: () => this.document.read().text,
      widthMethod: this.shell.inputWidthMethod,
      theme: this.shell.theme,
      nextId: this.shell.nextId,
      onCommand: (command) => {
        void this.runCommand(
          { name: command.name, argument: "" },
          { lane: this.composerActions?.primaryLane ?? this.roles.steer },
        ).catch(this.reportError);
      },
      onFile: (path) => this.composerParts.addFile(path),
      onRows: (rows) => {
        if (rows > 0) holdSlot(this.shell, autocomplete.container, rows);
        else releaseSlot(this.shell, autocomplete.container);
        this.scheduleHints();
      },
    });
    this.autocomplete = autocomplete;
    this.shell.closeCompletion = () => autocomplete.close();

    const previousChange = this.shell.input.onContentChange;
    let marksScheduled = false;
    let latestText = "";
    this.shell.input.onContentChange = (event) => {
      previousChange?.(event);
      this.document.during(() => {
        const text = this.document.read().text;
        latestText = text;
        this.composerParts.retain(text);
        if (!marksScheduled) {
          marksScheduled = true;
          queueMicrotask(() => {
            marksScheduled = false;
            if (this.disposed || this.shell.input.isDestroyed) return;
            this.composerParts.sync(
              this.shell.input,
              styleId,
              this.shell.inputWidthMethod,
              latestText,
            );
            this.attachmentPreview.retain(this.composerParts.current);
          });
        }
        this.refreshAutocompleteAt(text, this.shell.input.cursorOffset);
        this.scheduleHints();
        // An emptied composer lets a waiting handback land.
        if (
          text.trim() === "" &&
          this.session !== undefined &&
          this.handbacks.has(this.session.sessionId)
        ) {
          this.pendingVisual ??= {
            session: this.session,
            previous: this.session.state,
            reset: false,
          };
          this.renderer.requestRender();
        }
      });
    };
    this.shell.input.onPaste = (event) => this.handlePaste(event);
    this.shell.input.onMouseUp = (event) => {
      if (event.button !== 0 || this.shell.ui.selecting || this.shell.ui.prompting) return;
      if (this.renderer.getSelection()?.getSelectedText()) return;
      this.openAttachment();
    };
    this.shell.scroll.onPaste = (event) => {
      this.focusComposer();
      this.handlePaste(event);
      event.stopPropagation();
    };
    // Temporary readLine prompts use native submit; chat submits only through its keymap binding.
    this.shell.input.onSubmit = undefined;
    this.disposers.push(() => autocomplete.destroy());
  }

  private refreshAutocomplete(): void {
    if (this.shell.input.isDestroyed) return;
    this.refreshAutocompleteAt(this.shell.input.plainText, this.shell.input.cursorOffset);
  }

  private refreshAutocompleteAt(value: string, cursor: number): void {
    const autocomplete = this.autocomplete;
    if (autocomplete === undefined) return;
    if (this.shell.ui.prompting || this.shell.ui.selecting || value.startsWith("!")) {
      autocomplete.close();
      return;
    }
    autocomplete.update(
      value,
      this.session?.completionCommands ?? [],
      this.mentionFiles,
      this.workspace.cwd,
      cursor,
    );
  }

  private async refreshMentionFiles(): Promise<void> {
    this.mentionController?.abort();
    const controller = new AbortController();
    this.mentionController = controller;
    try {
      const files = await discoverMentionFiles(this.workspace.cwd, controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      this.mentionFiles = files;
      this.refreshAutocomplete();
    } catch (error) {
      if (!controller.signal.aborted) this.reportError(error);
    } finally {
      if (this.mentionController === controller) this.mentionController = undefined;
    }
  }

  private handlePaste(event: PasteEvent): void {
    this.promptHistory.resetBrowse();
    event.preventDefault();
    if (this.shell.ui.selecting || this.disposed) return;
    if (this.shell.ui.prompting) {
      this.shell.input.insertText(decodePasteBytes(event.bytes));
      return;
    }
    this.enqueuePaste(async () => {
      if (
        event.metadata?.kind === "binary" ||
        event.metadata?.mimeType?.startsWith("image/") === true
      ) {
        const image = resolveComposerImagePaste(event.bytes);
        if (image === undefined) throw new Error("Unsupported image data");
        const marker = this.composerParts.addImage(image.image);
        if (!this.shell.input.plainText.includes(marker)) this.shell.input.insertText(`${marker} `);
        return;
      }
      await this.pasteInputText(decodePasteBytes(event.bytes));
    });
  }

  private enqueuePaste(work: () => Promise<void>): void {
    const session = this.session;
    const pending = (this.pasting ?? Promise.resolve())
      .then(async () => {
        if (
          this.disposed ||
          this.session !== session ||
          this.shell.ui.selecting ||
          this.shell.ui.prompting
        )
          return;
        await work();
      })
      .catch((cause: unknown) => {
        this.pasteFailures += 1;
        this.reportError(cause);
      })
      .finally(() => {
        if (this.pasting === pending) this.pasting = undefined;
      });
    this.pasting = pending;
  }

  private async pasteInputText(text: string): Promise<void> {
    const session = this.session;
    const workspace = this.workspace;
    const paste = await resolveComposerPaste(text, workspace.cwd);
    if (
      this.disposed ||
      this.workspace !== workspace ||
      this.session !== session ||
      this.shell.ui.selecting ||
      this.shell.ui.prompting
    )
      return;
    switch (paste.kind) {
      case "text": {
        const extmark = this.shell.input.extmarks.getVirtual().find((mark) => {
          const marker = this.shell.input.getTextRange(mark.start, mark.end);
          const part = this.composerParts.current.find((candidate) => candidate.marker === marker);
          return (
            (mark.end === this.shell.input.cursorOffset ||
              mark.end + 1 === this.shell.input.cursorOffset) &&
            part?.kind === "paste" &&
            part.text === paste.text
          );
        });
        if (
          extmark !== undefined &&
          this.composerParts.expandPastedText(
            this.shell.input,
            extmark.id,
            this.shell.inputWidthMethod,
          )
        )
          return;
        this.shell.input.insertText(
          pasteLineCount(paste.text) > PASTE_COLLAPSE_LINES
            ? `${this.composerParts.addPaste(paste.text)} `
            : paste.text,
        );
        return;
      }
      case "file":
        this.shell.input.insertText(`${this.composerParts.addFile(paste.path)} `);
        return;
      case "image": {
        const marker = this.composerParts.addImage(paste.image);
        if (!this.shell.input.plainText.includes(marker)) this.shell.input.insertText(`${marker} `);
        return;
      }
      default: {
        const _exhaustive: never = paste;
        throw new Error(_exhaustive);
      }
    }
  }

  private openAttachment(): void {
    const part = this.composerParts.atCursor(this.shell.input);
    if (part === undefined) return;
    if (part.kind === "paste") {
      const extmark = this.shell.input.extmarks
        .getAtOffset(this.shell.input.cursorOffset)
        .find((mark) => this.shell.input.getTextRange(mark.start, mark.end) === part.marker);
      if (extmark !== undefined)
        this.composerParts.expandPastedText(
          this.shell.input,
          extmark.id,
          this.shell.inputWidthMethod,
        );
      return;
    }
    const session = this.session;
    void this.composerParts
      .preview(part)
      .then((preview) => {
        if (this.disposed || session !== this.session || !this.composerParts.current.includes(part))
          return;
        this.attachmentPreview.toggle(preview, this.shell.transcript.syntaxStyle);
      })
      .catch(this.reportError);
  }

  private async pasteClipboard(): Promise<void> {
    const session = this.session;
    const result = await this.clipboard.read();
    if (
      this.disposed ||
      session !== this.session ||
      this.shell.ui.selecting ||
      this.shell.ui.prompting
    )
      return;
    if (result === undefined) {
      this.pasteFailures += 1;
      notice(
        this.shell,
        "Clipboard has no supported text or image. Use your terminal's paste shortcut.",
      );
      return;
    }
    if (result.mime === "text/plain") return this.pasteInputText(result.data);
    this.handlePaste(
      new PasteEvent(Buffer.from(result.data, "base64"), { kind: "binary", mimeType: result.mime }),
    );
  }

  private focusComposer(): void {
    this.shell.focus.reset();
    this.refreshHints();
  }

  private cancelPasteSubmission(): void {
    this.pasteSubmission?.release();
    this.pasteSubmission = undefined;
  }

  private clearComposer(): void {
    this.cancelPasteSubmission();
    this.autocomplete?.close();
    this.composerParts.clear();
    this.promptHistory.resetBrowse();
    this.shell.input.clear();
    this.focusComposer();
  }

  private saveDraft(): void {
    const session = this.session;
    if (session === undefined) return;
    const text = this.shell.input.plainText;
    this.drafts.save(session.sessionId, text, this.composerParts.current);
  }

  private restoreDraft(id: string): void {
    const draft = this.drafts.read(id);
    this.composerParts.restore(draft?.parts ?? []);
    setInputText(this.shell.input, draft?.text ?? "");
  }

  /** Enter and ctrl+enter both land here; only the lane differs. */
  private submitComposer(action: Extract<ComposerOperation, { readonly lane: string }>): void {
    const session = this.session;
    if (session === undefined || this.shell.ui.loading !== undefined) {
      notice(this.shell, "Loading session. Your draft is saved here.");
      return;
    }
    if (this.changingDirectory || this.switchingSession) {
      notice(this.shell, "Switching workspace. Your draft is saved here.");
      return;
    }
    if (
      this.shell.ui.prompting ||
      this.shell.ui.selecting ||
      this.submitting ||
      this.pasteSubmission !== undefined
    )
      return;
    if (this.authenticating !== undefined) {
      notice(this.shell, "Finish signing in or out first. Esc cancels.");
      return;
    }
    this.refreshAutocomplete();
    if (this.autocomplete?.accepting === true) return;
    if (this.pasting !== undefined) {
      const slot = session.config.reserveSubmission();
      const failures = this.pasteFailures;
      this.pasteSubmission = slot;
      void (async () => {
        try {
          // Clipboard image decoding can append another paste to the same chain.
          while (this.pasting !== undefined && this.pasteSubmission === slot) await this.pasting;
          if (this.pasteSubmission !== slot) return;
          if (
            this.disposed ||
            this.session !== session ||
            this.shell.ui.prompting ||
            this.shell.ui.selecting ||
            this.switchingSession ||
            this.changingDirectory ||
            this.authenticating !== undefined ||
            this.shell.ui.loading !== undefined
          )
            return;
          if (failures !== this.pasteFailures) return;
          await this.submitReady(action, session, slot);
        } finally {
          if (this.pasteSubmission === slot) this.cancelPasteSubmission();
        }
      })().catch(this.reportError);
      return;
    }
    void this.submitReady(action, session).catch(this.reportError);
  }

  private async submitReady(
    action: Extract<ComposerOperation, { readonly lane: string }>,
    session: FollowedSession,
    reserved?: SubmissionSlot,
  ): Promise<void> {
    const lane = action.lane;
    if (action.kind === "save-edit") {
      await this.confirmEdit(session, lane);
      return;
    }
    const draft = this.shell.input.plainText;
    const submission = parseComposerSubmission(draft);
    if (submission.kind === "shell") {
      if (this.activeShell !== undefined) {
        notice(this.shell, "A local command is running. Esc stops it; your draft is kept.");
        return;
      }
      this.submitting = true;
      this.shell.input.clear();
      this.promptHistory.resetBrowse();
      this.autocomplete?.close();
      queueMicrotask(() => {
        this.submitting = false;
      });
      this.promptHistory.record(draft);
      this.startShell(session, submission);
      return;
    }
    if (submission.kind === "empty") {
      if (lane !== this.roles.steer) return;
      const waiting = this.waiting;
      if (waiting === undefined) this.steerFirstQueued(session);
      else this.askQuestion(session, waiting);
      return;
    }
    const { skills } = session;
    const commandTarget =
      submission.kind === "command"
        ? this.resolveTarget(session, submission.command.name)
        : undefined;
    // A skill named inside the draft makes the whole thing a prompt; a slash
    // line only becomes a command when this host can invoke it.
    const inlineSkills = hasInlineSkills(draft, skills);
    const prompting =
      submission.kind === "prompt" ||
      commandTarget?.kind === "message" ||
      commandTarget?.kind === "skill" ||
      (!(commandTarget?.kind === "builtin" && commandTarget.name === "cd") && inlineSkills);
    // A foreground shell result must not arrive after the prompt that refers to it.
    if (prompting && this.activeShell !== undefined) {
      notice(this.shell, "A local command is running. Wait or press Esc; your draft is kept.");
      return;
    }
    // A selection without an "other" answer cannot be answered from the composer; reopen its menu.
    if (
      prompting &&
      lane === this.roles.steer &&
      this.waiting !== undefined &&
      this.waiting.selection.other === undefined
    ) {
      this.askQuestion(session, this.waiting);
      return;
    }
    const captured: ComposerDraft = { text: draft, parts: [...this.composerParts.current] };
    let leading = true;
    const preparing = prompting
      ? this.composerParts.prepare(draft, (text) => {
          if (commandTarget?.kind !== "skill" || inlineSkills)
            return expandInlineSkills(text, skills);
          // Images split the draft into text segments. Only the first contains
          // the command; subsequent segments keep their arguments verbatim.
          if (!leading) return text;
          leading = false;
          const argument = text.slice(commandTarget.skill.name.length + 1).trimStart();
          return formatSkillInvocation(commandTarget.skill, argument || undefined);
        })
      : undefined;
    // Reserve this message's place behind the configuration it was pressed
    // under, before preparation yields; configuration selected later waits.
    const slot =
      preparing === undefined ? undefined : (reserved ?? session.config.reserveSubmission());
    // Captured submissions own admission now; clearing a later draft only cancels paste waiting.
    if (slot !== undefined && this.pasteSubmission === slot) this.pasteSubmission = undefined;
    this.submitting = true;
    this.shell.input.clear();
    this.promptHistory.resetBrowse();
    this.autocomplete?.close();
    queueMicrotask(() => {
      this.submitting = false;
    });
    if (preparing === undefined) {
      if (submission.kind === "command" && commandTarget !== undefined) {
        void this.runCommand(submission.command, { lane, target: commandTarget }).catch(
          this.reportError,
        );
      }
    } else if (slot !== undefined) {
      try {
        const prepared = await preparing;
        this.promptHistory.record(prepared.displayText);
        const result = await slot.configured;
        if (result !== undefined && result.kind !== "acknowledged") {
          // The configuration this message was pressed under never reached
          // core, so the message stays unsent, with every part it carried.
          const reason = result.kind === "failed" ? result.message : "configuration changed";
          this.stageHandback(session.sessionId, {
            draft: { text: captured.text, parts: prepared.parts },
            notice: `Message not sent: ${reason}. It is back in the composer.`,
          });
          return;
        }
        await this.send(session, prepared.content, lane);
      } catch (cause) {
        this.stageHandback(session.sessionId, {
          draft: captured,
          notice: "Message preparation failed. The original draft is back in the composer.",
        });
        throw cause;
      } finally {
        slot.release();
      }
    }
  }

  // -------------------------------------------------------------------------
  // `!command`: a foreground process owned only by this TUI
  // -------------------------------------------------------------------------

  private startShell(
    session: FollowedSession,
    submission: Extract<ComposerSubmission, { readonly kind: "shell" }>,
  ): void {
    const command = startLocalShell({
      command: submission.command,
      cwd: this.workspace.cwd,
      signal: this.stopped.signal,
      onUpdate: (execution) => this.syncShell(execution),
    });
    this.shellCommands.set(command.snapshot.id, {
      sessionId: session.sessionId,
      head: session.state.head,
      process: command,
      retention: submission.retain ? "pending" : "exclude",
    });
    this.activeShell = command;
    this.syncShell(command.snapshot);
    this.refreshHints();
    this.scrollToEnd();
    void command.done
      .then(() => {
        if (this.activeShell === command) this.activeShell = undefined;
        if (this.disposed) return;
        this.flushShellMarkers();
        this.refreshHints();
      })
      .catch(this.reportError);
  }

  private syncShell(execution: ShellExecution): void {
    if (this.disposed) return;
    const entry = this.shellCommands.get(execution.id);
    if (
      entry === undefined ||
      this.session?.sessionId !== entry.sessionId ||
      this.state?.head !== entry.head
    )
      return;
    this.shell.view.syncShell(
      execution,
      entry.retention === "exclude" ? "not sent to model" : undefined,
    );
    if (execution.state !== "running") this.refreshHints();
  }

  /** Keep a finished command with its session until its composer is available. */
  private flushShellMarkers(): void {
    if (
      this.shell.input.onSubmit !== undefined ||
      this.shell.ui.prompting ||
      this.shell.ui.selecting
    )
      return;
    for (const entry of this.shellCommands.values()) {
      if (
        entry.retention !== "pending" ||
        entry.sessionId !== this.session?.sessionId ||
        entry.head !== this.state?.head
      )
        continue;
      const execution = entry.process.snapshot;
      // Cancellation, signals and launch failures have no exit code to fabricate.
      if (execution.state === "running") continue;
      if (execution.state !== "exited") {
        entry.retention = "discarded";
        continue;
      }
      entry.retention = "attached";
      const marker = this.composerParts.addShell({
        command: execution.command,
        output: execution.output,
        exitCode: execution.exitCode,
      });
      this.document.invalidate();
      const text = this.shell.input.plainText;
      // Prefix the result: a draft typed while the command ran now follows its context.
      setInputText(this.shell.input, `${marker} ${text}`);
    }
  }

  private restoreShellCards(session: FollowedSession): void {
    for (const entry of this.shellCommands.values()) {
      if (entry.sessionId === session.sessionId && entry.head === session.state.head)
        this.syncShell(entry.process.snapshot);
    }
    this.flushShellMarkers();
  }

  /** A plain line answers a parked question through the reply channel; anything else is admitted. */
  private async send(
    session: FollowedSession,
    content: SessionState["pending"][number]["content"],
    lane: string,
  ): Promise<void> {
    const waiting = waitingCall(session.state);
    if (waiting?.selection.other !== undefined && lane === this.roles.steer) {
      if (!Array.isArray(content)) return this.answer(waiting, { choices: [], other: content });
      notice(
        this.shell,
        "Attachments can't answer a question; sent as a message",
        this.shell.theme.warning,
      );
    }
    if (this.session === session) this.scrollToEnd();
    const outcome = await session.outbox.submit({ content, lane });
    if (outcome.kind === "withdrawn") notice(this.shell, "Message withdrawn");
  }

  private scrollToEnd(): void {
    this.shell.view.returnToLatest();
  }

  private steerFirstQueued(session: FollowedSession): void {
    const next = nextToSteer(session.state.pending, this.roles);
    if (next === undefined) return;
    void this.redeliver(session, next.change).catch(this.reportError);
  }

  private async redeliver(session: FollowedSession, change: Oid): Promise<void> {
    const outcome = await this.host.nyte.messages.redeliver({
      sessionId: session.sessionId,
      change,
      lane: this.roles.steer,
    });
    switch (outcome.kind) {
      case "redelivered":
      case "unchanged":
        return;
      case "landed":
      case "not_found":
        notice(this.shell, "That message was already sent", this.shell.theme.warning);
        return;
      default: {
        const _exhaustive: never = outcome;
        return _exhaustive;
      }
    }
  }

  private async cancelPending(session: FollowedSession, change: Oid): Promise<boolean> {
    const outcome = await this.host.nyte.messages.cancel({ sessionId: session.sessionId, change });
    if (outcome.kind === "cancelled") return true;
    notice(this.shell, "That message was already sent", this.shell.theme.warning);
    return false;
  }

  private queueChoices(): Choice[] {
    const session = this.session;
    if (session === undefined) return [];
    return sessionRows(session).map((row, index) => ({
      id: rowId(row),
      label: queuedPromptText(row.kind === "pending" ? row.item.content : row.entry.content),
      description: `${String(index + 1)} · ${row.kind === "pending" ? laneMark(row.item.lane, this.roles, this.shell.theme).label : "sending"}`,
    }));
  }

  private closeQueue(): void {
    if (this.queueMenu === undefined) return;
    const menu = this.queueMenu;
    this.queueMenu = undefined;
    this.queueSelection = undefined;
    closePanel(this.shell, menu);
    this.refreshHints();
  }

  /** The live queue shares the composer's rich parts and core's atomic redelivery. */
  private async openQueue(selectedId?: string): Promise<void> {
    const session = this.requireSession();
    if (this.queueMenu !== undefined || this.shell.ui.selecting || this.shell.ui.prompting) return;
    const rows = () => sessionRows(session);
    if (rows().length === 0) {
      notice(this.shell, "Nothing is queued");
      return;
    }
    const edit = async (id: string): Promise<void> => {
      const row = rows().find((candidate) => rowId(candidate) === id);
      if (row === undefined) return;
      if (this.queueEdits.has(session.sessionId)) {
        notice(this.shell, "Save or cancel the current queue edit first.");
        return;
      }
      if (row.kind === "sending") {
        const outcome = await session.outbox.withdraw(row.entry.key);
        if (outcome === undefined || this.disposed || this.session !== session) return;
        const stash = {
          lane: row.entry.lane,
          draft: { text: this.shell.input.plainText, parts: this.composerParts.current },
        };
        this.queueEdits.set(
          session.sessionId,
          outcome.kind === "durable"
            ? { ...stash, kind: "pending", change: outcome.change }
            : { ...stash, kind: "sending", content: row.entry.content },
        );
        this.handBack(row.entry.content, "Back in the composer.");
        return;
      }
      this.queueEdits.set(session.sessionId, {
        kind: "pending",
        change: row.item.change,
        lane: row.item.lane,
        draft: { text: this.shell.input.plainText, parts: this.composerParts.current },
      });
      this.handBack(row.item.content, "Editing queued message. Enter saves; Esc cancels.");
    };
    const drop = async (id: string): Promise<void> => {
      const row = rows().find((candidate) => rowId(candidate) === id);
      if (row === undefined) return;
      const withdrawn =
        row.kind === "sending" ? await session.outbox.withdraw(row.entry.key) : undefined;
      const removed =
        row.kind === "pending"
          ? await this.cancelPending(session, row.item.change)
          : withdrawn?.kind === "durable"
            ? await this.cancelPending(session, withdrawn.change)
            : withdrawn?.kind === "withdrawn";
      if (removed) notice(this.shell, "Removed from the queue");
    };
    const move = async (id: string, delta: -1 | 1): Promise<void> => {
      const row = rows().find((candidate) => rowId(candidate) === id);
      if (row?.kind !== "pending") return;
      const lane = session.state.pending.filter((item) => item.lane === row.item.lane);
      const index = lane.findIndex((item) => item.change === row.item.change);
      if (index + delta < 0 || index + delta >= lane.length) return;
      await this.reorder(
        session,
        row.item.change,
        row.item.lane,
        lane[index + (delta === -1 ? -1 : 2)]?.change ?? null,
      );
    };
    this.queueMenu = openInlineMenu(
      this.shell,
      {
        title: "Queued messages",
        choices: this.queueChoices(),
        selectedId,
        selectLabel: "send now",
        actions: [
          { command: "chat.queue.edit", label: "edit", run: edit },
          { command: "chat.queue.delete", label: "delete", run: drop },
          { command: "chat.queue.up", label: "earlier", keepOpen: true, run: (id) => move(id, -1) },
          { command: "chat.queue.down", label: "later", keepOpen: true, run: (id) => move(id, 1) },
        ],
        onSelect: (id) => {
          const row = rows().find((candidate) => rowId(candidate) === id);
          this.closeQueue();
          if (row?.kind === "pending")
            void this.redeliver(session, row.item.change).catch(this.reportError);
        },
        onCancel: () => this.closeQueue(),
      },
      this.reportError,
    );
  }

  private async reorder(
    session: FollowedSession,
    change: Oid,
    lane: string,
    before: Oid | null,
  ): Promise<void> {
    const outcome = await this.host.nyte.messages.redeliver({
      sessionId: session.sessionId,
      change,
      lane,
      before,
    });
    if (outcome.kind === "redelivered") {
      this.queueSelection = `pending:${outcome.change}`;
      this.syncGutter(session);
    } else if (outcome.kind !== "unchanged") {
      notice(this.shell, "The queue changed. Try again.");
    }
  }

  private cancelEdit(
    options: { readonly session?: FollowedSession; readonly restoreSending?: boolean } = {},
  ): void {
    const session = options.session ?? this.session;
    if (session === undefined) return;
    const editing = this.queueEdits.get(session.sessionId);
    if (editing === undefined) return;
    if (options.restoreSending !== false && editing.kind === "sending")
      void session.outbox.submit({ content: editing.content, lane: editing.lane });
    this.queueEdits.delete(session.sessionId);
    if (this.session !== session) {
      this.drafts.save(session.sessionId, editing.draft.text, editing.draft.parts);
      return;
    }
    this.composerParts.restore(editing.draft.parts);
    setInputText(this.shell.input, editing.draft.text);
    this.focusComposer();
  }

  private async confirmEdit(session: FollowedSession, lane: string): Promise<void> {
    const editing = this.queueEdits.get(session.sessionId);
    if (editing === undefined || this.submitting) return;
    const text = this.shell.input.plainText;
    if (text.trim() === "") {
      notice(this.shell, "Enter a message, or press Esc to cancel the edit.");
      return;
    }
    this.submitting = true;
    this.shell.input.blur();
    try {
      const prepared = await this.composerParts.prepare(text, (value) =>
        expandInlineSkills(value, session.skills),
      );
      if (editing.kind === "sending") {
        void session.outbox.submit({ content: prepared.content, lane });
        this.cancelEdit({ session, restoreSending: false });
        return;
      }
      const original = session.state.pending.find((item) => item.change === editing.change);
      if (
        original !== undefined &&
        lane === original.lane &&
        JSON.stringify(original.content) === JSON.stringify(prepared.content)
      ) {
        this.cancelEdit({ session });
        return;
      }
      const outcome = await this.host.nyte.messages.redeliver({
        sessionId: session.sessionId,
        change: editing.change,
        lane,
        content: prepared.content,
      });
      if (outcome.kind === "redelivered" || outcome.kind === "unchanged") {
        this.cancelEdit({ session });
        notice(this.shell, "Queued message saved.");
      } else {
        notice(
          this.shell,
          "That message was already sent or changed. Your edit is still here; Esc restores your draft.",
        );
      }
    } finally {
      this.submitting = false;
      if (!this.disposed) this.focusComposer();
    }
  }

  // -------------------------------------------------------------------------
  // Keys
  // -------------------------------------------------------------------------

  private wireKeymap(): void {
    const keymap = this.shell.keymap;
    const tasks = this.tasks;
    /** Down on an empty composer opens the task list when there is one. */
    const viewsTasks = (): boolean => tasks.hasTasks && this.document.read().kind === "empty";
    const composer = new ComposerActions(
      this.shell,
      this.roles,
      () => {
        // Another surface owning the keyboard settles every action; the draft is not read for it.
        const blocked = this.composerBlocked();
        const draft = blocked === undefined ? this.document.read() : this.document.latest;
        const input = draft === undefined ? undefined : parseComposerSubmission(draft.text);
        const asked = this.state === undefined ? undefined : waitingCall(this.state);
        return {
          busy: this.busy,
          shell: this.activeShell !== undefined,
          shellInput: input?.kind === "shell" ? (input.retain ? "include" : "exclude") : undefined,
          waiting: this.waiting !== undefined || asked !== undefined,
          question: asked?.selection.other !== undefined,
          draft: draft?.kind ?? "empty",
          editingLane:
            this.session === undefined
              ? undefined
              : this.queueEdits.get(this.session.sessionId)?.lane,
          followUp: this.settings.followUp,
          completion: this.autocomplete?.visible
            ? { accepting: this.autocomplete.accepting, queueable: this.autocomplete.queueable }
            : undefined,
          blocked,
        };
      },
      (operation) => {
        this.document.invalidate();
        switch (operation.kind) {
          case "submit":
          case "save-edit":
            if (this.autocomplete?.accepting && !this.autocomplete.completeQueueableCommand())
              return;
            this.submitComposer(operation);
            break;
          case "cancel-edit":
            this.cancelEdit();
            break;
          case "stop":
            if (this.activeShell !== undefined) {
              this.activeShell.cancel();
              break;
            }
            if (this.compaction !== undefined) {
              this.compaction.abort();
              break;
            }
            if (this.state?.run !== undefined && !isTerminalPhase(this.state.run.phase)) {
              void this.stopRun(this.requireSession());
            }
            break;
          case "tree":
            if (this.doubleEscape.press()) void this.openTree({}).catch(this.reportError);
            break;
          case "clear":
            this.clearComposer();
            break;
          case "quit":
            this.options.requestShutdown();
            break;
        }
        this.refreshHints();
      },
    );
    this.composerActions = composer;
    this.disposers.push(() => composer.dispose());
    const scheduleHints = (): void => this.scheduleHints();
    this.renderer.on(CliRenderEvents.SELECTION, scheduleHints);
    this.renderer.on(CliRenderEvents.RESIZE, scheduleHints);
    this.disposers.push(
      keymap.on("state", scheduleHints),
      keymap.intercept("key:after", scheduleHints),
      () => this.renderer.off(CliRenderEvents.SELECTION, scheduleHints),
      () => this.renderer.off(CliRenderEvents.RESIZE, scheduleHints),
    );
    const onRun = (): void => this.document.invalidate();
    this.disposers.push(
      registerChatLayer(keymap, {
        enabled: () => this.composerBlocked() === undefined,
        onRun,
        commands: {
          "chat.commands.open": {
            title: "Commands and active shortcuts",
            hint: "help",
            placement: "help",
            run: () => {
              void this.openCommandPalette().catch(this.reportError);
              return true;
            },
          },
        },
      }),
    );
    this.disposers.push(
      registerSelectionKeys(keymap, this.renderer, {
        copyOnSelect: () => this.settings.copyOnSelect,
        copy: (text) => {
          void this.clipboard
            .write(text)
            .then(() => notice(this.shell, "Copied to clipboard"))
            .catch(this.reportError);
        },
      }),
    );
    this.disposers.push(
      keymap.intercept("key", (ctx) => {
        if (this.shell.ui.prompting || this.shell.ui.selecting) return;
        if (
          matchesKeyName("chat.history.previous", ctx.event) ||
          matchesKeyName("chat.history.next", ctx.event)
        )
          return;
        this.promptHistory.resetBrowse();
      }),
    );
    this.disposers.push(
      registerChatLayer(keymap, {
        enabled: () => this.composerBlocked() === undefined && this.autocomplete?.visible !== true,
        onRun,
        commands: {
          "chat.job.background": {
            title: "Move agent work to background",
            unavailable: () =>
              this.activeShell === undefined
                ? undefined
                : "Local commands run in the foreground. Esc stops the command.",
            hint: "background",
            get placement() {
              return tasks.hasForegroundWork ? ("secondary" as const) : undefined;
            },
            run: () => {
              void this.tasks.backgroundForeground().catch(this.reportError);
              return true;
            },
          },
          "chat.scroll.page.up": {
            title: "Scroll the transcript up",
            run: () => {
              this.shell.view.scrollBy(-0.5, "viewport");
              return true;
            },
          },
          "chat.scroll.page.down": {
            title: "Scroll the transcript down",
            run: () => {
              this.shell.view.scrollBy(0.5, "viewport");
              return true;
            },
          },
          "chat.scroll.latest": {
            title: "Jump to latest",
            run: () => {
              this.shell.view.returnToLatest();
              return true;
            },
          },
          "chat.message.previous": {
            title: "Previous message",
            run: () => this.shell.view.jumpTurn("previous"),
          },
          "chat.message.next": {
            title: "Next message",
            run: () => this.shell.view.jumpTurn("next"),
          },
          "chat.thinking.cycle": {
            title: "Cycle the thinking level",
            hint: "thinking",
            placement: "secondary",
            run: () => {
              this.cycleThinkingLevel();
              return true;
            },
          },
          "chat.model.next": {
            title: "Next model",
            hint: "model",
            placement: "secondary",
            run: () => {
              this.cycleModel(1);
              return true;
            },
          },
          "chat.model.previous": {
            title: "Previous model",
            run: () => {
              this.cycleModel(-1);
              return true;
            },
          },
          "chat.editor.open": {
            title: "Edit the draft in your editor",
            run: () => {
              this.openExternalEditor();
              return true;
            },
          },
          "chat.attachment.open": {
            title: "Expand or preview the attachment at the cursor",
            run: () => {
              this.openAttachment();
              return true;
            },
          },
          "chat.clipboard.paste": {
            title: "Paste text or an image from the clipboard",
            run: () => {
              this.enqueuePaste(() => this.pasteClipboard());
              return true;
            },
          },
          "chat.queue.open": {
            title: "Edit or remove queued messages",
            run: () => {
              void this.openQueue().catch(this.reportError);
              return true;
            },
          },
          "chat.tools.toggle": {
            title: "Expand or collapse tool output and thoughts",
            run: () => {
              const expanded = this.shell.transcript.toolOutput.toggle();
              notice(this.shell, `Output ${expanded ? "expanded" : "collapsed"}`);
              return true;
            },
          },
          "chat.skills.open": {
            title: "Run a skill",
            run: () => {
              this.focusComposer();
              void this.openSkillPalette().catch(this.reportError);
              return true;
            },
          },
          "chat.history.previous": {
            title: "Previous message you sent at the start of the draft",
            run: () => browseHistory(this.shell.input, this.promptHistory, "previous"),
          },
          "chat.history.next": {
            get title() {
              return viewsTasks() ? "View tasks" : "Next message you sent at the end of the draft";
            },
            get hint() {
              return viewsTasks() ? "view tasks" : "next history at end";
            },
            get placement() {
              return viewsTasks() ? ("secondary" as const) : undefined;
            },
            run: () => {
              if (browseHistory(this.shell.input, this.promptHistory, "next")) return true;
              if (!viewsTasks()) return false;
              this.tasks.open();
              return true;
            },
          },
        },
      }),
    );
    this.disposers.push(
      registerChatLayer(keymap, {
        enabled: () =>
          this.authenticating !== undefined &&
          this.authenticationLink !== undefined &&
          !this.shell.ui.prompting &&
          !this.shell.ui.selecting,
        commands: {
          "auth.open": {
            title: "Open authentication URL",
            run: () => {
              const link = this.authenticationLink;
              if (link === undefined) return false;
              void open(link.url).catch(this.reportError);
              return true;
            },
          },
          "auth.copy": {
            title: "Copy authentication details",
            run: () => {
              const link = this.authenticationLink;
              if (link === undefined) return false;
              void this.clipboard.write(link.copy).catch(this.reportError);
              return true;
            },
          },
        },
      }),
    );
    // Authentication keeps its existing isolated cancellation lifecycle.
    const onKeyPress = (key: KeyEvent): void => {
      // The keymap's listener ran first; whatever it left open is over for this key.
      this.document.close();
      if (key.defaultPrevented) return;
      if (
        this.authenticating !== undefined &&
        !this.shell.ui.prompting &&
        !this.shell.ui.selecting &&
        matchesKey("auth.cancel", key, "required")
      ) {
        key.preventDefault();
        key.stopPropagation();
        this.authenticating.abort(new PickerCancelled());
        return;
      }
    };
    this.renderer.keyInput.on("keypress", onKeyPress);
    this.disposers.push(() => this.renderer.keyInput.off("keypress", onKeyPress));
  }

  private async stopRun(session: FollowedSession): Promise<void> {
    const run = session.state.run;
    if (run === undefined) return;
    let untouched = true;
    const remove = this.shell.keymap.intercept("key", () => {
      untouched = false;
    });
    const active = (): boolean =>
      untouched &&
      !this.disposed &&
      this.session === session &&
      session.state.run?.runId === run.runId &&
      !isTerminalPhase(session.state.run.phase) &&
      !this.shell.ui.selecting &&
      !this.shell.ui.prompting;
    try {
      const outcome = await this.host.nyte.runs.abort({
        sessionId: session.sessionId,
        runId: run.runId,
      });
      if (active() && outcome.kind === "not_running") notice(this.shell, "No active run to stop.");
      // Only the watcher can report a stopped run or retract its unanswered message.
    } catch (cause) {
      if (active()) this.reportError(cause);
    } finally {
      remove();
    }
  }

  /** Each press steps from the selected level, so a burst of presses steps that many times. */
  private cycleThinkingLevel(): void {
    const session = this.session;
    if (session === undefined) return;
    void session.config
      .prepareSelection(({ model, thinkingLevel }) => {
        const next = nextThinkingLevel(thinkingLevel, getSupportedThinkingLevels(model));
        return next === undefined ? undefined : { thinkingLevel: next };
      })
      .then((result) => {
        if (result.kind === "failed") throw new Error(result.message);
      })
      .catch(this.reportError);
  }

  private cycleModel(delta: 1 | -1): void {
    const session = this.session;
    if (session === undefined) return;
    let cycled: RunChoice | undefined;
    void session.config
      .prepareSelection((selected) => {
        const choose = (available: readonly Model<Api>[]): ConfigPatch | undefined => {
          if (available.length < 2) return undefined;
          const index = available.findIndex(
            (model) => model.provider === selected.model.provider && model.id === selected.model.id,
          );
          const model =
            available[index === -1 ? 0 : (index + delta + available.length) % available.length] ??
            selected.model;
          cycled = { model, thinkingLevel: clampThinkingLevel(model, selected.thinkingLevel) };
          return cycled;
        };
        const cached = cachedAuthenticatedModels(this.runtime.models);
        return cached === undefined
          ? loadAuthenticatedModels(this.runtime.models).then(choose)
          : choose(cached);
      })
      .then((result) => {
        if (result.kind === "failed") throw new Error(result.message);
        if (result.kind !== "acknowledged" || cycled === undefined || this.session !== session)
          return;
        notice(
          this.shell,
          `Model: ${cycled.model.provider}/${cycled.model.id} · ${cycled.thinkingLevel}`,
          this.shell.theme.ok,
        );
      })
      .catch(this.reportError);
  }

  private openExternalEditor(): void {
    if (this.editingExternally) return;
    this.editingExternally = true;
    this.autocomplete?.close();
    const draft = this.shell.input.plainText;
    this.shell.input.blur();
    this.renderer.suspend();
    void editInExternalEditor(draft, resolveExternalEditor(this.settings.externalEditor))
      .then((result) => {
        if (result.status === "completed") setInputText(this.shell.input, result.text);
        else this.reportError(result.error);
      })
      .finally(() => {
        this.renderer.resume();
        this.shell.focus.reset();
        this.renderer.requestRender();
        this.editingExternally = false;
      });
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  private async changeModel(model: Model<Api>, thinkingLevel?: ThinkingLevel): Promise<void> {
    const session = this.requireSession();
    const selected = session.config.selected;
    if (
      !session.config.preparingSelection &&
      selected.model.provider === model.provider &&
      selected.model.id === model.id &&
      clampThinkingLevel(model, thinkingLevel ?? selected.thinkingLevel) === selected.thinkingLevel
    ) {
      notice(this.shell, `Already using ${model.id}`);
      return;
    }
    const result = await session.config.prepareSelection((choice) => ({
      model,
      thinkingLevel: clampThinkingLevel(model, thinkingLevel ?? choice.thinkingLevel),
    }));
    if (result.kind === "failed") throw new Error(result.message);
    if (result.kind === "superseded" || this.session !== session) return;
    notice(
      this.shell,
      `Model: ${model.provider}/${model.id} · ${session.config.selected.thinkingLevel}`,
      this.shell.theme.ok,
    );
  }

  private async changeThinkingLevel(level: ThinkingLevel, announce: boolean): Promise<void> {
    const session = this.requireSession();
    if (!session.config.preparingSelection && session.config.selected.thinkingLevel === level) {
      if (announce) notice(this.shell, `Already using ${level}`);
      return;
    }
    const result = await session.config.request({ thinkingLevel: level });
    if (result.kind === "failed") throw new Error(result.message);
    if (result.kind === "superseded" || this.session !== session) return;
    if (announce) notice(this.shell, `Thinking level: ${level}`, this.shell.theme.ok);
  }

  /** Core queued the choice; it becomes the default for the next chat the same way it did before. */
  private persistChoice(choice: RunChoice, patch: ConfigPatch): void {
    this.updateSettings({
      ...(patch.model === undefined
        ? {}
        : {
            defaultProvider: choice.model.provider,
            defaultModel: choice.model.id,
            defaultThinkingLevel: choice.thinkingLevel,
          }),
      ...(patch.thinkingLevel === undefined ? {} : { defaultThinkingLevel: choice.thinkingLevel }),
    });
  }

  private updateSettings(patch: Omit<SettingsPatch, "compaction">): void {
    this.settings = { ...this.settings, ...patch };
    this.options.onSettings(this.settings);
    void this.settingsStore.updateGlobal(patch).catch(this.reportError);
  }

  private async changeTheme(mode: ThemeMode): Promise<void> {
    this.themeMode = mode;
    this.shell.setTheme(themeForMode(mode));
    this.autocomplete?.retheme(this.shell.theme);
    this.tuiPlugins.refresh();
    notice(this.shell, `Theme: ${mode}`, this.shell.theme.ok);
  }

  /** Pin a mode, or `auto` to hand the choice back to the terminal. Persisted like every setting. */
  private async changeThemeChoice(choiceId: string): Promise<void> {
    if (!isThemeChoice(choiceId)) throw new Error(`Unknown theme: ${choiceId}`);
    this.updateSettings({ theme: choiceId });
    const mode = resolveThemeMode(choiceId, this.renderer.themeMode);
    if (mode === this.themeMode) {
      notice(this.shell, `Theme: ${choiceId}`, this.shell.theme.ok);
      return;
    }
    await this.changeTheme(mode);
  }

  private async trustDirectory(cwd: string): Promise<TrustedWorkspace> {
    const trustStore = createTrustStore();
    const resolution = await trustStore.resolve(cwd);
    this.stopped.signal.throwIfAborted();
    if (resolution.kind === "trusted") return resolution.workspace;
    this.shell.setUi("selecting", true);
    this.shell.input.blur();
    this.shell.input.focusable = false;
    this.autocomplete?.close();
    try {
      const decision = await requestWorkspaceTrust({
        renderer: this.renderer,
        theme: this.shell.theme,
        cwd: resolution.cwd,
        decline: "cancel",
        signal: this.stopped.signal,
        nextId: this.shell.nextId,
      });
      this.stopped.signal.throwIfAborted();
      if (decision !== "trust") throw new PickerCancelled();
      return await trustStore.trust(resolution.cwd);
    } finally {
      if (!this.disposed) {
        this.shell.setUi("selecting", false);
        this.shell.input.focusable = true;
        this.focusComposer();
      }
    }
  }

  private async relocateSession(id: SessionId, workspace: TrustedWorkspace): Promise<void> {
    const resolved = await resolveHostPlugins(
      { kind: "project", workspace },
      {
        model: this.config.model,
        models: this.runtime.models,
        extra: tuiPlugins(this.runtime.models),
      },
    );
    this.stopped.signal.throwIfAborted();
    if (resolved.failures.length > 0)
      throw new Error(
        `Failed to load destination plugins: ${resolved.failures.map((failure) => `${failure.path}: ${failure.error}`).join("; ")}`,
      );
    const outcome = await this.host.relocate(id, workspace, resolved.plugins);
    if (outcome.kind === "busy")
      throw new Error("Wait for active runs and jobs to finish before changing directories.");
  }

  private async changeDirectory(argument: string): Promise<void> {
    if (argument === "") throw new Error("Directory is required. Use /cd <path>.");
    if (this.switchingSession || this.changingDirectory)
      throw new Error("A chat switch is already in progress.");
    const session = this.requireSession();
    if (session.outbox.entries.length > 0 || session.state.pending.length > 0)
      throw new Error("Wait for queued messages before changing directories.");
    this.changingDirectory = true;
    try {
      const path =
        argument === "~"
          ? homedir()
          : argument.startsWith("~/")
            ? resolve(homedir(), argument.slice(2))
            : resolve(this.workspace.cwd, argument);
      const workspace = await this.trustDirectory(path);
      if (workspace.cwd === this.workspace.cwd) {
        notice(this.shell, `Already in ${workspace.cwd}`);
        return;
      }
      await this.relocateSession(session.sessionId, workspace);
      if (this.disposed || this.session !== session) return;
      await this.useWorkspace(workspace);
      await this.refreshContributions(session);
      await this.tuiPlugins.reconcile();
      notice(this.shell, `Working directory: ${workspace.cwd}`, this.shell.theme.ok);
    } finally {
      this.changingDirectory = false;
    }
  }

  private watchWorkspacePlugins(): void {
    this.stopPluginWatch?.();
    this.stopPluginWatch = watchPluginDirectories({
      directories: pluginWatchTargets({ kind: "project", workspace: this.workspace }),
      // Runners wait on the hold, so a tool the model just wrote is in its next request.
      hold: () => this.host.nyte.holdPlugins(),
      onChange: () => this.reloadPlugins(),
      onError: (error) => this.reportError(error),
    });
  }

  private async useWorkspace(workspace: TrustedWorkspace): Promise<void> {
    if (workspace.cwd === this.workspace.cwd) return;
    this.mentionController?.abort();
    this.stopPluginWatch?.();
    await this.tuiPlugins.dispose();
    if (this.disposed) return;
    this.workspace = workspace;
    this.tuiPlugins = new PluginProvider({
      shell: this.shell,
      workspace,
      client: this.host.nyte,
      sessionID: () => this.sessionId,
    });
    this.watchWorkspacePlugins();
    patchStatus(this.shell, {
      workspace: basename(workspace.cwd),
      branch: undefined,
      dirty: false,
    });
    this.refreshWorkspace();
    this.mentionFiles = [];
    this.autocomplete?.close();
    await this.refreshMentionFiles();
  }

  private async reloadPlugins(): Promise<void> {
    if (this.changingDirectory || this.switchingSession) return;
    const workspace = this.workspace;
    const session = this.session;
    await this.tuiPlugins.reconcile();
    const resolved = await resolveHostPlugins(
      { kind: "project", workspace: this.workspace },
      {
        model: this.config.model,
        models: this.runtime.models,
        extra: tuiPlugins(this.runtime.models),
      },
    );
    for (const failure of resolved.failures) {
      notice(this.shell, `plugin ${failure.path}: ${failure.error}`, this.shell.theme.error);
    }
    if (
      this.disposed ||
      this.changingDirectory ||
      this.switchingSession ||
      this.workspace !== workspace ||
      this.session !== session
    )
      return;
    if (workspace.cwd === this.host.cwd) await this.host.nyte.setPlugins(resolved.plugins);
    if (session !== undefined) {
      await this.host.nyte.setPlugins(resolved.plugins, { sessionId: session.sessionId });
      await this.refreshContributions(session);
    }
  }

  private async checkUpdate(): Promise<void> {
    const release = await checkForUpdate();
    if (release === undefined || this.disposed) return;
    if (!this.settings.autoUpdate) {
      notice(this.shell, `Update available: ${release.version} · /update to install`);
      return;
    }
    const outcome = await selfUpdate();
    if (this.disposed) return;
    notice(
      this.shell,
      outcome.kind === "updated"
        ? describeUpdateOutcome(outcome)
        : `Update available: ${release.version} · ${describeUpdateOutcome(outcome)}`,
      outcome.kind === "updated" ? undefined : this.shell.theme.warning,
    );
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  private async switchSession(info: SessionInfo, announce: boolean): Promise<void> {
    if (this.switchingSession || this.changingDirectory)
      throw new Error("A chat switch is already in progress");
    this.switchingSession = true;
    try {
      await this.follow(info);
      if (!this.shell.ui.selecting) this.focusComposer();
      if (announce) {
        const session = this.requireSession();
        notice(
          this.shell,
          `Resumed ${shortId(info.sessionId)} · ${String(session.state.transcript.items.length)} items`,
        );
      }
    } finally {
      this.switchingSession = false;
    }
  }

  private async resumeSession(): Promise<void> {
    const current = this.requireSession();
    const { items } = await this.host.nyte.sessions.list({ parent: null });
    const sessions: Choice[] = items
      .filter((session) => session.heads.some((head) => head.tip !== null))
      .toSorted((left, right) => right.lastActivityAt - left.lastActivityAt)
      .map((session) => {
        const title = session.name ?? session.preview ?? shortId(session.sessionId);
        const currentLabel = session.sessionId === current.sessionId ? " (current)" : "";
        const savedAt = new Date(session.lastActivityAt).toLocaleString();
        const description = `${savedAt} · ${shortId(session.sessionId)}`;
        return { id: session.sessionId, label: `${title}${currentLabel}`, description };
      });
    if (sessions.length === 0) {
      notice(this.shell, "No saved chats");
      return;
    }
    const chosen = await selectChoice(this.shell, "Resume chat", sessions, {
      selectedId: current.sessionId,
    });
    if (chosen === current.sessionId) {
      notice(this.shell, `Already in ${shortId(chosen)}`);
      return;
    }
    const info = await this.host.nyte.sessions.get({ sessionId: sessionId(chosen) });
    if (info === undefined) throw new Error(`Session not found: ${chosen}`);
    await this.switchSession(info, true);
  }

  // -------------------------------------------------------------------------
  // Tree navigation
  // -------------------------------------------------------------------------

  private selectTreeCommit(options: {
    readonly tree: ReturnType<typeof projectTree>;
    readonly selectedOid?: Oid | null;
    readonly filter?: TreeFilter;
  }): Promise<Oid> {
    const restoredHints = this.shell.ui.hints;
    return new Promise<Oid>((resolveSelection, reject) => {
      let selector: TreeSelector | undefined;
      let settled = false;
      const settle = (finish: () => void): void => {
        if (settled) return;
        settled = true;
        if (selector !== undefined) closePanel(this.shell, selector);
        this.shell.setUi("composerVisible", true);
        setHints(this.shell, restoredHints);
        finish();
      };
      this.shell.setUi("composerVisible", false);
      selector = openPanel(
        this.shell,
        new TreeSelector(
          {
            renderer: this.renderer,
            theme: this.shell.theme,
            nextId: this.shell.nextId,
            onRows: (rows) => setSlotRows(this.shell, rows),
            onSelect: (oid) => settle(() => resolveSelection(oid)),
            onCancel: () => settle(() => reject(new PickerCancelled())),
          },
          options,
        ),
      );
    });
  }

  /** pi's "Summarize branch?" question. Escape hands the tree back. */
  private async askSummary(): Promise<
    | { readonly kind: "chosen"; readonly summary?: { readonly customInstructions?: string } }
    | { readonly kind: "back" }
  > {
    for (;;) {
      let choice: string;
      try {
        choice = await selectChoice(
          this.shell,
          "Summarize the branch you are leaving?",
          SUMMARY_CHOICES,
        );
      } catch (cause) {
        if (cause instanceof PickerCancelled) return { kind: "back" };
        throw cause;
      }
      if (choice === "none") return { kind: "chosen" };
      if (choice === "summarize") return { kind: "chosen", summary: {} };
      try {
        const focus = await this.readLine({
          prompt: "focus > ",
          placeholder: "the failing test, the approach that was dropped…",
        });
        return {
          kind: "chosen",
          summary: focus.trim() === "" ? {} : { customInstructions: focus.trim() },
        };
      } catch (cause) {
        if (!(cause instanceof PickerCancelled)) throw cause;
      }
    }
  }

  /** One line typed into the composer under its own prompt label. */
  private readLine(options: {
    readonly prompt: string;
    readonly placeholder: string;
  }): Promise<string> {
    this.shell.dismissInfoPanel?.();
    if (this.shell.ui.selecting) return Promise.reject(new Error("Another panel is already open"));
    return new Promise<string>((resolveLine, reject) => {
      const previousPrompt = this.shell.ui.prompt;
      const previousSubmit = this.shell.input.onSubmit;
      const previousPlaceholder = this.shell.input.placeholder;
      this.shell.input.placeholder = options.placeholder;
      this.shell.setUi({ prompt: options.prompt, prompting: true });
      let settled = false;
      const finish = (): void => {
        this.renderer.keyInput.off("keypress", onKeyPress);
        this.shell.input.placeholder = previousPlaceholder;
        this.shell.setUi({ prompt: previousPrompt, prompting: false });
        this.shell.input.onSubmit = previousSubmit;
        this.flushShellMarkers();
      };
      const onKeyPress = (key: KeyEvent): void => {
        if (settled || key.defaultPrevented || !matchesKey("auth.cancel", key, "required")) return;
        key.preventDefault();
        key.stopPropagation();
        settled = true;
        finish();
        reject(new PickerCancelled());
      };
      this.renderer.keyInput.on("keypress", onKeyPress);
      this.shell.input.onSubmit = () => {
        if (settled) return;
        settled = true;
        const text = this.shell.input.plainText;
        this.shell.input.clear();
        finish();
        resolveLine(text);
      };
      this.shell.input.focus();
    });
  }

  /**
   * The tree, the summary question, and the move, in pi's order. Landing on a
   * message you sent takes it back into the composer; any other commit becomes
   * the tip. A failed summary leaves the head where it was.
   *
   * Based on pi's `showTreeSelector` and `navigateTree`:
   * https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L5175
   */
  private async openTree(options: {
    readonly filter?: TreeFilter;
    readonly selectedOid?: Oid;
  }): Promise<void> {
    const session = this.requireSession();
    if (this.busy) throw new Error("Wait for the current run before changing the session branch");
    const commits = await this.host.sessionCommits(session.sessionId);
    if (commits.length === 0) {
      notice(this.shell, "No messages to branch from");
      return;
    }
    const tip = session.state.transcript.tip;
    const tree = projectTree(commits, { tip, heads: session.state.info.heads });
    let picked: Oid;
    try {
      picked = await this.selectTreeCommit({
        tree,
        selectedOid: options.selectedOid ?? tip,
        filter: options.filter ?? "default",
      });
    } catch (cause) {
      if (cause instanceof PickerCancelled) return;
      throw cause;
    }
    const byOid = new Map(commits.map((item) => [item.oid, item.commit]));
    const selected = byOid.get(picked);
    if (selected === undefined) throw new Error(`Commit not found: ${picked}`);
    if (picked === tip) {
      notice(this.shell, "Already at that point in the chat");
      return;
    }
    const takesBack = selected.body.kind === "message" && selected.body.message.role === "user";
    if (takesBack && this.shell.input.plainText.trim() !== "") {
      throw new Error("Clear the composer before editing a message");
    }
    const again = (): Promise<void> => this.openTree({ ...options, selectedOid: picked });
    let summary: { readonly customInstructions?: string } | undefined;
    if (collectAbandoned(byOid, { from: tip, selected: picked }).commits.length > 0) {
      const answer = await this.askSummary();
      if (answer.kind === "back") return again();
      summary = answer.summary;
    }
    if (this.compaction !== undefined)
      throw new Error("Wait for the current run before changing the session branch");
    const move = { sessionId: session.sessionId, to: picked, expect: tip };
    const outcome = await this.host.nyte.heads.move(
      summary === undefined ? move : { ...move, summary },
    );
    switch (outcome.kind) {
      case "moved":
        if (outcome.restored !== undefined) {
          this.stageHandback(session.sessionId, {
            content: outcome.restored.content,
            commit: outcome.restored.commit,
            notice: "Message moved back to the composer. Enter sends it again.",
          });
          return;
        }
        notice(this.shell, "Moved. The next message starts a branch here.", this.shell.theme.ok);
        this.focusComposer();
        return;
      case "busy":
        throw new Error("Wait for the current run");
      case "moved_since":
        throw new Error("The chat moved on while the tree was open; try again");
      case "not_found":
        throw new Error(`Commit not found: ${picked}`);
      case "failed":
        throw new Error(outcome.message);
      default: {
        const _exhaustive: never = outcome;
        return _exhaustive;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Menus
  // -------------------------------------------------------------------------

  private prefillComposer(text: string): void {
    setInputText(this.shell.input, `${text}${this.shell.input.plainText}`);
    this.shell.input.focus();
  }

  private async openCommandPalette(): Promise<void> {
    const session = this.requireSession();
    const commands = availableSlashCommands(
      session.commands,
      this.slashSettings(session),
      new Map(),
    );
    const restoreCompletion = this.autocomplete?.preserveSelection();
    const selectedName = await openActionPalette(
      this.shell,
      commands,
      () => {
        restoreCompletion?.();
        this.refreshHints();
      },
      () => this.refreshHints(),
    );
    const selected = commands.find((command) => command.name === selectedName);
    if (selected === undefined || selected.name === "help") return;
    if (selected.name === "cd") {
      this.prefillComposer("/cd ");
      return;
    }
    await this.runCommand({ name: selected.name, argument: "" });
  }

  /** Every setting, by the name `/name` reaches it under. */
  private slashSettings(session: FollowedSession): SlashSetting[] {
    return this.settingRows(session).map(({ id, label }) => ({ id, label }));
  }

  private settingRows(session: FollowedSession): readonly SettingRow[] {
    const pluginRows = session.settings.map((setting): SettingRow => ({
      id: setting.id,
      label: setting.label,
      current: () => setting.current,
      choices: () =>
        setting.choices.map((choice) =>
          choice.description === undefined
            ? { id: choice.id, label: choice.label }
            : { id: choice.id, label: choice.label, description: choice.description },
        ),
      apply: async (choiceId) => {
        const outcome = await this.host.nyte.plugins.settings.apply({
          sessionId: session.sessionId,
          id: setting.id,
          choiceId,
        });
        if (outcome.kind !== "applied") throw new Error(`Could not set ${setting.label}`);
        await this.refreshBadges();
      },
    }));
    return [
      {
        id: "model",
        label: "Model",
        current: () => modelChoiceId(this.config.model),
        choices: () =>
          modelChoices(this.runtime, cachedAuthenticatedModels(this.runtime.models) ?? []),
        load: async () =>
          modelChoices(
            this.runtime,
            await loadAuthenticatedModels(this.runtime.models, { force: true }),
          ),
        open: () => this.pickModel(),
        apply: (choiceId) => this.changeModelChoice(choiceId),
      },
      {
        id: "effort",
        label: "Thinking level",
        current: () => this.config.thinkingLevel,
        choices: () =>
          getSupportedThinkingLevels(this.config.model).map((level) => ({
            id: level,
            label: level,
          })),
        apply: async (choiceId) => {
          const level = getSupportedThinkingLevels(this.config.model).find(
            (candidate) => candidate === choiceId,
          );
          if (level === undefined) throw new Error(`Unsupported thinking level: ${choiceId}`);
          await this.changeThinkingLevel(level, true);
        },
      },
      {
        id: "theme",
        label: "Theme",
        current: () => this.settings.theme,
        choices: () => THEME_CHOICES,
        apply: (choiceId) => this.changeThemeChoice(choiceId),
      },
      {
        id: "follow-up",
        label: "Follow-up behavior",
        current: () => this.settings.followUp,
        choices: () => [
          {
            id: "steer",
            label: "steer",
            description: `Enter steers; ${keycap("chat.queue.submit")} queues`,
          },
          {
            id: "queue",
            label: "queue",
            description: `Enter queues; ${keycap("chat.queue.submit")} steers`,
          },
        ],
        apply: async (choiceId) => {
          if (choiceId !== "queue" && choiceId !== "steer")
            throw new Error(`Unknown follow-up behavior: ${choiceId}`);
          this.updateSettings({ followUp: choiceId });
        },
      },
      {
        id: "scroll-acceleration",
        label: "Scroll acceleration",
        current: () => (this.settings.scrollAcceleration ? "on" : "off"),
        choices: () => [
          { id: "off", label: "off", description: "Move three rows per wheel event" },
          { id: "on", label: "on", description: "Accelerate during rapid wheel scrolling" },
        ],
        apply: async (choiceId) => {
          this.shell.setScrollAcceleration(choiceId === "on");
          this.updateSettings({ scrollAcceleration: choiceId === "on" });
        },
      },
      {
        id: "copy-on-select",
        label: "Copy on select",
        current: () => (this.settings.copyOnSelect ? "on" : "off"),
        choices: () => [
          { id: "on", label: "on", description: "Copy text when the mouse selection ends" },
          { id: "off", label: "off", description: "Copy selected text with Ctrl+C or right-click" },
        ],
        apply: async (choiceId) => this.updateSettings({ copyOnSelect: choiceId === "on" }),
      },
      {
        id: "auto-update",
        label: "Auto-update",
        current: () => (this.settings.autoUpdate ? "on" : "off"),
        choices: () => [
          { id: "on", label: "on", description: "Install a newer release when nyte starts" },
          { id: "off", label: "off", description: "Only say when one exists; /update installs" },
        ],
        apply: async (choiceId) => this.updateSettings({ autoUpdate: choiceId === "on" }),
      },
      ...pluginRows,
    ];
  }

  /** `/<setting>` picks from the choices; `/<setting> <choice>` applies one. */
  private async applySetting(
    row: SettingRow,
    argument: string,
    cancelLabel: "back" | "close" = "close",
  ): Promise<void> {
    // Model and effort select inputs for the next message, not the active turn.
    if (this.busy && row.id !== "model" && row.id !== "effort")
      throw new Error(`Wait for the current run before changing ${row.label}`);
    if (argument === "") {
      if (row.open !== undefined) {
        await row.open();
        return;
      }
      const picker: SelectChoiceOptions = { selectedId: row.current(), cancelLabel };
      const chosen = await selectChoice(
        this.shell,
        row.label,
        row.choices(),
        row.load === undefined ? picker : { ...picker, load: row.load },
      );
      await row.apply(chosen);
      return;
    }
    const choice =
      matchChoice(row.choices(), argument) ??
      (row.load === undefined ? undefined : matchChoice(await row.load(), argument));
    if (choice === undefined) {
      throw new Error(
        `Unknown ${row.label}: ${argument}. Choices: ${row
          .choices()
          .map((candidate) => candidate.id)
          .join(", ")}`,
      );
    }
    await row.apply(choice.id);
  }

  private async openSkillPalette(): Promise<void> {
    const session = this.requireSession();
    const items = [...session.skills.values()]
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map((skill) => ({ id: skill.name, label: skill.name, description: skill.description }));
    if (items.length === 0) {
      notice(this.shell, "No skills found. Add SKILL.md to .nyte/skills.");
      return;
    }
    const selectedName = await selectChoice(this.shell, "Skills", items);
    this.prefillComposer(`/${selectedName} `);
  }

  private async pickModel(): Promise<void> {
    const session = this.requireSession();
    if (this.shell.ui.selecting) throw new Error("Another menu is already open");
    await new Promise<void>((resolveSelection, reject) => {
      const close = (): void => {
        closePanel(this.shell, picker);
        this.refreshHints();
      };
      const picker = new ModelPicker({
        kind: "session",
        renderer: this.renderer,
        theme: this.shell.theme,
        nextId: this.shell.nextId,
        models: cachedAuthenticatedModels(this.runtime.models) ?? [],
        current: this.config.model,
        thinkingLevel: this.config.thinkingLevel,
        fastModes: new Map(
          session.settings.map((setting) => [setting.id, setting.current === "on"]),
        ),
        load: () => loadAuthenticatedModels(this.runtime.models),
        onRows: (rows) => setSlotRows(this.shell, rows),
        onHints: (hints) => setHints(this.shell, hints),
        onError: this.reportError,
        onSelect: (picked) => {
          // Reserve before closing the panel lets another key submit a message.
          const applying = this.applyModelSelection(session, picked);
          close();
          resolveSelection(applying);
        },
        onCancel: () => {
          close();
          reject(new PickerCancelled());
        },
      });
      openPanel(this.shell, picker);
    });
  }

  private async applyModelSelection(
    session: FollowedSession,
    selection: ModelSelection,
  ): Promise<void> {
    let unchanged = false;
    const result = await session.config.prepareSelection((selected) => {
      const choice = {
        model: selection.model,
        thinkingLevel: clampThinkingLevel(selection.model, selection.thinkingLevel),
      };
      unchanged =
        selected.model.provider === choice.model.provider &&
        selected.model.id === choice.model.id &&
        selected.thinkingLevel === choice.thinkingLevel;
      const patch = unchanged ? undefined : choice;
      if (selection.fast !== undefined) {
        const { settingId, enabled } = selection.fast;
        const row = this.settingRows(session).find((setting) => setting.id === settingId);
        if (row !== undefined && row.current() !== (enabled ? "on" : "off")) {
          return row.apply(enabled ? "on" : "off").then(() => patch);
        }
      }
      return patch;
    });
    if (this.disposed || this.session !== session) return;
    if (result.kind === "failed") throw new Error(result.message);
    if (result.kind !== "acknowledged" && !unchanged) return;
    const fast =
      selection.fast === undefined ? "" : ` · Fast mode ${selection.fast.enabled ? "on" : "off"}`;
    notice(
      this.shell,
      `Model: ${modelChoiceId(selection.model)} · ${selection.thinkingLevel}${fast}`,
      this.shell.theme.ok,
    );
  }

  private async openSettings(): Promise<void> {
    let selectedId = "model";
    while (!this.disposed) {
      const rows = this.settingRows(this.requireSession());
      const chosen = await selectChoice(
        this.shell,
        "Settings",
        rows.map((row) => ({
          id: row.id,
          label: row.label,
          description: settingValue(row),
        })),
        { selectedId, selectLabel: "open" },
      );
      const row = rows.find((candidate) => candidate.id === chosen);
      if (row === undefined) throw new Error(`Unknown setting: ${chosen}`);
      selectedId = row.id;
      try {
        await this.applySetting(row, "", "back");
      } catch (cause) {
        this.reportError(cause);
      }
    }
  }

  private async changeModelChoice(choiceId: string): Promise<void> {
    const slash = choiceId.indexOf("/");
    const model = this.runtime.models.getModel(choiceId.slice(0, slash), choiceId.slice(slash + 1));
    if (model === undefined) throw new Error(`Model is no longer available: ${choiceId}`);
    await this.changeModel(model);
  }

  /** The login funnel over the shell: pickers for choices, the composer for keys and codes. */
  private authInteraction(signal: AbortSignal): AuthInteraction {
    return {
      signal,
      prompt: (prompt) => {
        const promptSignal =
          prompt.signal === undefined ? signal : AbortSignal.any([signal, prompt.signal]);
        switch (prompt.type) {
          case "select":
            return selectChoice(this.shell, prompt.message, prompt.options, {
              signal: promptSignal,
              selectedId: this.config.model.provider,
            });
          case "text":
          case "secret":
          case "manual_code":
            return readAuthPrompt(this.shell, prompt, promptSignal);
          default: {
            const _exhaustive: never = prompt;
            return _exhaustive;
          }
        }
      },
      notify: (event) => {
        if (signal.aborted || this.disposed) return;
        switch (event.type) {
          case "auth_url":
            this.authenticationLink = { url: event.url, copy: event.url };
            this.refreshHints();
            notice(this.shell, [event.instructions ?? "Open this URL to continue:", event.url]);
            void open(event.url).catch(() => undefined);
            return;
          case "device_code":
            this.authenticationLink = { url: event.verificationUri, copy: event.userCode };
            this.refreshHints();
            notice(this.shell, [
              ...(event.instructions === undefined ? [] : [event.instructions]),
              `Visit ${event.verificationUri} and enter the code ${event.userCode}`,
            ]);
            return;
          case "info":
          case "progress":
            this.authenticationLink = undefined;
            this.refreshHints();
            notice(this.shell, event.message);
            return;
          default: {
            const _exhaustive: never = event;
            throw new Error(_exhaustive);
          }
        }
      },
    };
  }

  /** Credential changes and their model recovery belong to the session that started them. */
  private async authenticate(action: "login" | "logout", argument: string): Promise<void> {
    if (this.authenticating !== undefined)
      throw new Error("An authentication command is already running.");
    const session = this.requireSession();
    const controller = new AbortController();
    this.authenticating = controller;
    this.refreshHints();
    const signal = AbortSignal.any([controller.signal, this.stopped.signal]);
    const models = this.runtime.models;
    const current = this.config.model;
    const interaction = this.authInteraction(signal);
    try {
      const wasSignedOut =
        action === "login" && (await models.checkAuth(current.provider, { signal })) === undefined;
      const input = { models, interaction, providerId: argument === "" ? undefined : argument };
      const result =
        action === "login"
          ? await loginProvider(input).then((provider) => ({
              provider,
              message: `Signed in to ${provider.name}.`,
            }))
          : await logoutProvider(input);
      if (this.disposed || this.session !== session) return;
      notice(this.shell, result.message, this.shell.theme.ok);
      try {
        // Discovery is separate from credential persistence and never runs on logout.
        if (action === "login") {
          const refreshed = await models.refresh({
            providers: [result.provider.id],
            force: true,
            signal,
          });
          for (const error of refreshed.errors.values())
            notice(
              this.shell,
              `Signed in, but model discovery failed: ${error.message}. Use /model to retry.`,
              this.shell.theme.warning,
            );
        }
        const available = await loadAuthenticatedModels(models, {
          force: true,
          allowNetwork: false,
          signal,
        });
        if (signal.aborted || this.disposed || this.session !== session) return;
        if (this.config.model.provider !== current.provider || this.config.model.id !== current.id)
          return;
        if (
          action === "login"
            ? !wasSignedOut
            : (await models.checkAuth(current.provider, { signal })) !== undefined
        )
          return;
        if (action === "logout" && result.provider.id !== current.provider) return;
        const candidates =
          action === "login"
            ? available.filter((model) => model.provider === result.provider.id)
            : available;
        const first = candidates[0];
        if (first === undefined) {
          notice(
            this.shell,
            [
              result.message,
              available.length === 0
                ? "No authenticated models available. /login connects a provider; /model refreshes the catalog."
                : "No models available for this provider. /model selects another.",
            ],
            this.shell.theme.warning,
          );
          return;
        }
        const selected = defaultModel(candidates, first.provider);
        await this.changeModel(selected);
        notice(
          this.shell,
          [result.message, `Model: ${modelChoiceId(selected)}`],
          this.shell.theme.ok,
        );
      } catch (cause) {
        if (signal.aborted) return;
        notice(
          this.shell,
          [
            result.message,
            `Model selection could not refresh: ${errorMessage(cause)}. Use /model to retry.`,
          ],
          this.shell.theme.warning,
        );
      }
    } catch (cause) {
      if (signal.aborted && !this.disposed) {
        notice(this.shell, "Authentication cancelled.");
        return;
      }
      throw cause;
    } finally {
      controller.abort();
      if (this.authenticating === controller) {
        this.authenticating = undefined;
        this.authenticationLink = undefined;
      }
      if (!this.disposed) {
        this.refreshHints();
        if (this.session !== undefined && this.waiting !== undefined)
          this.askQuestion(this.session, this.waiting);
      }
    }
  }

  /** Read once, then display the complete report in the composer panel. */
  private async openUsage(): Promise<void> {
    const session = this.requireSession();
    if (this.disposed || this.shell.ui.selecting || this.shell.ui.prompting) return;
    const controller = new AbortController();
    const close = (): void => {
      controller.abort();
      if (this.shell.dismissInfoPanel !== close) return;
      this.shell.dismissInfoPanel = undefined;
      if (panel.container.isDestroyed) return;
      closePanel(this.shell, panel);
      this.refreshHints();
    };
    const panel = openPanel(
      this.shell,
      new UsagePanel(this.shell, close, (rows) => setSlotRows(this.shell, rows)),
    );
    this.shell.dismissInfoPanel = close;
    const active = (): boolean =>
      this.session === session &&
      !this.disposed &&
      !controller.signal.aborted &&
      this.shell.dismissInfoPanel === close;
    try {
      const accountSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
      const [report, local, accounts] = await Promise.all([
        this.host.workspaceUsage(session.sessionId),
        readLocalUsage({
          models: this.runtime.models,
          signal: controller.signal,
          caches: this.usageCaches,
        }),
        Promise.all([
          readAccountUsage({
            models: this.runtime.models,
            provider: "anthropic",
            signal: accountSignal,
          }),
          readAccountUsage({
            models: this.runtime.models,
            provider: "openai-codex",
            signal: accountSignal,
          }),
        ]),
      ]);
      if (active()) panel.update({ kind: "ready", card: usageCard(report, local, accounts) });
    } catch (cause) {
      if (active()) panel.update({ kind: "failed", message: errorMessage(cause) });
    } finally {
      controller.abort();
    }
  }

  // -------------------------------------------------------------------------
  // Slash commands
  // -------------------------------------------------------------------------

  /** First claim wins, in the namespace's order: built-in, setting, plugin command, skill. */
  private resolveTarget(session: FollowedSession, name: string): SlashTarget {
    const command = resolveSlashCommand(name);
    if (command !== undefined) return { kind: "builtin", name: command.name };
    const row = this.settingRows(session).find((candidate) => candidate.id === name);
    if (row !== undefined) return { kind: "setting", row };
    if (session.commands.has(name)) return { kind: "plugin" };
    const skill = session.skills.get(name);
    return skill === undefined ? { kind: "message" } : { kind: "skill", skill };
  }

  private async runCommand(
    parsed: ParsedSlashCommand,
    options: { readonly lane?: string; readonly target?: SlashTarget } = {},
  ): Promise<void> {
    const session = this.requireSession();
    if (this.changingDirectory || this.switchingSession)
      throw new Error("Wait for the workspace switch to finish.");
    if (this.authenticating !== undefined)
      throw new Error("Finish signing in or out first. Esc cancels.");
    const lane = options.lane ?? this.roles.steer;
    const target = options.target ?? this.resolveTarget(session, parsed.name);
    const asMessage = (): Promise<void> =>
      this.send(
        session,
        `/${parsed.name}${parsed.argument === "" ? "" : ` ${parsed.argument}`}`,
        lane,
      );
    switch (target.kind) {
      case "plugin": {
        const outcome = await this.host.nyte.plugins.commands.run({
          sessionId: session.sessionId,
          name: parsed.name,
          argument: parsed.argument,
        });
        void this.refreshBadges();
        switch (outcome.kind) {
          case "ran":
            if (outcome.output !== undefined) notice(this.shell, outcome.output);
            return;
          case "prompt":
            await this.send(session, outcome.prompt, lane);
            return;
          case "not_found":
            await asMessage();
            return;
          case "failed":
            throw new Error(outcome.message);
          default: {
            const _exhaustive: never = outcome;
            return _exhaustive;
          }
        }
      }
      case "setting":
        await this.applySetting(target.row, parsed.argument);
        return;
      case "skill": {
        await this.send(
          session,
          formatSkillInvocation(target.skill, parsed.argument === "" ? undefined : parsed.argument),
          lane,
        );
        return;
      }
      case "message":
        await asMessage();
        return;
      case "builtin":
        await this.runBuiltin(target.name, parsed.argument);
        return;
      default: {
        const _exhaustive: never = target;
        return _exhaustive;
      }
    }
  }

  private async runBuiltin(name: BuiltinSlashName, argument: string): Promise<void> {
    const session = this.requireSession();
    const noArgument = (): void => {
      if (argument !== "") throw new Error(`/${name} takes no argument`);
    };
    const whenIdle = (what: string): void => {
      if (this.busy) throw new Error(`Wait for the current run before ${what}`);
    };
    switch (name) {
      case "help":
        await this.openCommandPalette();
        return;
      case "quit":
        noArgument();
        this.options.requestShutdown();
        return;
      case "resume":
        noArgument();
        await this.resumeSession();
        return;
      case "new": {
        noArgument();
        const info = await this.host.nyte.sessions.create();
        if (this.workspace.cwd !== this.host.cwd)
          await this.relocateSession(info.sessionId, this.workspace);
        await this.switchSession(info, false);
        return;
      }
      case "cd":
        whenIdle("changing directories");
        await this.changeDirectory(argument);
        return;
      case "settings":
        noArgument();
        await this.openSettings();
        return;
      case "login":
      case "logout":
        await this.authenticate(name, argument);
        return;
      case "compact": {
        whenIdle("compacting");
        const controller = new AbortController();
        this.compaction = controller;
        this.refreshHints();
        try {
          const request = { sessionId: session.sessionId, signal: controller.signal };
          const outcome = await this.host.nyte.runs.compact(
            argument === "" ? request : { ...request, customInstructions: argument },
          );
          if (this.disposed || this.session !== session) return;
          switch (outcome.kind) {
            case "compacted":
              return;
            case "nothing_to_compact":
              notice(this.shell, "Nothing to compact");
              return;
            case "aborted":
              notice(this.shell, "Compaction cancelled");
              return;
            case "busy":
              throw new Error("Wait for the current run before compacting");
            case "failed":
              throw new Error(outcome.message);
            default: {
              const _exhaustive: never = outcome;
              return _exhaustive;
            }
          }
        } finally {
          if (this.compaction === controller) {
            this.compaction = undefined;
            if (!this.disposed && this.session === session) this.refreshHints();
          }
        }
      }
      case "usage":
        noArgument();
        await this.openUsage();
        return;
      case "tasks":
        noArgument();
        this.tasks.open();
        return;
      case "tree":
        noArgument();
        await this.openTree({});
        return;
      case "edit":
        noArgument();
        await this.openTree({ filter: "users" });
        return;
      case "plugins": {
        noArgument();
        const panel = openDiagnosticReport(this.shell, "Plugins", ["Loading plugins…"], () =>
          this.refreshHints(),
        );
        if (panel === undefined) return;
        try {
          const plugins = await this.host.nyte.plugins.list({ sessionId: session.sessionId });
          if (this.disposed || this.session !== session) return;
          const lines = plugins.map((plugin) => {
            const where =
              plugin.path === undefined ? plugin.source : `${plugin.source} ${plugin.path}`;
            return plugin.status === "failed"
              ? `${plugin.id} ${where} failed: ${plugin.error}`
              : `${plugin.id} ${where}`;
          });
          lines.unshift(
            ...this.tuiPlugins.registered().map((plugin) => `${plugin.id} TUI ${plugin.target}`),
          );
          const commands = [...session.commands.keys()];
          if (commands.length > 0)
            lines.push(`Commands: ${commands.map((command) => `/${command}`).join(" ")}`);
          panel.update(lines.length === 0 ? ["No plugins"] : lines);
        } catch (cause) {
          if (!this.disposed && this.session === session)
            panel.update([`Failed to list plugins: ${errorMessage(cause)}`]);
        }
        return;
      }
      case "reload": {
        noArgument();
        whenIdle("reloading");
        await this.reloadPlugins();
        // Plugin renderables mark themselves dirty during reconciliation.
        this.renderer.requestRender();
        const pluginCount = (await this.host.nyte.plugins.list({ sessionId: session.sessionId }))
          .length;
        notice(
          this.shell,
          `Reloaded ${String(pluginCount)} ${pluginCount === 1 ? "plugin" : "plugins"} and ${String(session.skills.size)} ${session.skills.size === 1 ? "skill" : "skills"}`,
          this.shell.theme.ok,
        );
        return;
      }
      case "update": {
        const report = (event: UpdateProgress): void => {
          if (event.kind === "downloading") notice(this.shell, `Downloading ${event.asset}…`);
          else if (event.kind === "verified") notice(this.shell, "Checksum verified.");
        };
        const outcome = await selfUpdate(
          argument === "" ? { report } : { version: argument, report },
        );
        const severity = updateSeverity(outcome);
        notice(
          this.shell,
          describeUpdateOutcome(outcome),
          severity === "ok"
            ? undefined
            : severity === "warn"
              ? this.shell.theme.warning
              : this.shell.theme.error,
        );
        return;
      }
      case "skills":
        noArgument();
        await this.openSkillPalette();
        return;
      default: {
        const _exhaustive: never = name;
        return _exhaustive;
      }
    }
  }

  private readonly reportError = (cause: unknown): void => {
    if (cause instanceof PickerCancelled || this.disposed) return;
    notice(this.shell, `error: ${errorMessage(cause)}`, this.shell.theme.error);
  };
}

type SlashTarget =
  | { readonly kind: "builtin"; readonly name: BuiltinSlashName }
  | { readonly kind: "setting"; readonly row: SettingRow }
  | { readonly kind: "plugin" }
  | { readonly kind: "skill"; readonly skill: Skill }
  | { readonly kind: "message" };

function rowId(row: ReturnType<typeof gutterRows>[number]): string {
  return row.kind === "pending" ? `pending:${row.item.change}` : `sending:${row.entry.key}`;
}

/** The fold's pending items, then receipts the fold has not caught up with, then what is still sending. */
function sessionRows(session: FollowedSession): ReturnType<typeof gutterRows> {
  return session.sent.rows(session.state.pending, session.outbox.entries);
}
