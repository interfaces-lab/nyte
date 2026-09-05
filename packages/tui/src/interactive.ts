/**
 * The interactive shell: one host, one followed session, one composer. Every
 * durable fact on screen comes from `SessionState`; every submission goes
 * through the outbox; every command is an SDK verb.
 */
import process from "node:process";
import { basename } from "node:path";
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
import { clampThinkingLevel, getSupportedThinkingLevels } from "@nyte-ai/ai";
import type { Api, AuthInteraction, Model, Provider } from "@nyte-ai/ai";
import {
  collectAbandoned,
  DEFAULT_LANDING,
  MAIN,
  projectTree,
  sessionId,
  watchPluginDirectories,
} from "@nyte-ai/core";
import type {
  CommandInfo,
  Oid,
  RunInfo,
  SessionEvent,
  SessionId,
  SessionInfo,
  SettingInfo,
  ThinkingLevel,
  TrustedWorkspace,
} from "@nyte-ai/core";
import type { JsonValue, Skill } from "@nyte-ai/schema";
import {
  cachedAuthenticatedModels,
  defaultModel,
  loadAuthenticatedModels,
  providerAuthStatuses,
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
import {
  ANSWER_COMPOSER_PLACEHOLDER,
  answerHints,
  BUSY_COMPOSER_PLACEHOLDER,
  busyHints,
  COMPOSER_PLACEHOLDER,
  CTRL_C_EXIT_HINT,
  IDLE_HINTS,
  keycap,
} from "./constants.ts";
import { editInExternalEditor, resolveExternalEditor } from "./external-editor.ts";
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
import { isJsonArray, isJsonObject, isJsonString } from "./json.ts";
import {
  ctrlCAction,
  DoubleEscape,
  escapeIntent,
  isComposerTextKey,
  nextThinkingLevel,
  registerChatLayer,
  registerSelectionLayer,
} from "./keymap.ts";
import type { ChatCommandSpec } from "./keymap.ts";
import { laneRoles, nextToSteer } from "./lanes.ts";
import type { LaneRoles } from "./lanes.ts";
import { Outbox } from "./outbox.ts";
import { ModelPicker } from "./model-picker.ts";
import type { ModelSelection } from "./model-picker.ts";
import { gutterRows, laneMark, queuedPromptText } from "./pending-gutter.ts";
import { PickerCancelled } from "./picker.ts";
import type { Choice, InlineMenu } from "./picker.ts";
import {
  PluginProvider,
  pluginDirectories,
  resolveWorkspacePlugins,
  skillDirectories,
} from "./plugins.ts";
import { browseHistory, PromptHistory } from "./prompt-history.ts";
import {
  hostFallbacks,
  openWorkspaceHost,
  resolveRuntime,
  signedOutRuntime,
  targetSession,
} from "./run.ts";
import type { Runtime } from "./run.ts";
import { SessionFollower } from "./session-follow.ts";
import { TaskBrowser } from "./task-browser.ts";
import type { SessionState, WaitingCall } from "./session-state.ts";
import { FileSettingsStore } from "./settings.ts";
import type { ResolvedSettings, SettingsPatch } from "./settings.ts";
import {
  applyShellTheme,
  buildShell,
  closePanel,
  notice,
  openInlineMenu,
  openPanel,
  selectChoice,
  setHints,
  setInputText,
} from "./shell.ts";
import type { ComposerStatus, SelectChoiceOptions, Shell } from "./shell.ts";
import {
  availableSlashCommands,
  expandInlineSkills,
  hasInlineSkills,
  parseComposerSubmission,
  resolveSlashCommand,
  slashCommandLabel,
} from "./slash.ts";
import type { BuiltinSlashName, ParsedSlashCommand, SlashSetting } from "./slash.ts";
import { SlashAutocomplete } from "./slash-autocomplete.ts";
import { registerSyntaxParsers } from "./syntax-parsers.ts";
import { isThemeChoice, resolveThemeMode, themeForMode } from "./theme.ts";
import type { ThemeMode } from "./theme.ts";
import { TreeSelector } from "./tree-selector.ts";
import type { TreeFilter } from "./tree-selector.ts";
import { describeUpdateOutcome, selfUpdate } from "./update.ts";
import type { UpdateProgress } from "./update.ts";
import { updateSeverity } from "./cli-style.ts";
import { fetchAccountLimits, hasHeadroom, usageCard, usageLines } from "./usage.ts";
import { checkForUpdate } from "./version.ts";
import { cellIndex, displayWidth } from "./width.ts";
import { readWorkspaceStatus } from "./workspace.ts";
import { createWorkspaceTrustStore, requestWorkspaceTrust } from "./workspace-trust.ts";

export type TuiExit =
  | { readonly kind: "quit" }
  | { readonly kind: "signal"; readonly signal: "SIGINT" | "SIGTERM" };

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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

interface QuestionAsk {
  readonly question: string;
  /** The options as menu rows; ids are the 1-based numbers the question tool accepts as replies. */
  readonly choices: readonly Choice[];
}

/** The question tool's args, if this waiting call carries one. */
function questionAsk(args: JsonValue): QuestionAsk | undefined {
  if (!isJsonObject(args)) return undefined;
  const question = args["question"];
  if (!isJsonString(question)) return undefined;
  const rawOptions = args["options"];
  const choices: Choice[] = [];
  if (isJsonArray(rawOptions)) {
    for (const option of rawOptions) {
      if (!isJsonObject(option)) continue;
      const label = option["label"];
      if (!isJsonString(label)) continue;
      const id = String(choices.length + 1);
      const description = option["description"];
      choices.push(isJsonString(description) ? { id, label, description } : { id, label });
    }
  }
  return { question, choices };
}

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

/** What the next run would use: a model and a thinking level. */
interface RunChoice {
  readonly model: Model<Api>;
  readonly thinkingLevel: ThinkingLevel;
}

/** Resolve core's projected model in the catalog for client controls. */
function effectiveConfig(state: SessionState, runtime: Runtime, fallback: RunChoice): RunChoice {
  return {
    model:
      state.config.model?.provider === undefined
        ? fallback.model
        : (runtime.models.getModel(state.config.model.provider, state.config.model.id) ??
          fallback.model),
    thinkingLevel: state.config.thinkingLevel ?? fallback.thinkingLevel,
  };
}

function userPrompts(state: SessionState): string[] {
  return state.transcript.items.flatMap((item) =>
    item.kind === "turn"
      ? item.parts.flatMap((part) => {
          if (part.kind !== "user") return [];
          const text = userText(part.content);
          return text.trim() === "" ? [] : [text];
        })
      : [],
  );
}

/** The last user message of the branch, when nothing answered it. */
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

export function createTuiRenderer(): Promise<CliRenderer> {
  // Grammars are registered before the first renderer so the tree-sitter
  // worker knows them the moment it starts.
  registerSyntaxParsers();
  return createCliRenderer({
    exitOnCtrlC: false,
    autoFocus: false,
    enableMouseMovement: true,
    clearOnShutdown: true,
    targetFps: 60,
  });
}

/**
 * Everything the shell knows about the followed session, rebuilt on a switch.
 * The follower publishes state; the outbox publishes what is still sending.
 */
interface FollowedSession {
  readonly sessionId: SessionId;
  readonly follower: SessionFollower;
  readonly outbox: Outbox;
  state: SessionState;
  commands: ReadonlyMap<string, CommandInfo>;
  skills: ReadonlyMap<string, Skill>;
  settings: readonly SettingInfo[];
  /** The plugin status items, as last listed or as `status_changed` said. */
  statusItems: readonly string[];
  stop(): void;
}

export async function runTui(flags: RunFlags, suppliedRenderer?: CliRenderer): Promise<TuiExit> {
  const renderer = suppliedRenderer ?? (await createTuiRenderer());
  const roles = laneRoles(DEFAULT_LANDING);
  const shell = buildShell(
    renderer,
    themeForMode(resolveThemeMode("auto", renderer.themeMode)),
    roles,
    (path) => {
      void open(path).catch(() => undefined);
    },
  );
  shell.status.patch({ workspace: basename(process.cwd()) });
  shell.loading.content = "Checking workspace…";
  shell.loading.visible = true;
  shell.input.onSubmit = () => notice(shell, "Still starting. Your draft is saved here.");
  let exit: TuiExit = { kind: "quit" };
  const startupAbort = new AbortController();
  const destroyed = new Promise<void>((resolve) => {
    renderer.once("destroy", () => {
      startupAbort.abort();
      process.nextTick(resolve);
    });
  });
  const requestShutdown = (requested: TuiExit = { kind: "quit" }): void => {
    if (requested.kind === "signal") exit = requested;
    app?.dispose();
    renderer.destroy();
  };
  const onSigint = (): void => requestShutdown({ kind: "signal", signal: "SIGINT" });
  const onSigterm = (): void => requestShutdown({ kind: "signal", signal: "SIGTERM" });
  const onStartupKey = (key: KeyEvent): void => {
    if (
      ctrlCAction(key, { selecting: shell.selecting, prompting: false, hasDraft: false }) ===
      undefined
    )
      return;
    key.preventDefault();
    key.stopPropagation();
    requestShutdown({ kind: "signal", signal: "SIGINT" });
  };
  const clearNotice = (): void => {
    if (!shell.root.isDestroyed) shell.ephemeral.release("notice");
  };
  const onStartupTheme = (): void => {
    applyShellTheme(shell, themeForMode(resolveThemeMode("auto", renderer.themeMode)));
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  renderer.keyInput.on("keypress", onStartupKey);
  renderer.keyInput.on("keypress", clearNotice);
  renderer.on(CliRenderEvents.THEME_MODE, onStartupTheme);
  let host: Host | undefined;
  let app: Interactive | undefined;
  const disposers: (() => void)[] = [];
  const boot = async (): Promise<void> => {
    const trustStore = createWorkspaceTrustStore();
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
    shell.loading.content = "Loading settings…";
    const settingsStore = new FileSettingsStore();
    const settings = await settingsStore.read(workspace.cwd);
    if (startupAbort.signal.aborted) return;
    renderer.off(CliRenderEvents.THEME_MODE, onStartupTheme);
    const updateTheme = (): void => {
      applyShellTheme(shell, themeForMode(resolveThemeMode(settings.theme, renderer.themeMode)));
    };
    updateTheme();
    renderer.on(CliRenderEvents.THEME_MODE, updateTheme);
    disposers.push(() => renderer.off(CliRenderEvents.THEME_MODE, updateTheme));
    shell.loading.content = "Loading providers…";
    const bootNotices: string[] = [];
    const signedIn = await resolveRuntime(flags, settings);
    if (startupAbort.signal.aborted) return;
    const runtime = signedIn ?? (await signedOutRuntime(flags, settings));
    if (startupAbort.signal.aborted) return;
    if (signedIn === undefined) bootNotices.push("Not signed in. /login connects a provider.");
    const fallback = hostFallbacks(runtime, settings, flags);
    shell.status.patch({
      provider: fallback.model.provider,
      model: fallback.model.id,
      effort: fallback.thinkingLevel,
    });
    shell.loading.content = "Loading workspace plugins…";
    const opened = await openWorkspaceHost({
      workspace,
      settings,
      runtime,
      model: fallback.model,
      thinkingLevel: fallback.thinkingLevel,
      report: (message) => bootNotices.push(message),
    });
    // A plugin can finish loading after the user has already left the terminal.
    if (startupAbort.signal.aborted) {
      await opened.close();
      return;
    }
    host = opened;
    disposers.push(host.attach());
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
  try {
    await Promise.race([boot(), destroyed]);
    await destroyed;
    return exit;
  } finally {
    startupAbort.abort();
    const resumeId = app?.sessionId;
    app?.dispose();
    for (const dispose of disposers.splice(0).toReversed()) {
      try {
        dispose();
      } catch {}
    }
    renderer.off(CliRenderEvents.THEME_MODE, onStartupTheme);
    renderer.keyInput.off("keypress", onStartupKey);
    renderer.keyInput.off("keypress", clearNotice);
    renderer.destroy();
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    await host?.close();
    if (resumeId !== undefined && suppliedRenderer === undefined) {
      process.stdout.write(`Return to this session: nyte --resume ${resumeId}\n`);
    }
  }
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

export class Interactive {
  private readonly tasks: TaskBrowser;
  private readonly tuiPlugins: PluginProvider;
  private readonly renderer: CliRenderer;
  private readonly shell: Shell;
  private readonly host: Host;
  private readonly runtime: Runtime;
  private readonly roles: LaneRoles;
  private readonly settingsStore: FileSettingsStore;
  private readonly workspace: TrustedWorkspace;
  private readonly fallback: RunChoice;
  private readonly options: InteractiveOptions;
  private settings: ResolvedSettings;
  private themeMode: ThemeMode;
  private session: FollowedSession | undefined;
  private readonly status: ComposerStatus;
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
  private readonly promptHistory = new PromptHistory();
  private readonly doubleEscape = new DoubleEscape();
  private autocomplete: SlashAutocomplete | undefined;
  private mentionFiles: readonly MentionFile[] = [];
  private mentionGeneration = 0;
  private readonly disposers: (() => void)[] = [];
  private submitting = false;
  /** The open question menu, so a wait that ends elsewhere can close it. */
  private asking: AbortController | undefined;
  private compaction: AbortController | undefined;
  private cyclingThinking = false;
  private cyclingModel = false;
  private editingExternally = false;
  private switchingSession = false;
  private lastPluginSignature: string | undefined;
  private disposed = false;

  constructor(options: InteractiveOptions) {
    this.options = options;
    this.renderer = options.renderer;
    this.shell = options.shell;
    this.status = options.shell.status;
    this.host = options.host;
    this.runtime = options.runtime;
    this.roles = options.roles;
    this.settingsStore = options.settingsStore;
    this.workspace = options.workspace;
    this.fallback = options.fallback;
    this.settings = options.settings;
    this.themeMode = options.themeMode;
    this.clipboard =
      options.clipboard === undefined
        ? createTuiClipboard(options.renderer)
        : createClipboardAdapter(options.clipboard);
    this.attachmentPreview = new DialogImagePreview(options.renderer, options.shell.theme);
    options.shell.live.insertBefore(
      this.attachmentPreview.container,
      options.shell.ephemeral.container,
    );
    this.disposers.push(() => {
      this.attachmentPreview.close();
      void this.clipboard.dispose().catch(this.reportError);
    });
    this.tasks = new TaskBrowser({
      shell: options.shell,
      nyte: options.host.nyte,
      onClose: () => this.refreshHints(),
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
        options.shell.selecting ||
        this.queueEdits.has(session.sessionId)
      )
        return;
      void this.reorder(session, item.change, item.lane, before?.change ?? null).catch(
        this.reportError,
      );
    };
  }

  get sessionId(): SessionId | undefined {
    return this.session?.sessionId;
  }

  async start(flags: RunFlags): Promise<void> {
    const { shell, renderer } = this;
    shell.loading.content = "Loading session…";
    shell.loading.visible = true;
    this.status.patch(this.initialStatus());
    this.refreshWorkspace();
    this.wireComposer();
    this.wireKeymap();
    // The terminal switched scheme; follow it unless a mode is pinned.
    const onTerminalTheme = (mode: ThemeMode): void => {
      if (this.settings.theme === "auto" && mode !== this.themeMode) {
        void this.changeTheme(mode).catch(this.reportError);
      }
    };
    renderer.on(CliRenderEvents.THEME_MODE, onTerminalTheme);
    this.disposers.push(() => renderer.off(CliRenderEvents.THEME_MODE, onTerminalTheme));
    const info = await targetSession(this.host.nyte, flags.resume);
    if (this.disposed) return;
    await this.follow(info);
    if (this.disposed) return;
    void this.tuiPlugins.reconcile().catch(this.reportError);
    this.disposers.push(
      watchPluginDirectories({
        directories: [
          ...pluginDirectories(this.host.cwd),
          ...skillDirectories(this.host.cwd).map((path) => ({ path })),
        ],
        onChange: () => this.reloadPlugins(),
        onError: (error) =>
          notice(shell, `plugin reload failed: ${error.message}`, shell.theme.error),
      }),
    );
    void loadAuthenticatedModels(this.runtime.models).catch(() => undefined);
    void this.refreshMentionFiles();
    void this.checkUpdate();
    renderer.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tasks.dispose();
    void this.tuiPlugins.dispose().catch(this.reportError);
    this.closeQueue();
    this.compaction?.abort();
    this.session?.stop();
    this.session = undefined;
    for (const dispose of this.disposers.splice(0).toReversed()) {
      try {
        dispose();
      } catch {}
    }
    this.autocomplete?.destroy();
    this.renderer.setTerminalTitle(TERMINAL_TITLE_BASE);
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
      (this.state?.run !== undefined &&
        !["done", "aborted", "failed"].includes(this.state.run.phase.kind))
    );
  }

  private get config(): RunChoice {
    const state = this.state;
    return state === undefined
      ? this.fallback
      : effectiveConfig(state, this.runtime, this.fallback);
  }

  /** Point the shell at a session: stop following the old one, snapshot the new one. */
  private async follow(info: SessionInfo): Promise<void> {
    const { shell } = this;
    this.tasks.close();
    this.closeQueue();
    this.compaction?.abort();
    this.compaction = undefined;
    const switching = this.session !== undefined;
    this.session?.stop();
    this.session = undefined;
    shell.view.clear();
    shell.loading.content = "Loading session…";
    shell.loading.visible = true;
    if (switching) this.restoreDraft(info.sessionId);
    let current: FollowedSession | undefined;
    const outbox = new Outbox({
      send: (input) => this.host.nyte.messages.send({ sessionId: info.sessionId, ...input }),
      onChange: () => {
        if (current !== undefined && this.session === current) this.syncGutter(current.state);
      },
    });
    const follower = new SessionFollower(this.host.nyte, {
      sessionId: info.sessionId,
      head: MAIN,
      onUpdate: ({ state, event }) => {
        if (current === undefined || this.session !== current) return;
        const previous = current.state;
        current.state = state;
        this.render(current, previous, event);
      },
      onError: (error) => {
        if (this.session === current)
          notice(shell, `Session watch failed: ${error.message}`, shell.theme.error);
      },
      retryMs: 500,
    });
    const followed: FollowedSession = {
      sessionId: info.sessionId,
      follower,
      outbox,
      state: {
        sessionId: info.sessionId,
        head: MAIN,
        seq: 0,
        info,
        config: info.config,
        transcript: { items: [], tip: null },
        pending: [],
        run: undefined,
        overlay: [],
        waiting: undefined,
        context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 0 },
        expectedTip: undefined,
      },
      commands: new Map(),
      skills: new Map(),
      settings: [],
      statusItems: [],
      stop: () => follower.close(),
    };
    current = followed;
    this.session = followed;
    followed.state = await follower.start();
    if (this.session !== followed) return;
    this.promptHistory.replace(userPrompts(followed.state));
    this.tuiPlugins.refresh();
    this.render(followed, undefined, undefined);
    this.renderer.setTerminalTitle(terminalTitle(followed.state.info.name));
    await this.refreshContributions(followed);
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
    const badges = listed.flatMap((setting) => {
      const status = setting.choices.find((choice) => choice.id === setting.current)?.status;
      return status === undefined ? [] : [status];
    });
    this.status.patch({ statuses: [...badges, ...session.statusItems] });
  }

  /** Draw one published state, and react to the event that produced it. */
  private render(
    session: FollowedSession,
    previous: SessionState | undefined,
    event: SessionEvent | undefined,
  ): void {
    const { shell } = this;
    const { state } = session;
    // A snapshot can rewind within a turn while retaining its ID. Rebuild its
    // blocks so later assistant steps and tool results disappear as well.
    shell.loading.visible = false;
    shell.view.sync(state, { reset: event === undefined });
    this.tasks.update(state, event);
    this.syncGutter(state);
    if (state.config !== previous?.config) this.refreshStatus(state);
    const running =
      state.run !== undefined && !["done", "aborted", "failed"].includes(state.run.phase.kind);
    shell.input.placeholder =
      state.waiting !== undefined
        ? ANSWER_COMPOSER_PLACEHOLDER
        : running
          ? BUSY_COMPOSER_PLACEHOLDER
          : COMPOSER_PLACEHOLDER;
    if (!shell.selecting && !shell.prompting) this.refreshHints();
    if (state.info.name !== previous?.info.name) {
      this.renderer.setTerminalTitle(terminalTitle(state.info.name));
    }
    // A newly parked call asks its question, whether the effect event brought
    // it or a snapshot did: a session resumed mid-wait still has to be answered.
    // A wait that ends any other way takes its menu down with it.
    const parked = state.waiting;
    if (previous?.waiting?.callId !== parked?.callId) {
      this.asking?.abort();
      if (parked !== undefined) this.askQuestion(session, parked);
    }
    if (event === undefined) return;
    this.tuiPlugins.emit(event);
    switch (event.kind) {
      case "run":
        if (event.head !== state.head) return;
        if (
          ["done", "aborted", "failed"].includes(event.run.phase.kind) &&
          previous?.run !== undefined &&
          !["done", "aborted", "failed"].includes(previous.run.phase.kind)
        ) {
          this.onRunEnded(session, event.run);
        }
        if (event.run.phase.kind === "retry") {
          notice(
            shell,
            `${retryCause(event.run.phase.error)} Retrying in ${clockDuration(Math.max(0, event.run.phase.at - Date.now()))} (attempt ${String(event.run.attempts)})`,
            shell.theme.warning,
          );
        }
        return;
      case "effect":
        return;
      case "commit":
        if (event.head !== state.head) return;
        if (event.item.commit.body.kind === "message") {
          if (event.item.commit.body.message.role === "assistant") this.refreshUsage(session);
          if (event.item.commit.body.message.role === "user") {
            this.promptHistory.replace(userPrompts(state));
          }
        }
        return;
      case "plugins_changed": {
        void this.refreshContributions(session).catch(() => undefined);
        void this.refreshBadges();
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
            shell,
            failed.map((plugin) => `plugin ${plugin.id} failed: ${plugin.error}`),
            shell.theme.error,
          );
        }
        return;
      }
      case "diagnostic":
        notice(
          shell,
          `${event.owner}: ${event.message}`,
          event.level === "error" ? shell.theme.error : undefined,
        );
        return;
      case "deleted":
        notice(shell, "This chat was deleted. /new starts another.", shell.theme.warning);
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
      case "head_moved":
      case "queued":
      case "landed":
      case "queue_cancelled":
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

  private onRunEnded(session: FollowedSession, run: RunInfo): void {
    const { shell } = this;
    if (run.phase.kind === "failed") notice(shell, `Error: ${run.phase.error}`, shell.theme.error);
    this.refreshWorkspace();
    this.refreshUsage(session);
    // A run stopped before it answered hands its message back to the composer,
    // the same round trip double-escape makes, minus the picker.
    if (
      run.phase.kind === "aborted" &&
      shell.input.plainText.trim() === "" &&
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
    this.handBack(outcome.restored.content, "Stopped. Message is back in the composer.");
  }

  private handBack(content: SessionState["pending"][number]["content"], told: string): void {
    setInputText(this.shell.input, this.composerParts.load(content));
    this.promptHistory.resetBrowse();
    this.focusComposer();
    notice(this.shell, told, this.shell.theme.ok);
  }

  /**
   * The parked question as a menu: a row per option, and the text field for
   * an answer in the user's own words. Escape leaves the run parked; an empty
   * Enter in the composer brings the menu back.
   */
  private askQuestion(session: FollowedSession, waiting: WaitingCall): void {
    const { shell } = this;
    const ask = questionAsk(waiting.args);
    if (ask === undefined || shell.selecting || shell.prompting) return;
    const asking = new AbortController();
    this.asking = asking;
    void (async () => {
      try {
        // A chosen row resolves with its number, typed text with itself; the
        // question tool reads both as a reply.
        const reply = await selectChoice(shell, ask.question, ask.choices, {
          signal: asking.signal,
          selectLabel: "answer",
          cancelLabel: "later",
          typedPlaceholder: "or type your own answer",
        });
        await this.answer(session, waiting, reply);
      } catch (cause) {
        if (!(cause instanceof PickerCancelled)) throw cause;
      } finally {
        if (this.asking === asking) this.asking = undefined;
      }
    })().catch(this.reportError);
  }

  /** Replies to the parked call. A wait that already ended is reported, never re-sent as a message. */
  private async answer(
    session: FollowedSession,
    waiting: WaitingCall,
    reply: string,
  ): Promise<void> {
    const outcome = await this.host.nyte.runs.reply({
      sessionId: session.sessionId,
      runId: waiting.runId,
      callId: waiting.callId,
      reply,
    });
    if (outcome.kind !== "signalled") {
      notice(this.shell, "That question is no longer waiting", this.shell.theme.warning);
    }
  }

  private syncGutter(state: SessionState): void {
    const rows = gutterRows(state.pending, this.session?.outbox.entries ?? []);
    this.shell.pendingGutter.sync(rows);
    this.queueMenu?.setChoices(this.queueChoices(), this.queueSelection);
    if (this.queueChoices().some((choice) => choice.id === this.queueSelection))
      this.queueSelection = undefined;
    this.status.patch({ queued: rows.length });
  }

  // -------------------------------------------------------------------------
  // Status line
  // -------------------------------------------------------------------------

  private initialStatus(): Partial<PowerlineState> {
    const config = this.config;
    return {
      workspace: basename(this.host.cwd),
      provider: config.model.provider,
      model: config.model.id,
      effort: config.thinkingLevel,
      statuses: [],
      queued: 0,
    };
  }

  private refreshStatus(state: SessionState): void {
    const config = effectiveConfig(state, this.runtime, this.fallback);
    let patch: Partial<PowerlineState> = {
      provider: config.model.provider,
      model: config.model.id,
      effort: config.thinkingLevel,
      tokens: state.context.usageTokens,
    };
    if (state.context.percent !== undefined) patch = { ...patch, pct: state.context.percent };
    this.status.patch(patch);
    void this.refreshBadges();
  }

  private refreshWorkspace(): void {
    void readWorkspaceStatus(this.host.cwd).then((workspace) => {
      if (!this.disposed) this.status.patch(workspace);
    });
  }

  private refreshUsage(session: FollowedSession): void {
    void this.host.nyte.runs
      .context({ sessionId: session.sessionId })
      .then((context) => {
        if (this.session !== session) return;
        const patch: Partial<PowerlineState> = { tokens: context.usageTokens };
        this.status.patch(
          context.percent === undefined ? patch : { ...patch, pct: context.percent },
        );
        this.refreshStatus({ ...session.state, context });
      })
      .catch(() => undefined);
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

  private refreshHints(): void {
    if (this.session !== undefined && this.queueEdits.has(this.session.sessionId)) {
      setHints(this.shell, "enter save queued message · esc cancel edit");
      return;
    }
    const hints =
      this.state?.waiting !== undefined
        ? answerHints(this.roles)
        : this.busy
          ? busyHints({ steer: this.delivery(), queue: this.alternate() })
          : IDLE_HINTS;
    setHints(this.shell, hints);
  }

  private delivery(): string {
    const editing =
      this.session === undefined ? undefined : this.queueEdits.get(this.session.sessionId);
    if (editing !== undefined) return editing.lane;
    return this.busy && this.state?.waiting === undefined
      ? this.roles[this.settings.followUp]
      : this.roles.steer;
  }

  private alternate(): string {
    if (this.session !== undefined && this.queueEdits.has(this.session.sessionId))
      return this.roles.steer;
    return this.busy && this.state?.waiting === undefined && this.settings.followUp === "queue"
      ? this.roles.steer
      : this.roles.queue;
  }

  // -------------------------------------------------------------------------
  // Composer
  // -------------------------------------------------------------------------

  private wireComposer(): void {
    const { shell, renderer } = this;
    const syntax = SyntaxStyle.fromStyles({
      attachment: { fg: shell.theme.pasteForeground, bg: shell.theme.pasteBackground },
    });
    shell.input.syntaxStyle = syntax;
    const styleId = syntax.registerStyle("attachment", {
      fg: shell.theme.pasteForeground,
      bg: shell.theme.pasteBackground,
    });
    const autocomplete = new SlashAutocomplete({
      renderer,
      input: shell.input,
      theme: shell.theme,
      nextId: shell.nextId,
      onCommand: (command) => {
        void this.runCommand({ name: command.name, argument: "" }, { lane: this.delivery() }).catch(
          this.reportError,
        );
      },
      onFile: (path) => this.composerParts.addFile(path),
      onRows: (rows) => {
        if (rows > 0) shell.ephemeral.mount(autocomplete.container, rows);
        else shell.ephemeral.release(autocomplete.container);
      },
    });
    this.autocomplete = autocomplete;
    shell.closeCompletion = () => autocomplete.close();

    const previousChange = shell.input.onContentChange;
    shell.input.onContentChange = (event) => {
      previousChange?.(event);
      this.composerParts.retain(shell.input.plainText);
      queueMicrotask(() => {
        if (shell.input.isDestroyed) return;
        this.composerParts.sync(shell.input, styleId);
        this.attachmentPreview.retain(this.composerParts.current);
      });
      this.refreshAutocomplete();
      if (!shell.prompting && shell.input.plainText !== "" && !shell.selecting) this.refreshHints();
    };
    shell.input.onKeyDown = (key) => {
      if (!isComposerTextKey(key) || shell.input.hasSelection()) return;
      // Project the typed character into the draft so `/re` filters in the
      // same input pass; the matching content callback is then a no-op.
      const text = shell.input.plainText;
      const index = cellIndex(text, shell.input.cursorOffset);
      this.refreshAutocompleteAt(
        `${text.slice(0, index)}${key.sequence}${text.slice(index)}`,
        shell.input.cursorOffset + displayWidth(key.sequence),
      );
    };
    shell.input.onPaste = (event) => this.handlePaste(event);
    shell.input.onMouseUp = (event) => {
      if (event.button !== 0 || shell.selecting || shell.prompting) return;
      if (renderer.getSelection()?.getSelectedText()) return;
      this.openAttachment();
    };
    shell.scroll.onPaste = (event) => {
      this.focusComposer();
      this.handlePaste(event);
      event.stopPropagation();
    };
    shell.input.onSubmit = () => {
      this.submitComposer(this.delivery());
      this.refreshHints();
    };
    this.disposers.push(() => autocomplete.destroy());
  }

  private refreshAutocomplete(): void {
    if (this.shell.input.isDestroyed) return;
    this.refreshAutocompleteAt(this.shell.input.plainText, this.shell.input.cursorOffset);
  }

  private refreshAutocompleteAt(value: string, cursor: number): void {
    const autocomplete = this.autocomplete;
    if (autocomplete === undefined) return;
    if (this.shell.prompting || this.shell.selecting) {
      autocomplete.close();
      return;
    }
    const session = this.session;
    const commands =
      session === undefined
        ? []
        : availableSlashCommands(session.commands, this.slashSettings(session), session.skills);
    autocomplete.update(value, commands, this.mentionFiles, this.host.cwd, cursor);
  }

  private async refreshMentionFiles(): Promise<void> {
    const generation = ++this.mentionGeneration;
    const files = await discoverMentionFiles(this.host.cwd);
    if (generation !== this.mentionGeneration || this.disposed) return;
    this.mentionFiles = files;
    this.refreshAutocomplete();
  }

  private handlePaste(event: PasteEvent): void {
    const { shell } = this;
    this.promptHistory.resetBrowse();
    event.preventDefault();
    if (shell.selecting || this.disposed) return;
    if (shell.prompting) {
      shell.input.insertText(decodePasteBytes(event.bytes));
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
        if (!shell.input.plainText.includes(marker)) shell.input.insertText(`${marker} `);
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
          this.shell.selecting ||
          this.shell.prompting
        )
          return;
        await work();
      })
      .catch(this.reportError)
      .finally(() => {
        if (this.pasting === pending) this.pasting = undefined;
      });
    this.pasting = pending;
  }

  private async pasteInputText(text: string): Promise<void> {
    const { shell } = this;
    const session = this.session;
    const paste = await resolveComposerPaste(text, this.host.cwd);
    if (this.disposed || this.session !== session || shell.selecting || shell.prompting) return;
    switch (paste.kind) {
      case "text": {
        const extmark = shell.input.extmarks.getVirtual().find((mark) => {
          const marker = shell.input.getTextRange(mark.start, mark.end);
          const part = this.composerParts.current.find((candidate) => candidate.marker === marker);
          return (
            (mark.end === shell.input.cursorOffset || mark.end + 1 === shell.input.cursorOffset) &&
            part?.kind === "paste" &&
            part.text === paste.text
          );
        });
        if (extmark !== undefined && this.composerParts.expandPastedText(shell.input, extmark.id))
          return;
        shell.input.insertText(
          pasteLineCount(paste.text) > PASTE_COLLAPSE_LINES
            ? `${this.composerParts.addPaste(paste.text)} `
            : paste.text,
        );
        return;
      }
      case "file":
        shell.input.insertText(`${this.composerParts.addFile(paste.path)} `);
        return;
      case "image": {
        const marker = this.composerParts.addImage(paste.image);
        if (!shell.input.plainText.includes(marker)) shell.input.insertText(`${marker} `);
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
      if (extmark !== undefined) this.composerParts.expandPastedText(this.shell.input, extmark.id);
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
    if (this.disposed || session !== this.session || this.shell.selecting || this.shell.prompting)
      return;
    if (result === undefined) {
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

  private clearComposer(): void {
    this.composerParts.clear();
    this.promptHistory.resetBrowse();
    this.shell.input.clear();
    this.focusComposer();
  }

  private saveDraft(): void {
    const session = this.session;
    if (session === undefined) return;
    this.drafts.save(session.sessionId, this.shell.input.plainText, this.composerParts.current);
  }

  private restoreDraft(id: string): void {
    const draft = this.drafts.read(id);
    this.composerParts.restore(draft?.parts ?? []);
    setInputText(this.shell.input, draft?.text ?? "");
  }

  /** Enter and ctrl+enter both land here; only the lane differs. */
  private submitComposer(lane: string): void {
    const { shell } = this;
    const session = this.session;
    if (session === undefined || shell.loading.visible) {
      notice(shell, "Loading session. Your draft is saved here.");
      return;
    }
    if (shell.prompting || shell.selecting || this.submitting) return;
    if (this.autocomplete?.accepting === true) return;
    if (this.pasting !== undefined) {
      void this.pasting.then(() => {
        if (!this.disposed && this.session === session && shell.input.plainText.trim() !== "")
          this.submitComposer(lane);
      });
      return;
    }
    if (this.queueEdits.has(session.sessionId)) {
      void this.confirmEdit(session, lane).catch(this.reportError);
      return;
    }
    const draft = shell.input.plainText;
    const submission = parseComposerSubmission(draft);
    if (submission.kind === "empty") {
      if (lane !== this.roles.steer) return;
      const { waiting } = session.state;
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
    const prompting =
      submission.kind === "prompt" ||
      commandTarget?.kind === "message" ||
      hasInlineSkills(draft, skills);
    const preparing = prompting
      ? this.composerParts.prepare(draft, (text) => expandInlineSkills(text, skills))
      : undefined;
    this.submitting = true;
    shell.input.clear();
    this.promptHistory.resetBrowse();
    this.autocomplete?.close();
    if (preparing === undefined) {
      if (submission.kind === "command" && commandTarget !== undefined) {
        void this.runCommand(submission.command, { lane, target: commandTarget }).catch(
          this.reportError,
        );
      }
    } else {
      void (async () => {
        const prepared = await preparing;
        this.promptHistory.record(prepared.displayText);
        await this.send(session, prepared.content, lane);
      })().catch(this.reportError);
    }
    queueMicrotask(() => {
      this.submitting = false;
    });
  }

  /** A plain line answers a parked question through the reply channel; anything else is admitted. */
  private async send(
    session: FollowedSession,
    content: SessionState["pending"][number]["content"],
    lane: string,
  ): Promise<void> {
    const waiting = session.state.waiting;
    if (waiting !== undefined && lane === this.roles.steer) {
      if (!Array.isArray(content)) return this.answer(session, waiting, content);
      notice(
        this.shell,
        "Attachments can't answer a question; sent as a message",
        this.shell.theme.warning,
      );
    }
    this.scrollToEnd();
    const outcome = await session.outbox.submit({ content, lane });
    if (outcome.kind === "withdrawn") notice(this.shell, "Message withdrawn");
  }

  private scrollToEnd(): void {
    setTimeout(() => {
      const { scroll } = this.shell;
      if (scroll.isDestroyed) return;
      scroll.stickyScroll = true;
      scroll.scrollTo(scroll.scrollHeight);
    }, 50);
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
    return gutterRows(session.state.pending, session.outbox.entries).map((row, index) => ({
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
    const { shell } = this;
    const session = this.requireSession();
    if (this.queueMenu !== undefined || shell.selecting || shell.prompting) return;
    const rows = () => gutterRows(session.state.pending, session.outbox.entries);
    if (rows().length === 0) {
      notice(shell, "Nothing is queued");
      return;
    }
    const edit = async (id: string): Promise<void> => {
      const row = rows().find((candidate) => rowId(candidate) === id);
      if (row === undefined) return;
      if (this.queueEdits.has(session.sessionId)) {
        notice(shell, "Save or cancel the current queue edit first.");
        return;
      }
      if (row.kind === "sending") {
        const outcome = await session.outbox.withdraw(row.entry.key);
        if (outcome === undefined || this.disposed || this.session !== session) return;
        const stash = {
          lane: row.entry.lane,
          draft: { text: shell.input.plainText, parts: this.composerParts.current },
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
        draft: { text: shell.input.plainText, parts: this.composerParts.current },
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
      if (removed) notice(shell, "Removed from the queue");
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
      shell,
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
      this.syncGutter(session.state);
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
    const { shell, renderer } = this;
    const keymap = shell.keymap;
    const queue: ChatCommandSpec = {
      title: "Send the draft with the alternate delivery mode",
      run: () => {
        if (shell.input.plainText.trim() === "") return false;
        if (this.autocomplete?.accepting && !this.autocomplete.completeQueueableCommand())
          return true;
        this.submitComposer(this.alternate());
        return true;
      },
    };
    this.disposers.push(
      registerChatLayer(keymap, {
        enabled: () =>
          !shell.prompting && !shell.selecting && this.autocomplete?.accepting === true,
        commands: { "chat.queue.submit": queue },
      }),
    );
    this.disposers.push(
      registerSelectionLayer(keymap, renderer, {
        copyOnSelect: () => this.settings.copyOnSelect,
        copy: (text) => {
          void this.clipboard.write(text).catch(this.reportError);
        },
      }),
    );
    this.disposers.push(
      keymap.intercept("key", (ctx) => {
        if (shell.prompting || shell.selecting) return;
        if (ctx.event.name === "up" || ctx.event.name === "down") return;
        this.promptHistory.resetBrowse();
      }),
    );
    this.disposers.push(
      registerChatLayer(keymap, {
        enabled: () =>
          !shell.prompting && !shell.selecting && this.autocomplete?.accepting !== true,
        commands: {
          "chat.interrupt": {
            title: "Stop the current run",
            run: () => {
              if (this.session !== undefined && this.queueEdits.has(this.session.sessionId)) {
                this.cancelEdit();
                return true;
              }
              const intent = escapeIntent({
                selecting: shell.selecting,
                prompting: shell.prompting,
                hasDraft: shell.input.plainText.trim() !== "",
                busy: this.busy,
              });
              if (intent === "ignore") return false;
              if (intent === "abort") {
                if (this.compaction !== undefined) {
                  this.compaction.abort();
                  notice(shell, "Stopping compaction…", shell.theme.tool);
                  return true;
                }
                const session = this.requireSession();
                void this.host.nyte.runs
                  .abort({ sessionId: session.sessionId })
                  .catch(this.reportError);
                return true;
              }
              if (this.doubleEscape.press()) void this.openTree({}).catch(this.reportError);
              return true;
            },
          },
          "chat.scroll.page.up": {
            title: "Scroll the transcript up",
            run: () => {
              shell.scroll.scrollBy(-0.5, "viewport");
              return true;
            },
          },
          "chat.scroll.page.down": {
            title: "Scroll the transcript down",
            run: () => {
              shell.scroll.scrollBy(0.5, "viewport");
              return true;
            },
          },
          "chat.message.previous": {
            title: "Previous message",
            run: () => this.jumpTurn("previous"),
          },
          "chat.message.next": { title: "Next message", run: () => this.jumpTurn("next") },
          "chat.thinking.cycle": {
            title: "Cycle the thinking level",
            run: () => {
              this.cycleThinkingLevel();
              return true;
            },
          },
          "chat.model.next": {
            title: "Next model",
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
          "chat.queue.submit": queue,
          "chat.tools.toggle": {
            title: "Expand or collapse all tool output",
            run: () => {
              const expanded = shell.transcript.toolOutput.toggle();
              notice(shell, `Tool output ${expanded ? "expanded" : "collapsed"}`);
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
          "chat.commands.open": {
            title: "Open the command palette",
            run: () => {
              this.focusComposer();
              void this.openCommandPalette().catch(this.reportError);
              return true;
            },
          },
          "chat.history.previous": {
            title: "Previous message you sent",
            run: () => browseHistory(shell.input, this.promptHistory, "previous"),
          },
          "chat.history.next": {
            title: "Next message you sent",
            run: () => {
              if (browseHistory(shell.input, this.promptHistory, "next")) return true;
              if (shell.input.plainText !== "" || !this.tasks.hasTasks) return false;
              this.tasks.open();
              return true;
            },
          },
        },
      }),
    );
    // What the keymap deliberately leaves alone: quitting, and the completion
    // dropdown, which answers arbitrary keys rather than a fixed set.
    const onKeyPress = (key: KeyEvent): void => {
      if (key.defaultPrevented) return;
      if (this.autocomplete?.handleKey(key) === true) return;
      const action = ctrlCAction(key, {
        selecting: shell.selecting,
        prompting: shell.prompting,
        hasDraft: shell.input.plainText !== "",
      });
      if (action === undefined) return;
      key.preventDefault();
      key.stopPropagation();
      if (action === "clear_for_quit") {
        this.clearComposer();
        setHints(shell, CTRL_C_EXIT_HINT);
        return;
      }
      this.options.requestShutdown();
    };
    renderer.keyInput.on("keypress", onKeyPress);
    this.disposers.push(() => renderer.keyInput.off("keypress", onKeyPress));
  }

  /** Jump to the next turn boundary above or below the viewport. */
  private jumpTurn(direction: "previous" | "next"): boolean {
    const { scroll } = this.shell;
    const top = scroll.scrollTop;
    const turns = scroll
      .getChildren()
      .flatMap((child) =>
        child.id.startsWith("turn:") && child.visible ? [child.y - scroll.y + top] : [],
      );
    const target =
      direction === "next" ? turns.find((y) => y > top) : turns.findLast((y) => y < top);
    if (target === undefined) return false;
    scroll.stickyScroll = false;
    scroll.scrollTo(target);
    return true;
  }

  private cycleThinkingLevel(): void {
    if (this.cyclingThinking || this.busy) return;
    const { model, thinkingLevel } = this.config;
    const next = nextThinkingLevel(thinkingLevel, getSupportedThinkingLevels(model));
    if (next === undefined) return;
    this.cyclingThinking = true;
    void this.changeThinkingLevel(next, false)
      .catch(this.reportError)
      .finally(() => {
        this.cyclingThinking = false;
      });
  }

  private cycleModel(delta: 1 | -1): void {
    if (this.cyclingModel || this.busy) return;
    this.cyclingModel = true;
    void (async () => {
      const available =
        cachedAuthenticatedModels(this.runtime.models) ??
        (await loadAuthenticatedModels(this.runtime.models));
      if (available.length < 2) return;
      const current = this.config.model;
      const index = available.findIndex(
        (model) => model.provider === current.provider && model.id === current.id,
      );
      const next =
        available[index === -1 ? 0 : (index + delta + available.length) % available.length];
      if (next !== undefined) await this.changeModel(next);
    })()
      .catch(this.reportError)
      .finally(() => {
        this.cyclingModel = false;
      });
  }

  private openExternalEditor(): void {
    if (this.editingExternally) return;
    this.editingExternally = true;
    this.autocomplete?.close();
    const { shell, renderer } = this;
    const draft = shell.input.plainText;
    shell.input.blur();
    renderer.suspend();
    void editInExternalEditor(draft, resolveExternalEditor(this.settings.externalEditor))
      .then((result) => {
        if (result.status === "completed") setInputText(shell.input, result.text);
        else this.reportError(result.error);
      })
      .finally(() => {
        renderer.resume();
        shell.focus.reset();
        renderer.requestRender();
        this.editingExternally = false;
      });
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  private async changeModel(model: Model<Api>, thinkingLevel?: ThinkingLevel): Promise<void> {
    const session = this.requireSession();
    const current = this.config.model;
    const effort = clampThinkingLevel(model, thinkingLevel ?? this.config.thinkingLevel);
    if (
      current.provider === model.provider &&
      current.id === model.id &&
      effort === this.config.thinkingLevel
    ) {
      notice(this.shell, `Already using ${model.id}`);
      return;
    }
    const outcome = await this.host.nyte.sessions.configure({
      sessionId: session.sessionId,
      model: { provider: model.provider, id: model.id },
      thinkingLevel: effort,
    });
    if (outcome.kind !== "queued") throw new Error(`Unknown model: ${model.id}`);
    this.status.patch({ provider: model.provider, model: model.id, effort });
    this.updateSettings({
      defaultProvider: model.provider,
      defaultModel: model.id,
      defaultThinkingLevel: effort,
    });
    notice(this.shell, `Model: ${model.provider}/${model.id} · ${effort}`, this.shell.theme.ok);
  }

  private async changeThinkingLevel(level: ThinkingLevel, announce: boolean): Promise<void> {
    const session = this.requireSession();
    if (this.config.thinkingLevel === level) {
      if (announce) notice(this.shell, `Already using ${level}`);
      return;
    }
    const outcome = await this.host.nyte.sessions.configure({
      sessionId: session.sessionId,
      thinkingLevel: level,
    });
    if (outcome.kind !== "queued") throw new Error(`Unsupported thinking level: ${level}`);
    this.status.patch({ effort: level });
    this.updateSettings({ defaultThinkingLevel: level });
    if (announce) notice(this.shell, `Thinking level: ${level}`, this.shell.theme.ok);
  }

  private updateSettings(patch: Omit<SettingsPatch, "compaction">): void {
    this.settings = { ...this.settings, ...patch };
    this.options.onSettings(this.settings);
    void this.settingsStore.updateGlobal(patch).catch(this.reportError);
  }

  private async changeTheme(mode: ThemeMode): Promise<void> {
    this.themeMode = mode;
    applyShellTheme(this.shell, themeForMode(mode));
    this.autocomplete?.retheme(this.shell.theme);
    this.status.repaint();
    this.redraw();
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

  /** Redraw the record from the follower's state; presentation changed, the record did not. */
  private redraw(): void {
    const session = this.session;
    if (session === undefined) return;
    this.shell.view.clear();
    this.render(session, undefined, undefined);
  }

  private async reloadPlugins(): Promise<void> {
    await this.tuiPlugins.reconcile();
    const resolved = await resolveWorkspacePlugins(this.workspace, {
      model: this.config.model,
      models: this.runtime.models,
    });
    for (const failure of resolved.failures) {
      notice(this.shell, `plugin ${failure.path}: ${failure.error}`, this.shell.theme.error);
    }
    await this.host.nyte.setPlugins(resolved.plugins);
    const session = this.session;
    if (session !== undefined) await this.refreshContributions(session);
  }

  private async checkUpdate(): Promise<void> {
    const release = await checkForUpdate();
    if (release === undefined || this.disposed) return;
    const { shell } = this;
    if (!this.settings.autoUpdate) {
      notice(
        shell,
        `Update available: ${release.version} · /update to install`,
        shell.theme.warning,
      );
      return;
    }
    const outcome = await selfUpdate();
    if (this.disposed) return;
    notice(
      shell,
      outcome.kind === "updated"
        ? describeUpdateOutcome(outcome)
        : `Update available: ${release.version} · ${describeUpdateOutcome(outcome)}`,
      outcome.kind === "updated" ? undefined : shell.theme.warning,
    );
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  private async switchSession(info: SessionInfo, announce: boolean): Promise<void> {
    if (this.switchingSession) throw new Error("A chat switch is already in progress");
    this.switchingSession = true;
    try {
      this.saveDraft();
      await this.follow(info);
      this.focusComposer();
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
    const { shell } = this;
    const current = this.requireSession();
    const { items } = await this.host.nyte.sessions.list();
    const sessions: Choice[] = items
      .filter((session) => session.heads.some((head) => head.tip !== null))
      .toSorted((left, right) => right.lastActivityAt - left.lastActivityAt)
      .map((session) => {
        const title = session.name ?? session.preview ?? shortId(session.sessionId);
        const currentLabel = session.sessionId === current.sessionId ? " (current)" : "";
        const savedAt = new Date(session.lastActivityAt).toLocaleString();
        const description =
          session.parent === undefined
            ? `${savedAt} · ${shortId(session.sessionId)}`
            : `${session.parent.agent} subagent · ${savedAt} · ${shortId(session.sessionId)}`;
        return { id: session.sessionId, label: `${title}${currentLabel}`, description };
      });
    if (sessions.length === 0) {
      notice(shell, "No saved chats");
      return;
    }
    const chosen = await selectChoice(shell, "Resume chat", sessions, {
      selectedId: current.sessionId,
    });
    if (chosen === current.sessionId) {
      notice(shell, `Already in ${shortId(chosen)}`);
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
    const { shell } = this;
    const restoredHints = shell.hintText;
    return new Promise<Oid>((resolve, reject) => {
      let selector: TreeSelector | undefined;
      let settled = false;
      const settle = (finish: () => void): void => {
        if (settled) return;
        settled = true;
        if (selector !== undefined) closePanel(shell, selector);
        shell.inputBox.visible = true;
        shell.powerline.visible = true;
        setHints(shell, restoredHints);
        finish();
      };
      shell.inputBox.visible = false;
      shell.powerline.visible = false;
      selector = openPanel(
        shell,
        new TreeSelector(
          {
            renderer: this.renderer,
            theme: shell.theme,
            nextId: shell.nextId,
            onRows: (rows) => shell.ephemeral.setRows(rows),
            onSelect: (oid) => settle(() => resolve(oid)),
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
    const { shell } = this;
    shell.dismissInfoPanel?.();
    if (shell.selecting) return Promise.reject(new Error("Another panel is already open"));
    return new Promise<string>((resolve, reject) => {
      const previousPrompt = shell.prompt.content;
      const previousSubmit = shell.input.onSubmit;
      const previousPlaceholder = shell.input.placeholder;
      shell.input.placeholder = options.placeholder;
      shell.prompt.content = options.prompt;
      shell.prompting = true;
      let settled = false;
      const finish = (): void => {
        this.renderer.keyInput.off("keypress", onKeyPress);
        shell.input.placeholder = previousPlaceholder;
        shell.prompt.content = previousPrompt;
        shell.prompting = false;
        shell.input.onSubmit = previousSubmit;
      };
      const onKeyPress = (key: KeyEvent): void => {
        if (settled || (key.name !== "escape" && !(key.ctrl && key.name === "c"))) return;
        key.preventDefault();
        key.stopPropagation();
        settled = true;
        finish();
        reject(new PickerCancelled());
      };
      this.renderer.keyInput.on("keypress", onKeyPress);
      shell.input.onSubmit = () => {
        if (settled) return;
        settled = true;
        const text = shell.input.plainText;
        shell.input.clear();
        finish();
        resolve(text);
      };
      shell.input.focus();
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
    const { shell } = this;
    const session = this.requireSession();
    if (this.busy) throw new Error("Wait for the current run before changing the session branch");
    const commits = await this.host.sessionCommits(session.sessionId);
    if (commits.length === 0) {
      notice(shell, "No messages to branch from");
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
      notice(shell, "Already at that point in the chat");
      return;
    }
    const takesBack = selected.body.kind === "message" && selected.body.message.role === "user";
    if (takesBack && shell.input.plainText.trim() !== "") {
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
          this.handBack(
            outcome.restored.content,
            "Message moved back to the composer. Enter sends it again.",
          );
          return;
        }
        notice(shell, "Moved. The next message starts a branch here.", shell.theme.ok);
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
    const selectedName = await selectChoice(
      this.shell,
      "Commands",
      commands.map((command) => ({
        id: command.name,
        label: slashCommandLabel(command),
        description: command.description,
      })),
    );
    const selected = commands.find((command) => command.name === selectedName);
    if (selected === undefined || selected.name === "help") return;
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
        id: "copy-on-select",
        label: "Copy on select",
        current: () => (this.settings.copyOnSelect ? "on" : "off"),
        choices: () => [
          { id: "on", label: "on", description: "Copy text when the mouse selection ends" },
          { id: "off", label: "off", description: "Copy selected text with Ctrl+C" },
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
    if (this.busy) throw new Error(`Wait for the current run before changing ${row.label}`);
    if (argument === "") {
      if (row.id === "model") {
        await this.pickModel();
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
    const { shell, runtime } = this;
    const session = this.requireSession();
    if (shell.selecting) throw new Error("Another menu is already open");
    const selection = await new Promise<ModelSelection>((resolve, reject) => {
      const close = (): void => {
        closePanel(shell, picker);
        this.refreshHints();
      };
      const picker = new ModelPicker({
        renderer: this.renderer,
        theme: shell.theme,
        nextId: shell.nextId,
        models: cachedAuthenticatedModels(runtime.models) ?? [],
        current: this.config.model,
        thinkingLevel: this.config.thinkingLevel,
        fastModes: new Map(
          session.settings.map((setting) => [setting.id, setting.current === "on"]),
        ),
        load: () => loadAuthenticatedModels(runtime.models),
        onRows: (rows) => shell.ephemeral.setRows(rows),
        onHints: (hints) => setHints(shell, hints),
        onError: this.reportError,
        onSelect: (picked) => {
          close();
          resolve(picked);
        },
        onCancel: () => {
          close();
          reject(new PickerCancelled());
        },
      });
      openPanel(shell, picker);
    });
    if (selection.fast !== undefined) {
      const { settingId, enabled } = selection.fast;
      const row = this.settingRows(session).find((setting) => setting.id === settingId);
      if (row !== undefined && row.current() !== (enabled ? "on" : "off")) {
        await row.apply(enabled ? "on" : "off");
      }
    }
    await this.changeModel(selection.model, selection.thinkingLevel);
    const fast =
      selection.fast === undefined ? "" : ` · Fast mode ${selection.fast.enabled ? "on" : "off"}`;
    notice(
      shell,
      `Model: ${modelChoiceId(selection.model)} · ${selection.thinkingLevel}${fast}`,
      shell.theme.ok,
    );
  }

  private async openSettings(): Promise<void> {
    if (this.busy) throw new Error("Wait for the current run before changing settings");
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
    const { shell } = this;
    return {
      signal,
      prompt: (prompt) => {
        switch (prompt.type) {
          case "select":
            return selectChoice(shell, prompt.message, [...prompt.options]);
          case "text":
          case "secret":
          case "manual_code":
            return this.readLine({
              prompt: `${prompt.message} `,
              placeholder: prompt.placeholder ?? "",
            });
          default: {
            const _exhaustive: never = prompt;
            return _exhaustive;
          }
        }
      },
      notify: (event) => {
        switch (event.type) {
          case "auth_url":
            notice(shell, [event.instructions ?? "Open this URL to continue:", event.url]);
            void open(event.url).catch(() => undefined);
            return;
          case "device_code":
            notice(shell, `Visit ${event.verificationUri} and enter the code ${event.userCode}`);
            return;
          case "info":
          case "progress":
            notice(shell, event.message);
            return;
          default: {
            const _exhaustive: never = event;
            throw new Error(_exhaustive);
          }
        }
      },
    };
  }

  /** `/login [provider]`: pick a provider when none is named, then its login mode when it has two. */
  private async login(argument: string): Promise<void> {
    const { shell } = this;
    const { models } = this.runtime;
    let provider: Provider;
    if (argument === "") {
      const statuses = await providerAuthStatuses(models);
      const chosen = await selectChoice(
        shell,
        "Sign in",
        statuses.map((status) => ({
          id: status.provider.id,
          label: status.provider.name,
          description: status.kind === "authenticated" ? "signed in" : "",
        })),
        { selectedId: this.config.model.provider },
      );
      provider = requireProvider(models, chosen);
    } else {
      provider = requireProvider(models, argument);
    }
    const controller = new AbortController();
    const interaction = this.authInteraction(controller.signal);
    const { oauth, apiKey } = provider.auth;
    let mode: "oauth" | "api_key" = oauth === undefined ? "api_key" : "oauth";
    if (oauth !== undefined && apiKey?.login !== undefined) {
      const picked = await interaction.prompt({
        type: "select",
        message: `Sign in to ${provider.name} with`,
        options: [
          { id: "oauth", label: oauth.name },
          { id: "api_key", label: apiKey.name },
        ],
      });
      if (picked !== "oauth" && picked !== "api_key") throw new Error("Unknown login mode");
      mode = picked;
    }
    const wasSignedOut = (await models.getAuth(this.config.model.provider)) === undefined;
    try {
      await models.login(provider.id, mode, interaction);
    } catch (cause) {
      controller.abort();
      throw cause;
    }
    await loadAuthenticatedModels(models, { force: true });
    notice(shell, `Signed in to ${provider.name}`, shell.theme.ok);
    // A shell that opened signed out now has somewhere to send: move to the provider just joined.
    if (wasSignedOut) await this.changeModel(defaultModel(models, provider.id));
  }

  /** `/logout [provider]`: the named provider, else the one the chat is using. */
  private async logout(argument: string): Promise<void> {
    const { models } = this.runtime;
    const provider = requireProvider(
      models,
      argument === "" ? this.config.model.provider : argument,
    );
    await models.logout(provider.id);
    await loadAuthenticatedModels(models, { force: true });
    notice(this.shell, `Signed out of ${provider.name}`, this.shell.theme.ok);
  }

  /** The usage card, in the notice slot: first what the store knows, then the account's headroom. */
  private async openUsage(): Promise<void> {
    const { shell } = this;
    const session = this.requireSession();
    const report = await this.host.workspaceUsage(session.sessionId);
    const activeProvider = this.config.model.provider;
    const checking = hasHeadroom(activeProvider);
    notice(
      shell,
      usageLines(
        usageCard(report, {
          activeProvider,
          headroom: checking ? { kind: "checking" } : { kind: "none" },
        }),
      ),
    );
    if (!checking) return;
    const limits = await fetchAccountLimits(this.runtime.models, activeProvider);
    if (this.session !== session || this.disposed) return;
    notice(
      shell,
      usageLines(
        usageCard(report, {
          activeProvider,
          headroom: limits === undefined ? { kind: "unavailable" } : { kind: "known", limits },
        }),
      ),
    );
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
    const { shell } = this;
    const session = this.requireSession();
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
            if (outcome.output !== undefined) notice(shell, outcome.output);
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
    const { shell } = this;
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
        await this.switchSession(info, false);
        return;
      }
      case "settings":
        noArgument();
        await this.openSettings();
        return;
      case "login":
        await this.login(argument);
        return;
      case "logout":
        await this.logout(argument);
        return;
      case "compact": {
        whenIdle("compacting");
        const controller = new AbortController();
        this.compaction = controller;
        this.refreshHints();
        notice(shell, "Compacting…", shell.theme.tool);
        try {
          const request = { sessionId: session.sessionId, signal: controller.signal };
          const outcome = await this.host.nyte.runs.compact(
            argument === "" ? request : { ...request, customInstructions: argument },
          );
          if (this.disposed || this.session !== session) return;
          switch (outcome.kind) {
            case "compacted":
              notice(shell, "Compacted", shell.theme.ok);
              return;
            case "nothing_to_compact":
              notice(shell, "Nothing to compact");
              return;
            case "aborted":
              notice(shell, "Compaction cancelled");
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
        const plugins = await this.host.nyte.plugins.list({ sessionId: session.sessionId });
        if (plugins.length === 0) {
          notice(shell, "No plugins");
          return;
        }
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
        notice(shell, lines);
        return;
      }
      case "reload": {
        noArgument();
        whenIdle("reloading");
        await this.reloadPlugins();
        this.redraw();
        const pluginCount = (await this.host.nyte.plugins.list({ sessionId: session.sessionId }))
          .length;
        notice(
          shell,
          `Reloaded ${String(pluginCount)} ${pluginCount === 1 ? "plugin" : "plugins"} and ${String(session.skills.size)} ${session.skills.size === 1 ? "skill" : "skills"}`,
          shell.theme.ok,
        );
        return;
      }
      case "update": {
        const report = (event: UpdateProgress): void => {
          if (event.kind === "downloading") notice(shell, `Downloading ${event.asset}…`);
          else if (event.kind === "verified") notice(shell, "Checksum verified.");
        };
        const outcome = await selfUpdate(
          argument === "" ? { report } : { version: argument, report },
        );
        const severity = updateSeverity(outcome);
        notice(
          shell,
          describeUpdateOutcome(outcome),
          severity === "ok"
            ? undefined
            : severity === "warn"
              ? shell.theme.warning
              : shell.theme.error,
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
