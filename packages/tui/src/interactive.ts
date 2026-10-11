/**
 * The interactive shell: one host, one followed session, one composer. Every
 * durable fact on screen comes from the head's `SessionView`; every
 * submission goes through `send`, whose journal holds what is still unsent.
 * Local `!` commands never enter the job or model loop.
 */
import process from "node:process";
import { basename, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
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
import type {
  BlobId,
  CommandInfo,
  CommitId,
  Delivery,
  Host,
  HostView,
  Json,
  MessageId,
  ModelCatalogView,
  ModelInfo,
  RunEnd,
  SendReceipt,
  Session,
  SessionId,
  SessionInfo,
  SessionView,
  SettingInfo,
  SkillInfo,
  Thinking,
  TreeView,
  UserContent,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { authProviderChoices, loginProvider, logoutProvider } from "./auth.ts";
import type { LoginDriver } from "./auth.ts";
import { readAuthPrompt } from "./auth-prompt.ts";
import { availableModels, clampThinking, findModel, modelId } from "./catalog.ts";
import {
  DialogImagePreview,
  ComposerParts,
  createClipboardAdapter,
  createTuiClipboard,
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
import { openTerminalHost } from "./host.ts";
import {
  ctrlCAction,
  DoubleEscape,
  matchesKey,
  matchesKeyName,
  nextThinkingLevel,
  registerChatLayer,
  registerSelectionKeys,
} from "./keymap.ts";
import { deliveryChoices, nextToSteer } from "./lanes.ts";
import type { DeliveryChoices } from "./lanes.ts";
import { ModelPicker } from "./model-picker.ts";
import type { ModelSelection } from "./model-picker.ts";
import { deliveryMark, queuedPromptText } from "./pending-gutter.ts";
import type { GutterRow } from "./pending-gutter.ts";
import { PickerCancelled } from "./picker.ts";
import type { Choice, InlineMenu } from "./picker.ts";
import { mountClientPlugins } from "./plugins.ts";
import type { ClientPlugins } from "./plugins.ts";
import { browseHistory, PromptHistory } from "./prompt-history.ts";
import { flagConfiguration, targetSession, tuiPlugins } from "./run.ts";
import { TUI_RENDERER_CONFIG } from "./rendering.ts";
import { SessionConfigurator } from "./session-config.ts";
import type { ConfigPatch, RunChoice, SubmissionSlot } from "./session-config.ts";
import { TaskBrowser } from "./task-browser.ts";
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
  formatSkillInvocation,
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
import { follow, openQuestions, queuedMessages } from "./view-helpers.ts";
import type { OpenQuestion, UserMessage } from "./view-helpers.ts";
import { readWorkspaceStatus } from "./workspace.ts";
import { reportProgramStatus } from "./program-status.ts";

type TuiExit =
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

/** The view's selected configuration, else what admission would resolve, else the fallback. */
function selectedConfig(view: SessionView | undefined, fallback: RunChoice): RunChoice {
  const configuration = view?.configuration.selected ?? view?.configuration.effective ?? null;

  return configuration === null
    ? fallback
    : { model: configuration.model, thinkingLevel: configuration.thinking };
}

function userPrompts(view: SessionView): string[] {
  return view.messages.flatMap((message) => {
    if (message.kind !== "user" || message.status.kind !== "landed") return [];
    const text = userText(message.content);

    return text.trim() === "" ? [] : [promptDraft(text)];
  });
}

/**
 * The request a stopped run hands back to the composer: the last turn's lone
 * landed prompt. A continuation turn has no prompt, so a stop after a
 * background result landed retracts nothing and keeps the result in context.
 */
function unansweredRequest(view: SessionView): CommitId | undefined {
  const turn = view.turns.at(-1);

  if (turn === undefined || turn.prompt === null) return undefined;
  const messages = view.messages.filter((message) => message.turn === turn.id);
  const only = messages[0];

  return messages.length === 1 && only?.kind === "user" && only.status.kind === "landed"
    ? only.status.commit
    : undefined;
}

function modelChoices(catalog: ModelCatalogView | undefined): Choice[] {
  return (catalog?.providers ?? []).flatMap((provider) =>
    provider.credential === "configured" || provider.credential === "verified"
      ? provider.models.map((model) => ({
          id: modelId(model.ref),
          label: model.name === "" ? model.ref.id : model.name,
          description:
            model.name === model.ref.id ? provider.name : `${provider.name} · ${model.ref.id}`,
        }))
      : [],
  );
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
 * whose configuration never reached the head. It lands only into an empty
 * composer, so a draft typed meanwhile is never overwritten, and it survives
 * a session switch until then.
 */
type Handback = (
  | { readonly content: UserContent; readonly draft?: never }
  | { readonly draft: ComposerDraft; readonly content?: never }
) & {
  /** The retracted commit, when a move produced this; absent for an unsent message. */
  readonly commit?: CommitId;
  readonly notice: string;
};

/**
 * Everything the shell knows about the followed session, rebuilt on a switch:
 * its handle, its directory row and its head's latest view.
 */
interface FollowedSession {
  readonly sessionId: SessionId;
  readonly session: Session;
  info: SessionInfo;
  view: SessionView | undefined;
  /** What the user asked the next run to use, ahead of the head's acknowledgement. */
  readonly config: SessionConfigurator;
  completionCommands: ReturnType<typeof availableSlashCommands>;
  stop(): void;
}

/** The commands a view's catalog offers, by name. */
function commandsOf(session: FollowedSession): ReadonlyMap<string, CommandInfo> {
  return new Map((session.view?.catalog.commands ?? []).map((command) => [command.name, command]));
}

/** The skills a view's catalog offers, by name. */
function skillsOf(session: FollowedSession): ReadonlyMap<string, SkillInfo> {
  return new Map((session.view?.catalog.skills ?? []).map((skill) => [skill.name, skill]));
}

export async function runTui(
  flags: RunFlags,
  suppliedRenderer?: CliRenderer,
  output: Pick<typeof process.stdout, "write"> | undefined = suppliedRenderer === undefined
    ? process.stdout
    : undefined,
): Promise<TuiExit> {
  const renderer = suppliedRenderer ?? (await createTuiRenderer());
  const roles = deliveryChoices;

  const shell = await mountShell({
    renderer,
    initialTheme: themeForMode(resolveThemeMode("auto", renderer.themeMode)),
    roles,
    openPath: (path) => {
      void open(path).catch(() => undefined);
    },
  });

  patchStatus(shell, { workspace: basename(process.cwd()) });
  shell.setUi("loading", "Opening workspace…");
  shell.input.onSubmit = () => notice(shell, "Still starting. Your draft is saved here.");
  let exit: TuiExit = { kind: "quit" };
  let resumeId: SessionId | undefined;
  const startupAbort = new AbortController();

  const destroyed = new Promise<void>((resolveDestroyed) => {
    renderer.once("destroy", () => {
      startupAbort.abort();
      resolveDestroyed();
    });
  });

  const failures: string[] = [];

  const cleanup = async (resource: string, dispose: () => void | Promise<void>): Promise<void> => {
    try {
      await dispose();
    } catch (cause) {
      failures.push(`${resource} cleanup failed: ${errorMessage(cause)}`);
    }
  };

  let closing: Promise<void> | undefined;

  const requestShutdown = (requested: TuiExit = { kind: "quit" }): void => {
    if (requested.kind === "signal") exit = requested;
    resumeId ??= app?.sessionId;
    startupAbort.abort();
    closing ??= cleanup("TUI", () => app?.dispose()).finally(() => renderer.destroy());
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
  let app: Interactive | undefined;
  const disposers: (() => void)[] = [];

  const boot = async (): Promise<void> => {
    renderer.requestRender();
    await renderer.idle();

    if (startupAbort.signal.aborted) return;
    const cwd = process.cwd();
    shell.setUi("loading", "Loading settings…");
    const settingsStore = new FileSettingsStore();
    const settings = await settingsStore.read(cwd);

    if (startupAbort.signal.aborted) return;
    shell.setScrollAcceleration(settings.scrollAcceleration);
    renderer.off(CliRenderEvents.THEME_MODE, onStartupTheme);

    const updateTheme = (): void => {
      shell.setTheme(themeForMode(resolveThemeMode(settings.theme, renderer.themeMode)));
    };

    updateTheme();
    renderer.on(CliRenderEvents.THEME_MODE, updateTheme);
    disposers.push(() => renderer.off(CliRenderEvents.THEME_MODE, updateTheme));
    shell.setUi("loading", "Opening workspace…");
    // Keep ownership even if startup was cancelled while the host was opening.
    host = await openTerminalHost();

    if (startupAbort.signal.aborted) return;
    shell.setUi("loading", "Loading providers…");
    const catalog = await host.models.list();

    if (startupAbort.signal.aborted) return;
    const bootNotices: string[] = [];
    const available = availableModels(catalog);

    if (available.length === 0) bootNotices.push("Not signed in. /login connects a provider.");

    const model =
      catalog.default ??
      available[0]?.ref ??
      catalog.providers.flatMap((provider) => provider.models)[0]?.ref;

    if (model === undefined)
      throw new Error(
        "No models are available. Check your connection, then run `nyte update --models`.",
      );
    const fallback: RunChoice = { model, thinkingLevel: flags.effort ?? "medium" };
    patchStatus(shell, {
      provider: fallback.model.provider,
      model: fallback.model.id,
      effort: fallback.thinkingLevel,
    });

    renderer.off(CliRenderEvents.THEME_MODE, updateTheme);
    app = new Interactive({
      renderer,
      shell,
      host,
      catalog,
      roles,
      settings,
      settingsStore,
      cwd,
      fallback,
      themeMode: resolveThemeMode(settings.theme, renderer.themeMode),
      requestShutdown,
    });
    renderer.keyInput.off("keypress", onStartupKey);
    await app.start(flags);

    if (startupAbort.signal.aborted) return;

    for (const message of bootNotices) notice(shell, message, shell.theme.warning);
  };

  const booting = boot().catch((cause: unknown) => {
    if (!startupAbort.signal.aborted) failures.unshift(`error: ${errorMessage(cause)}`);
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
    await cleanup("Host", () => host?.close());
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

  if (failures.length > 0 && exit.kind === "quit") process.exit(1);

  return exit;
}

interface InteractiveOptions {
  readonly renderer: CliRenderer;
  readonly shell: Shell;
  readonly host: Host;
  /** The catalog as read at startup; re-read when the host's catalog generation moves. */
  readonly catalog: ModelCatalogView;
  readonly roles: DeliveryChoices;
  readonly settings: ResolvedSettings;
  readonly settingsStore: FileSettingsStore;
  readonly cwd: string;
  readonly fallback: RunChoice;
  readonly themeMode: ThemeMode;
  readonly requestShutdown: () => void;
  readonly clipboard?: ClipboardService;
}

class Interactive {
  private readonly tasks: TaskBrowser;
  private plugins: ClientPlugins | undefined;
  private readonly renderer: CliRenderer;
  private readonly shell: Shell;
  private readonly host: Host;
  /** The model catalog, read again whenever the host view's catalog generation moves. */
  private catalog: ModelCatalogView;
  /** The host as last watched: its plugin rows, settings and catalog generation. */
  private hostView: HostView | undefined;
  private readonly roles: DeliveryChoices;
  private readonly settingsStore: FileSettingsStore;
  /** The folder the followed session's workspace serves. */
  private cwd: string;
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
  /** A queued message being edited in the composer: the message and the draft it replaced. */
  private readonly queueEdits = new Map<
    SessionId,
    {
      readonly message: MessageId;
      readonly delivery: Delivery;
      readonly content: UserContent;
      readonly draft: ComposerDraft;
    }
  >();
  private readonly drafts = new SessionDrafts();
  /** The receipts of this terminal's sends by message id: a queued message is withdrawn through its receipt. */
  private readonly receipts = new Map<MessageId, SendReceipt>();
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
  private readonly disposers: (() => void | Promise<void>)[] = [];
  private submitting = false;
  private pasteSubmission: SubmissionSlot | undefined;
  private pasteFailures = 0;
  /** The open question menu, so a question answered elsewhere can close it. */
  private asking: AbortController | undefined;
  private waiting: { readonly session: SessionId; readonly question: OpenQuestion } | undefined;
  private authenticating: AbortController | undefined;
  private authenticationLink: { readonly url: string; readonly copy: string } | undefined;
  /** Local commands belong to this TUI, never to a core run or task. */
  private readonly shellCommands = new Map<
    string,
    {
      readonly sessionId: SessionId;
      readonly process: ShellProcess;
      retention: "pending" | "attached" | "exclude" | "discarded";
    }
  >();
  private activeShell: ShellProcess | undefined;
  private editingExternally = false;
  private switchingSession = false;
  private readonly stopped = new AbortController();
  private disposed = false;
  private closing: Promise<void> | undefined;
  private pendingVisual:
    | {
        readonly session: FollowedSession;
        readonly previous: SessionView | undefined;
        readonly reset: boolean;
      }
    | undefined;

  constructor(options: InteractiveOptions) {
    this.options = options;
    this.renderer = options.renderer;
    this.shell = options.shell;
    this.host = options.host;
    this.catalog = options.catalog;
    this.roles = options.roles;
    this.settingsStore = options.settingsStore;
    this.cwd = options.cwd;
    this.fallback = options.fallback;
    this.settings = options.settings;
    this.themeMode = options.themeMode;
    this.document = new ComposerDocument(options.shell.input);
    this.renderer.setFrameCallback(this.flushVisual);
    this.disposers.push(() => this.renderer.removeFrameCallback(this.flushVisual));
    reportProgramStatus(this.renderer, () => ({
      busy: this.busy,
      execution: this.view?.execution,
      question: this.waiting?.question.prompt,
    }));
    this.clipboard =
      options.clipboard === undefined
        ? createTuiClipboard(options.renderer)
        : createClipboardAdapter(options.clipboard);
    this.attachmentPreview = new DialogImagePreview(options.renderer, options.shell.theme);
    options.shell.previewSlot.add(this.attachmentPreview.container);
    this.disposers.push(() => {
      this.attachmentPreview.close();

      return this.clipboard.dispose();
    });
    this.tasks = new TaskBrowser({
      shell: options.shell,
      connection: options.host,
      onClose: () => this.refreshHints(),
      onChange: () => {
        this.refreshQuestion();

        // A child's step lands in its delegation card in the parent transcript.
        if (this.session === undefined) return;
        this.pendingVisual ??= {
          session: this.session,
          previous: this.session.view,
          reset: false,
        };
        this.renderer.requestRender();
      },
      onError: (cause) => this.reportError(cause),
    });
    options.shell.transcript.blob = async (id: BlobId) => {
      const reader = await options.host.blob(id);
      const chunks: Uint8Array[] = [];

      for await (const chunk of reader.chunks()) chunks.push(chunk);

      return Buffer.concat(chunks);
    };

    options.shell.transcript.drawPart = (message) => this.plugins?.draw(message);
    options.shell.pendingGutter.onOpen = (row) => {
      void this.openQueue(row.id).catch(this.reportError);
    };

    options.shell.pendingGutter.onReorder = (item, before) => {
      const session = this.session;

      if (
        session === undefined ||
        options.shell.ui.selecting ||
        this.queueEdits.has(session.sessionId)
      )
        return;
      void this.reorder(session, item, before?.id ?? null).catch(this.reportError);
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
    this.disposers.push(() => {
      this.renderer.off(CliRenderEvents.THEME_MODE, onTerminalTheme);
    });
    this.disposers.push(
      follow(this.host.watch(), (view) => this.onHostView(view), this.reportError),
      follow(
        this.host.sessions.watch({ parents: { kind: "all" } }),
        (sessions) => this.onDirectory(sessions),
        this.reportError,
      ),
    );
    this.plugins = await mountClientPlugins({
      connection: this.host,
      plugins: tuiPlugins(),
      session: () => this.session?.session ?? null,
      notify: (input) => {
        this.renderer.triggerNotification(input.message, input.title ?? "Nyte");

        if (input.sound === true && process.stdout.isTTY) process.stdout.write("\u0007");
      },
      report: (plugin, message) =>
        notice(this.shell, `plugin ${plugin}: ${message}`, this.shell.theme.error),
    });

    const session = await targetSession(
      this.host,
      flags.resume,
      await flagConfiguration(this.host, flags),
    );

    if (this.disposed) return;
    await this.follow(session);

    if (this.disposed) return;
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
    const plugins = this.plugins?.dispose();
    this.closeQueue();
    this.asking?.abort();
    this.session?.stop();
    this.session = undefined;

    const disposed = this.disposers
      .splice(0)
      .toReversed()
      .map(async (dispose) => dispose());

    this.renderer.setTerminalTitle(TERMINAL_TITLE_BASE);
    this.closing = Promise.allSettled([
      plugins,
      ...disposed,
      ...[...this.shellCommands.values()].map((entry) => entry.process.done),
    ]).then((outcomes) => {
      this.shellCommands.clear();
      const failures = outcomes.flatMap((outcome) =>
        outcome.status === "rejected" ? [outcome.reason] : [],
      );

      if (failures.length > 0) throw new AggregateError(failures, "TUI cleanup failed");
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

  private get view(): SessionView | undefined {
    return this.session?.view;
  }

  /** A run is live, waiting or retrying, or a compaction is being written. */
  private get busy(): boolean {
    const view = this.view;

    return (
      view !== undefined &&
      (view.execution.kind !== "idle" ||
        view.messages.some(
          (message) =>
            message.kind === "part" &&
            message.partKind === "compaction" &&
            message.status.kind === "live",
        ))
    );
  }

  /** The configuration the user selected, reconciled with the head's selection. */
  private get config(): RunChoice {
    return this.session?.config.selected ?? this.fallback;
  }

  /** The catalog moved: read it again. Plugin and setting rows are read from the view as they come. */
  private onHostView(view: HostView): void {
    const previous = this.hostView;
    this.hostView = view;

    if (previous === undefined || previous.catalog === view.catalog) return;
    void this.host.models
      .list()
      .then((catalog) => {
        this.catalog = catalog;
      })
      .catch(this.reportError);
  }

  /** The directory moved: keep the followed session's row, its name in the title. */
  private onDirectory(sessions: readonly SessionInfo[]): void {
    const session = this.session;
    const info = sessions.find((candidate) => candidate.id === session?.sessionId);

    if (session === undefined || info === undefined || info === session.info) return;
    const renamed = info.name !== session.info.name;
    session.info = info;

    if (renamed) this.renderer.setTerminalTitle(terminalTitle(info.name ?? undefined));
  }

  /** Point the shell at a session: stop following the old one, watch the new one's head. */
  private async follow(handle: Session): Promise<void> {
    const info = await handle.info();
    const workspace = await this.host.workspace(info.workspace).info();

    if (this.disposed) return;

    if (workspace.target.kind === "local" && "path" in workspace.target)
      this.useWorkspace(workspace.target.path, info.workspace);

    if (this.disposed) return;
    this.shell.dismissInfoPanel?.();
    this.tasks.close();
    this.closeQueue();
    this.asking?.abort();
    this.asking = undefined;
    this.waiting = undefined;
    const previous = this.session;
    const switching = previous !== undefined;
    this.cancelPasteSubmission();
    this.pasting = undefined;
    this.saveDraft();
    previous?.stop();
    this.session = undefined;
    this.pendingVisual = undefined;
    this.shell.view.clear();
    this.shell.setUi("loading", "Loading session…");

    if (switching) this.restoreDraft(info.id);
    let current: FollowedSession | undefined;

    const config = new SessionConfigurator({
      configure: (patch) =>
        handle.configure({
          ...(patch.model === undefined ? {} : { model: patch.model }),
          ...(patch.thinkingLevel === undefined ? {} : { thinking: patch.thinkingLevel }),
        }),
      readSelected: () => selectedConfig(current?.view, this.fallback),
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
      },
    });

    const first = Promise.withResolvers<void>();

    const followed: FollowedSession = {
      sessionId: info.id,
      session: handle,
      info,
      view: undefined,
      config,
      completionCommands: [],
      stop: () => {
        stopWatch();
        config.dispose();
      },
    };

    const stopWatch = follow(
      handle.watch(),
      (view) => {
        if (this.session !== followed) return;
        const previousView = followed.view;
        followed.view = view;
        config.observeSelected(selectedConfig(view, this.fallback));
        this.render(followed, previousView);
        first.resolve();
      },
      (cause) => {
        if (this.session === followed)
          notice(
            this.shell,
            `Session watch failed: ${errorMessage(cause)}`,
            this.shell.theme.error,
          );
        first.resolve();
      },
    );

    current = followed;
    this.session = followed;
    this.tasks.follow(info);
    this.refreshHints();
    await first.promise;

    if (this.session !== followed) return;
    await this.plugins?.switched(previous?.session ?? null, handle);
    this.renderer.setTerminalTitle(terminalTitle(info.name ?? undefined));
    this.noticeUnavailable(info);

    if (!this.disposed && this.session === followed) this.shell.setUi("loading", undefined);
  }

  private noticeUnavailable(info: SessionInfo): void {
    const { activation } = info;

    if (this.session?.sessionId !== info.id) return;

    switch (activation.kind) {
      case "active":
      case "inactive":
        return;
      case "unavailable":
        notice(
          this.shell,
          activation.reason === "unreachable"
            ? "Couldn't reach this session's workspace"
            : "Can't open this session's workspace",
          this.shell.theme.warning,
        );

        return;
      case "failed":
        notice(
          this.shell,
          `Workspace failed to activate: ${activation.message}`,
          this.shell.theme.error,
        );

        return;
      default: {
        const _exhaustive: never = activation;

        return _exhaustive;
      }
    }
  }

  /** The catalog's commands, settings and skills as the slash namespace; badges of current choices lead the status items. */
  private applyCatalog(session: FollowedSession): void {
    const commands = availableSlashCommands(
      commandsOf(session),
      this.slashSettings(session),
      skillsOf(session),
    );

    // Badge-only refreshes must not reset the completion the user selected.
    if (!isDeepStrictEqual(commands, session.completionCommands))
      session.completionCommands = commands;

    const badges = (session.view?.catalog.settings ?? []).flatMap((setting) => {
      const badge = setting.choices?.find((choice) =>
        isDeepStrictEqual(choice.value, setting.value),
      )?.badge;

      return badge === undefined ? [] : [badge];
    });

    patchStatus(this.shell, { statuses: badges });
    this.refreshAutocomplete();
  }

  /**
   * Draw one view, and react to what moved since the last: a run that ended
   * or is retrying, a catalog that reloaded, a prompt that landed.
   */
  private render(session: FollowedSession, previous: SessionView | undefined): void {
    const view = session.view;

    if (view === undefined) return;
    // Reconcile only the latest visual state before a frame.
    this.pendingVisual = {
      session,
      previous: this.pendingVisual === undefined ? previous : this.pendingVisual.previous,
      reset: previous === undefined || this.pendingVisual?.reset === true,
    };
    this.renderer.requestRender();
    this.refreshQuestion();

    if (view.catalog !== previous?.catalog) this.applyCatalog(session);

    if (view.messages !== previous?.messages) this.promptHistory.replace(userPrompts(view));
    const { execution } = view;

    if (previous !== undefined && previous.execution.kind !== "idle" && execution.kind === "idle")
      this.onRunEnded(session, execution.lastRun?.end);

    if (
      execution.kind === "retrying" &&
      (previous?.execution.kind !== "retrying" || previous.execution.until !== execution.until)
    )
      notice(
        this.shell,
        `${retryCause(execution.reason)} Retrying in ${clockDuration(Math.max(0, execution.until - Date.now()))} (attempt ${String(execution.run.attempt)})`,
        this.shell.theme.warning,
      );
  }

  private readonly flushVisual = async (): Promise<void> => {
    const pending = this.pendingVisual;
    this.pendingVisual = undefined;

    if (this.disposed || pending === undefined || this.session !== pending.session) return;
    const { view } = pending.session;

    if (view === undefined) return;
    this.shell.view.sync(view, { key: pending.session.sessionId, reset: pending.reset });

    if (pending.reset) this.restoreShellCards(pending.session);
    const handbacks = this.handbacks.get(pending.session.sessionId);
    const handback = handbacks?.[0];

    if (
      handbacks !== undefined &&
      handback !== undefined &&
      !view.messages.some(
        (message) =>
          message.kind === "user" &&
          message.status.kind === "landed" &&
          message.status.commit === handback.commit,
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

    if (
      view.messages !== pending.previous?.messages ||
      view.execution !== pending.previous?.execution
    )
      this.syncGutter(pending.session);

    if (
      view.configuration !== pending.previous?.configuration ||
      view.context !== pending.previous?.context
    )
      this.refreshStatus(pending.session);

    if (!this.shell.ui.prompting) this.shell.input.placeholder = this.composerPlaceholder(view);

    if (!this.shell.ui.selecting && !this.shell.ui.prompting) this.refreshHints();
  };

  private onRunEnded(session: FollowedSession, end: RunEnd | undefined): void {
    if (end?.kind === "failed")
      notice(this.shell, `Error: ${end.failure.message}`, this.shell.theme.error);
    this.refreshWorkspace();

    // A run stopped before it answered hands its message back to the composer,
    // the same round trip double-escape makes, minus the picker.
    if (
      end?.kind === "stopped" &&
      this.shell.input.plainText.trim() === "" &&
      !this.queueEdits.has(session.sessionId) &&
      session.view !== undefined
    ) {
      const commit = unansweredRequest(session.view);

      if (commit !== undefined) void this.retract(session, commit).catch(this.reportError);
    }
  }

  private async retract(session: FollowedSession, commit: CommitId): Promise<void> {
    const receipt = await session.session.move({ kind: "commit", id: commit });
    const outcome = await receipt.settled();

    if (outcome.kind !== "moved" || outcome.handback === null) return;
    this.stageHandback(session.sessionId, {
      content: outcome.handback,
      commit,
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
    this.pendingVisual ??= { session, previous: session.view, reset: false };
    this.renderer.requestRender();
  }

  private handBack(content: UserContent, told: string): void {
    setInputText(this.shell.input, this.composerParts.load(content));
    this.promptHistory.resetBrowse();

    if (!this.shell.ui.selecting && !this.shell.ui.prompting) this.focusComposer();
    notice(this.shell, told, this.shell.theme.ok);
  }

  /** The question in front of the user: the followed head's, else a child's. */
  private refreshQuestion(): void {
    const session = this.session;

    if (this.disposed || session === undefined) return;
    const own = session.view === undefined ? undefined : openQuestions(session.view)[0];

    const waiting =
      own === undefined ? this.tasks.waiting : { session: session.sessionId, question: own };

    if (waiting?.question.part === this.waiting?.question.part) return;
    this.waiting = waiting;
    this.asking?.abort();

    // The cancelled picker's finally opens the next question after it releases focus.
    if (waiting !== undefined) this.askQuestion(session, waiting);
  }

  /** The open question menu takes the answer itself, so the composer asks for nothing meanwhile. */
  private composerPlaceholder(view: SessionView): string {
    if (this.asking !== undefined) return "";

    if (openQuestions(view).length > 0) return ANSWER_COMPOSER_PLACEHOLDER;

    return this.busy ? BUSY_COMPOSER_PLACEHOLDER : COMPOSER_PLACEHOLDER;
  }

  /**
   * A question accepts one of its options or the user's own words. Escape
   * leaves it open; answering it elsewhere closes the menu.
   */
  private askQuestion(
    session: FollowedSession,
    waiting: { readonly session: SessionId; readonly question: OpenQuestion },
  ): void {
    if (this.asking !== undefined || this.authenticating !== undefined) return;
    this.shell.dismissInfoPanel?.();

    if (this.shell.ui.selecting || this.shell.ui.prompting) return;
    const asking = new AbortController();
    this.asking = asking;
    this.shell.input.placeholder = "";
    void (async () => {
      try {
        const { question } = waiting;

        const title =
          waiting.session === session.sessionId
            ? question.prompt
            : `Subagent ${shortId(waiting.session)}: ${question.prompt}`;

        const reply = await selectSelection(
          this.shell,
          {
            title,
            choices: question.options.map((option) => ({ id: option, label: option })),
            other: "Type an answer",
          },
          { signal: asking.signal, cancelLabel: "later" },
        );

        await this.answer(waiting, reply.other ?? reply.choices[0] ?? "");
      } catch (cause) {
        if (!(cause instanceof PickerCancelled)) throw cause;
      } finally {
        if (this.asking === asking) this.asking = undefined;

        if (this.session?.view !== undefined && !this.shell.ui.prompting)
          this.shell.input.placeholder = this.composerPlaceholder(this.session.view);

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

  /** Answers the question's part. A question already answered or closed is reported, never re-sent as a message. */
  private async answer(
    waiting: { readonly session: SessionId; readonly question: OpenQuestion },
    choice: string,
  ): Promise<void> {
    const outcome = await this.host
      .session(waiting.session)
      .part(waiting.question.part)
      .act("answer", { choice });

    if (outcome.kind !== "ok")
      notice(this.shell, "That question is no longer waiting", this.shell.theme.warning);
  }

  private syncGutter(session: FollowedSession): void {
    const rows = session.view === undefined ? [] : queuedMessages(session.view);
    const running = session.view !== undefined && session.view.execution.kind !== "idle";
    const steering = rows.filter((row) => !running || row.delivery === this.roles.steer);
    const queued = rows.filter((row) => running && row.delivery !== this.roles.steer);
    this.shell.pendingTail.sync(steering, { hint: queued.length === 0, running });
    this.shell.pendingGutter.sync(queued);

    if (this.queueMenu !== undefined || this.queueSelection !== undefined) {
      const choices = this.queueChoices();
      this.queueMenu?.setChoices(choices, this.queueSelection);

      if (choices.some((choice) => choice.id === this.queueSelection))
        this.queueSelection = undefined;
    }

    patchStatus(this.shell, { queued: running ? rows.length : 0 });
  }

  // -------------------------------------------------------------------------
  // Status line
  // -------------------------------------------------------------------------

  private initialStatus(): Partial<PowerlineState> {
    const config = this.config;

    return {
      workspace: basename(this.cwd),
      provider: config.model.provider,
      model: config.model.id,
      effort: config.thinkingLevel,
      statuses: [],
      queued: 0,
    };
  }

  private refreshStatus(session: FollowedSession): void {
    const context = session.view?.context;
    const config = session.config.selected;
    patchStatus(this.shell, {
      provider: config.model.provider,
      model: config.model.id,
      effort: config.thinkingLevel,
      tokens: context?.tokens ?? 0,
      window: context?.window ?? 0,
      pct:
        context === undefined || context.window <= 0
          ? 0
          : Math.round((context.tokens / context.window) * 100),
    });
  }

  private refreshWorkspace(): void {
    const { cwd } = this;
    void readWorkspaceStatus(cwd).then((workspace) => {
      if (!this.disposed && this.cwd === cwd) patchStatus(this.shell, workspace);
    });
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
          { delivery: this.composerActions?.primaryDelivery ?? this.roles.steer },
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
            previous: this.session.view,
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
    // The composer outlives this instance while cleanup waits on its processes.
    // Its content notifications must stop reaching the destroyed dropdown.
    this.disposers.push(() => {
      this.shell.input.onContentChange = previousChange;
      this.autocomplete = undefined;
      autocomplete.destroy();
    });
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
      this.cwd,
      cursor,
    );
  }

  /** Lists the workspace's files for `@` mentions through its files capability, ignored files left out. */
  private async refreshMentionFiles(workspace: WorkspaceId): Promise<void> {
    this.mentionController?.abort();
    const controller = new AbortController();
    this.mentionController = controller;
    const { cwd } = this;

    try {
      const files = await this.host.workspace(workspace).files();

      if (files.kind !== "available") return;
      const found: MentionFile[] = [];

      for await (const frame of files.api.scan({ ignored: "exclude" })) {
        if (controller.signal.aborted || this.disposed) return;

        if (frame.kind !== "entries") continue;

        for (const entry of frame.entries) {
          if (entry.kind === "symlink") continue;
          const folder = entry.kind === "directory" ? "/" : "";
          const path = resolve(cwd, entry.path);

          found.push({
            path: `${path}${folder}`,
            url: pathToFileURL(path).href,
            displayPath: `${entry.path}${folder}`,
            label: `${basename(entry.path)}${folder}`,
          });
        }
      }

      if (controller.signal.aborted || this.disposed) return;
      this.mentionFiles = found;
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
    const { cwd } = this;
    const paste = await resolveComposerPaste(text, cwd);

    if (
      this.disposed ||
      this.cwd !== cwd ||
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

  /** Enter and ctrl+enter both land here; only the delivery differs. */
  private submitComposer(
    action: Extract<ComposerOperation, { readonly delivery: Delivery }>,
  ): void {
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
    action: Extract<ComposerOperation, { readonly delivery: Delivery }>,
    session: FollowedSession,
    reserved?: SubmissionSlot,
  ): Promise<void> {
    const delivery = action.delivery;

    if (action.kind === "save-edit") {
      await this.confirmEdit(session, delivery);

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
      if (delivery !== this.roles.steer) return;
      const waiting = this.waiting;

      if (waiting === undefined) this.steerFirstQueued(session);
      else this.askQuestion(session, waiting);

      return;
    }

    const skills = skillsOf(session);

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

    const captured: ComposerDraft = { text: draft, parts: [...this.composerParts.current] };
    let leading = true;

    const preparing = prompting
      ? this.composerParts.prepare(
          draft,
          (text) => {
            if (commandTarget?.kind !== "skill" || inlineSkills)
              return expandInlineSkills(text, skills);

            // Images split the draft into text segments. Only the first contains
            // the command; subsequent segments keep their arguments verbatim.
            if (!leading) return text;
            leading = false;
            const argument = text.slice(commandTarget.skill.name.length + 1).trimStart();

            return formatSkillInvocation(commandTarget.skill, argument || undefined);
          },
          (bytes) => this.upload(session, bytes),
        )
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
        void this.runCommand(submission.command, { delivery, target: commandTarget }).catch(
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
          // the head, so the message stays unsent, with every part it carried.
          const reason = result.kind === "failed" ? result.message : "configuration changed";
          this.stageHandback(session.sessionId, {
            draft: { text: captured.text, parts: prepared.parts },
            notice: `Message not sent: ${reason}. It is back in the composer.`,
          });

          return;
        }

        await this.send(session, prepared.content, delivery);
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
      cwd: this.cwd,
      signal: this.stopped.signal,
      onUpdate: (execution) => this.syncShell(execution),
    });

    this.shellCommands.set(command.snapshot.id, {
      sessionId: session.sessionId,
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

    if (entry === undefined || this.session?.sessionId !== entry.sessionId) return;
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
      if (entry.retention !== "pending" || entry.sessionId !== this.session?.sessionId) continue;
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
      if (entry.sessionId === session.sessionId) this.syncShell(entry.process.snapshot);
    }

    this.flushShellMarkers();
  }

  /** Uploads pasted image bytes through the session's workspace files, for a message to carry. */
  private async upload(session: FollowedSession, bytes: Uint8Array): Promise<BlobId> {
    const files = await this.host.workspace(session.info.workspace).files();

    if (files.kind !== "available") throw new Error(`Can't attach images here: ${files.reason}`);

    return files.api.upload(
      (async function* () {
        yield bytes;
      })(),
    );
  }

  /** A plain line answers an open question in its own words; anything else is sent. */
  private async send(
    session: FollowedSession,
    content: UserContent,
    delivery: Delivery,
  ): Promise<void> {
    const waiting = this.waiting;

    if (waiting !== undefined && delivery === this.roles.steer) {
      if (typeof content === "string") return this.answer(waiting, content);
      notice(
        this.shell,
        "Attachments can't answer a question; sent as a message",
        this.shell.theme.warning,
      );
    }

    const decision = await this.plugins?.beforeSubmit({
      content,
      delivery,
      session: session.sessionId,
    });

    if (decision?.action === "reject" || decision?.action === "error") {
      notice(
        this.shell,
        decision.action === "reject" ? decision.reason : decision.message,
        this.shell.theme.warning,
      );

      return;
    }

    if (this.session === session) this.scrollToEnd();
    this.remember(
      await session.session.send(decision?.action === "modify" ? decision.value.content : content, {
        delivery: decision?.action === "modify" ? decision.value.delivery : delivery,
      }),
    );
  }

  /** Keeps a send's receipt until it settles, so its message can be withdrawn while queued. */
  private remember(receipt: SendReceipt): void {
    this.receipts.set(receipt.message, receipt);
    void receipt
      .settled()
      .catch(() => undefined)
      .finally(() => this.receipts.delete(receipt.message));
  }

  private scrollToEnd(): void {
    this.shell.view.scrollToEnd();
  }

  private steerFirstQueued(session: FollowedSession): void {
    const next =
      session.view === undefined
        ? undefined
        : nextToSteer(queuedMessages(session.view), this.roles);

    if (next === undefined) return;
    void this.redeliver(session, next).catch(this.reportError);
  }

  /** Sends a queued message now: the same message, revised in place to steer. */
  private async redeliver(session: FollowedSession, message: UserMessage): Promise<void> {
    this.remember(
      await session.session.send(message.content, {
        replace: message.id,
        delivery: this.roles.steer,
      }),
    );
  }

  /** Withdraws a message not yet placed, through the receipt of the send that made it. */
  private async cancelPending(message: MessageId): Promise<boolean> {
    const receipt = this.receipts.get(message);

    if (receipt === undefined) {
      notice(this.shell, "That message was queued elsewhere; it can't be removed here.");

      return false;
    }

    const outcome = await receipt.stop();

    if (outcome.kind === "requested") return true;
    notice(this.shell, "That message was already sent", this.shell.theme.warning);

    return false;
  }

  private queueChoices(): Choice[] {
    const session = this.session;

    if (session?.view === undefined) return [];

    return queuedMessages(session.view).map((row, index) => ({
      id: row.id,
      label: queuedPromptText(row.content),
      description: `${String(index + 1)} · ${row.status.kind === "pending" ? deliveryMark(row.delivery, this.roles, this.shell.theme).label : "sending"}`,
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

  /** The live queue shares the composer's rich parts; edits revise the message in place. */
  private async openQueue(selectedId?: string): Promise<void> {
    const session = this.requireSession();

    if (this.queueMenu !== undefined || this.shell.ui.selecting || this.shell.ui.prompting) return;

    const rows = (): readonly GutterRow[] =>
      session.view === undefined ? [] : queuedMessages(session.view);

    if (rows().length === 0) {
      notice(this.shell, "Nothing is queued");

      return;
    }

    const edit = async (id: string): Promise<void> => {
      const row = rows().find((candidate) => candidate.id === id);

      if (row === undefined) return;

      if (this.queueEdits.has(session.sessionId)) {
        notice(this.shell, "Save or cancel the current queue edit first.");

        return;
      }

      this.queueEdits.set(session.sessionId, {
        message: row.id,
        delivery: row.delivery,
        content: row.content,
        draft: { text: this.shell.input.plainText, parts: this.composerParts.current },
      });
      this.handBack(row.content, "Editing queued message. Enter saves; Esc cancels.");
    };

    const drop = async (id: string): Promise<void> => {
      const row = rows().find((candidate) => candidate.id === id);

      if (row !== undefined && (await this.cancelPending(row.id)))
        notice(this.shell, "Removed from the queue");
    };

    const move = async (id: string, delta: -1 | 1): Promise<void> => {
      const row = rows().find((candidate) => candidate.id === id);

      if (row?.status.kind !== "pending") return;

      const delivery = rows().filter(
        (item) => item.status.kind === "pending" && item.delivery === row.delivery,
      );

      const index = delivery.findIndex((item) => item.id === row.id);

      if (index + delta < 0 || index + delta >= delivery.length) return;
      await this.reorder(session, row, delivery[index + (delta === -1 ? -1 : 2)]?.id ?? null);
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
          const row = rows().find((candidate) => candidate.id === id);
          this.closeQueue();

          if (row?.status.kind === "pending")
            void this.redeliver(session, row).catch(this.reportError);
        },
        onCancel: () => this.closeQueue(),
      },
      this.reportError,
    );
  }

  /** Moves a pending message before another, or to the end of its delivery. */
  private async reorder(
    session: FollowedSession,
    message: UserMessage,
    before: MessageId | null,
  ): Promise<void> {
    this.remember(
      await session.session.send(message.content, {
        replace: message.id,
        delivery: message.delivery,
        position: before === null ? { kind: "last" } : { kind: "before", message: before },
      }),
    );
    this.queueSelection = message.id;
    this.syncGutter(session);
  }

  private cancelEdit(options: { readonly session?: FollowedSession } = {}): void {
    const session = options.session ?? this.session;

    if (session === undefined) return;
    const editing = this.queueEdits.get(session.sessionId);

    if (editing === undefined) return;
    this.queueEdits.delete(session.sessionId);

    if (this.session !== session) {
      this.drafts.save(session.sessionId, editing.draft.text, editing.draft.parts);

      return;
    }

    this.composerParts.restore(editing.draft.parts);
    setInputText(this.shell.input, editing.draft.text);
    this.focusComposer();
  }

  private async confirmEdit(session: FollowedSession, delivery: Delivery): Promise<void> {
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
      const prepared = await this.composerParts.prepare(
        text,
        (value) => expandInlineSkills(value, skillsOf(session)),
        (bytes) => this.upload(session, bytes),
      );

      if (
        delivery === editing.delivery &&
        JSON.stringify(editing.content) === JSON.stringify(prepared.content)
      ) {
        this.cancelEdit({ session });

        return;
      }

      this.remember(
        await session.session.send(prepared.content, { replace: editing.message, delivery }),
      );
      this.cancelEdit({ session });
      notice(this.shell, "Queued message saved.");
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
        const asked = this.view === undefined ? undefined : openQuestions(this.view)[0];

        return {
          busy: this.busy,
          shell: this.activeShell !== undefined,
          shellInput: input?.kind === "shell" ? (input.retain ? "include" : "exclude") : undefined,
          waiting: this.waiting !== undefined || asked !== undefined,
          question: asked !== undefined,
          draft: draft?.kind ?? "empty",
          editingDelivery:
            this.session === undefined
              ? undefined
              : this.queueEdits.get(this.session.sessionId)?.delivery,
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

            if (this.view !== undefined && this.view.execution.kind !== "idle") {
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
      () => {
        this.renderer.off(CliRenderEvents.SELECTION, scheduleHints);
      },
      () => {
        this.renderer.off(CliRenderEvents.RESIZE, scheduleHints);
      },
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
              this.shell.view.scrollToEnd();

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
    this.disposers.push(() => {
      this.renderer.keyInput.off("keypress", onKeyPress);
    });
  }

  private async stopRun(session: FollowedSession): Promise<void> {
    const execution = session.view?.execution;

    if (execution === undefined || execution.kind === "idle") return;
    const { run } = execution;
    let untouched = true;

    const remove = this.shell.keymap.intercept("key", () => {
      untouched = false;
    });

    const active = (): boolean =>
      untouched &&
      !this.disposed &&
      this.session === session &&
      session.view?.execution.kind !== "idle" &&
      !this.shell.ui.selecting &&
      !this.shell.ui.prompting;

    try {
      const outcome = await session.session.run(run.id).stop();

      if (active() && outcome.kind === "missing") notice(this.shell, "No active run to stop.");
      // Only the watcher can report a stopped run or retract its unanswered message.
    } catch (cause) {
      if (active()) this.reportError(cause);
    } finally {
      remove();
    }
  }

  /** The models signed-in providers serve, from the catalog as last read. */
  private get models(): readonly ModelInfo[] {
    return availableModels(this.catalog);
  }

  /** Each press steps from the selected level, so a burst of presses steps that many times. */
  private cycleThinkingLevel(): void {
    const session = this.session;

    if (session === undefined) return;
    void session.config
      .prepareSelection(({ model, thinkingLevel }) => {
        const info = findModel(this.models, model);

        const next =
          info === undefined ? undefined : nextThinkingLevel(thinkingLevel, info.thinking);

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
        const available = this.models;

        if (available.length < 2) return undefined;

        const index = available.findIndex(
          (model) => modelId(model.ref) === modelId(selected.model),
        );

        const model =
          available[index === -1 ? 0 : (index + delta + available.length) % available.length];

        if (model === undefined) return undefined;
        cycled = { model: model.ref, thinkingLevel: clampThinking(model, selected.thinkingLevel) };

        return cycled;
      })
      .then((result) => {
        if (result.kind === "failed") throw new Error(result.message);

        if (result.kind !== "acknowledged" || cycled === undefined || this.session !== session)
          return;
        notice(
          this.shell,
          `Model: ${modelId(cycled.model)} · ${cycled.thinkingLevel}`,
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

  private async changeModel(model: ModelInfo, thinkingLevel?: Thinking): Promise<void> {
    const session = this.requireSession();
    const selected = session.config.selected;

    if (
      !session.config.preparingSelection &&
      modelId(selected.model) === modelId(model.ref) &&
      clampThinking(model, thinkingLevel ?? selected.thinkingLevel) === selected.thinkingLevel
    ) {
      notice(this.shell, `Already using ${model.ref.id}`);

      return;
    }

    const result = await session.config.prepareSelection((choice) => ({
      model: model.ref,
      thinkingLevel: clampThinking(model, thinkingLevel ?? choice.thinkingLevel),
    }));

    if (result.kind === "failed") throw new Error(result.message);

    if (result.kind === "superseded" || this.session !== session) return;
    notice(
      this.shell,
      `Model: ${modelId(model.ref)} · ${session.config.selected.thinkingLevel}`,
      this.shell.theme.ok,
    );
  }

  private async changeThinkingLevel(level: Thinking, announce: boolean): Promise<void> {
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

  /** The head stored a model: it becomes the host's default for the next chat. */
  private persistChoice(choice: RunChoice, patch: ConfigPatch): void {
    if (patch.model === undefined) return;
    void this.host.models.setDefault(choice.model).catch(this.reportError);
  }

  private updateSettings(patch: SettingsPatch): void {
    this.settings = { ...this.settings, ...patch };
    void this.settingsStore.updateGlobal(patch).catch(this.reportError);
  }

  private async changeTheme(mode: ThemeMode): Promise<void> {
    this.themeMode = mode;
    this.shell.setTheme(themeForMode(mode));
    this.autocomplete?.retheme(this.shell.theme);
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

  /**
   * Moves the session to another folder: registers it as a workspace, as the
   * owner adding it is the consent, then relocates the idle session there.
   */
  private async changeDirectory(argument: string): Promise<void> {
    if (argument === "") throw new Error("Directory is required. Use /cd <path>.");

    if (this.switchingSession || this.changingDirectory)
      throw new Error("A chat switch is already in progress.");
    const session = this.requireSession();

    if (session.view !== undefined && queuedMessages(session.view).length > 0)
      throw new Error("Wait for queued messages before changing directories.");
    this.changingDirectory = true;

    try {
      const path =
        argument === "~"
          ? homedir()
          : argument.startsWith("~/")
            ? resolve(homedir(), argument.slice(2))
            : resolve(this.cwd, argument);

      if (path === this.cwd) {
        notice(this.shell, `Already in ${path}`);

        return;
      }

      const seen = await this.host.workspaces.inspect({ kind: "local", path });

      const added = await this.host.workspaces.add(seen.target, {
        expect: { identity: seen.identity },
      });

      if (added.kind === "stale")
        throw new Error(`${path} changed while it was opened; try again.`);

      if (added.kind === "unavailable") throw new Error(`Couldn't open ${path}: ${added.reason}`);
      const outcome = await session.session.update({ workspace: added.workspace });

      if (outcome.kind === "busy")
        throw new Error("Wait for active runs and jobs to finish before changing directories.");

      if (outcome.kind !== "updated") throw new Error(`Couldn't open ${path} for this session.`);

      if (this.disposed || this.session !== session) return;
      session.info = await session.session.info();
      this.useWorkspace(path, added.workspace);
      notice(this.shell, `Working directory: ${path}`, this.shell.theme.ok);
    } finally {
      this.changingDirectory = false;
    }
  }

  /** Points the footer, the `!` commands and the `@` index at a session's folder. */
  private useWorkspace(cwd: string, workspace: WorkspaceId): void {
    if (this.disposed || (cwd === this.cwd && this.mentionFiles.length > 0)) return;
    this.mentionController?.abort();
    this.cwd = cwd;
    patchStatus(this.shell, { workspace: basename(cwd), branch: undefined, dirty: false });
    this.refreshWorkspace();
    this.mentionFiles = [];
    this.autocomplete?.close();
    void this.refreshMentionFiles(workspace);
  }

  /** Re-reads the workspace's project resources and this terminal's own settings. */
  private async reloadWorkspace(): Promise<void> {
    if (this.changingDirectory || this.switchingSession) return;
    const session = this.requireSession();
    const outcome = await this.host.workspace(session.info.workspace).reload();

    if (outcome.kind === "missing")
      throw new Error("This chat's workspace is no longer registered.");
    const { cwd } = this;
    const settings = await this.settingsStore.read(cwd);

    if (this.disposed || this.cwd !== cwd || this.session !== session) return;
    this.settings = settings;
    this.shell.setScrollAcceleration(settings.scrollAcceleration);
    const mode = resolveThemeMode(settings.theme, this.renderer.themeMode);

    if (mode !== this.themeMode) {
      this.themeMode = mode;
      this.shell.setTheme(themeForMode(mode));
      this.autocomplete?.retheme(this.shell.theme);
    }

    this.refreshHints();
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

  private async switchSession(load: () => Promise<Session>, announce: boolean): Promise<void> {
    if (this.switchingSession || this.changingDirectory)
      throw new Error("A chat switch is already in progress");
    this.switchingSession = true;
    this.shell.setUi("loading", "Loading session…");
    this.renderer.requestRender();

    try {
      await this.renderer.idle();
      if (this.disposed) return;
      const handle = await load();

      if (this.disposed) return;
      await this.follow(handle);

      if (this.disposed) return;
      if (!this.shell.ui.selecting) this.focusComposer();

      if (announce) {
        const session = this.requireSession();
        notice(
          this.shell,
          `Resumed ${shortId(handle.id)} · ${String(session.view?.turns.length ?? 0)} turns`,
        );
      }
    } finally {
      this.switchingSession = false;
      if (!this.disposed) this.shell.setUi("loading", undefined);
    }
  }

  private async resumeSession(): Promise<void> {
    const current = this.requireSession();
    let listed: readonly SessionInfo[] = [];

    const chosen = await selectChoice(this.shell, "Resume chat", [], {
      selectedId: current.sessionId,
      emptyLabel: "No saved chats",
      load: async () => {
        const { items } = await this.host.sessions.list({ parents: { kind: "roots" } });
        listed = items;

        return items
          .filter((session) => session.heads.some((head) => head.tip.kind !== "start"))
          .toSorted((left, right) => right.lastActivityAt - left.lastActivityAt)
          .map((session) => {
            const title = session.name ?? shortId(session.id);
            const currentLabel = session.id === current.sessionId ? " (current)" : "";
            const savedAt = new Date(session.lastActivityAt).toLocaleString();

            return {
              id: session.id,
              label: `${title}${currentLabel}`,
              description: `${savedAt} · ${shortId(session.id)}`,
            };
          });
      },
    });

    if (chosen === current.sessionId) {
      notice(this.shell, `Already in ${shortId(chosen)}`);

      return;
    }

    const info = listed.find((session) => session.id === chosen);

    if (info === undefined) throw new Error(`Session not found: ${chosen}`);
    await this.switchSession(async () => this.host.session(info.id), true);
  }

  // -------------------------------------------------------------------------
  // Tree navigation
  // -------------------------------------------------------------------------

  private selectTreeCommit(
    options: ConstructorParameters<typeof TreeSelector>[1],
  ): Promise<CommitId> {
    const restoredHints = this.shell.ui.hints;

    return new Promise<CommitId>((resolveSelection, reject) => {
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
            onError: (cause) => settle(() => reject(cause)),
          },
          options,
        ),
      );
    });
  }

  /** pi's "Summarize branch?" question. Escape hands the tree back. */
  private async askSummary(): Promise<
    | { readonly kind: "chosen"; readonly summary?: { readonly instructions?: string } }
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
          summary: focus.trim() === "" ? {} : { instructions: focus.trim() },
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
    readonly selectedOid?: CommitId;
  }): Promise<void> {
    const session = this.requireSession();

    if (this.busy) throw new Error("Wait for the current run before changing the session branch");
    let tree: TreeView | undefined;
    let picked: CommitId;

    try {
      picked = await this.selectTreeCommit({
        load: async () => {
          tree = await session.session.tree();

          return tree;
        },
        filter: options.filter ?? "default",
        ...(options.selectedOid === undefined ? {} : { selectedOid: options.selectedOid }),
      });
    } catch (cause) {
      if (cause instanceof PickerCancelled) return;
      throw cause;
    }

    const nodes = new Map((tree?.nodes ?? []).map((node) => [node.id, node]));
    const selected = nodes.get(picked);
    const tip = tree?.tip.kind === "commit" ? tree.tip.id : null;

    if (tree === undefined || selected === undefined)
      throw new Error(`Commit not found: ${picked}`);

    if (picked === tip) {
      notice(this.shell, "Already at that point in the chat");

      return;
    }

    if (selected.kind === "user" && this.shell.input.plainText.trim() !== "") {
      throw new Error("Clear the composer before editing a message");
    }

    const again = (): Promise<void> => this.openTree({ ...options, selectedOid: picked });
    let summary: { readonly instructions?: string } | undefined;
    let ancestor: CommitId | null = picked;

    while (ancestor !== null && ancestor !== tip) ancestor = nodes.get(ancestor)?.parent ?? null;

    if (tip !== null && ancestor !== tip) {
      const answer = await this.askSummary();

      if (answer.kind === "back") return again();
      summary = answer.summary;
    }

    const receipt = await session.session.move(
      { kind: "commit", id: picked },
      {
        running: "refuse",
        abandoned: summary === undefined ? "keep" : { summarize: summary },
        expect: tree.revision,
      },
    );

    const outcome = await receipt.settled();

    switch (outcome.kind) {
      case "moved":
        if (outcome.handback !== null) {
          this.stageHandback(session.sessionId, {
            content: outcome.handback,
            commit: picked,
            notice: "Message moved back to the composer. Enter sends it again.",
          });

          return;
        }

        notice(this.shell, "Moved. The next message starts a branch here.", this.shell.theme.ok);
        this.focusComposer();

        return;
      case "busy":
        throw new Error("Wait for the current run");
      case "pending-input":
        throw new Error("Send or remove the queued messages first");
      case "stale":
        throw new Error("The chat moved on while the tree was open; try again");
      case "missing-target":
        throw new Error(`Commit not found: ${picked}`);
      case "summary-failed":
        throw new Error(outcome.reason);
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
      commandsOf(session),
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
    const pluginRows = (session.view?.catalog.settings ?? []).flatMap((setting): SettingRow[] =>
      setting.choices === null ? [] : [this.pluginSettingRow(session, setting, setting.choices)],
    );

    const effortModel = (): ModelInfo | undefined => findModel(this.models, this.config.model);

    return [
      {
        id: "model",
        label: "Model",
        current: () => modelId(this.config.model),
        choices: () => modelChoices(this.catalog),
        load: async () => {
          this.catalog = await this.host.models.list();

          return modelChoices(this.catalog);
        },
        open: () => this.pickModel(),
        apply: (choiceId) => this.changeModelChoice(choiceId),
      },
      {
        id: "effort",
        label: "Thinking level",
        current: () => this.config.thinkingLevel,
        choices: () =>
          (effortModel()?.thinking ?? []).map((level) => ({ id: level, label: level })),
        apply: async (choiceId) => {
          const level = effortModel()?.thinking.find((candidate) => candidate === choiceId);

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

  /**
   * A plugin setting with labelled choices as a row: each choice's id is its
   * value as JSON. A session setting configures the head; a host setting is
   * applied on the host.
   */
  private pluginSettingRow(
    session: FollowedSession,
    setting: SettingInfo,
    choices: NonNullable<SettingInfo["choices"]>,
  ): SettingRow {
    return {
      id: setting.id,
      label: setting.label,
      current: () => JSON.stringify(setting.value),
      choices: () =>
        choices.map((choice) => ({ id: JSON.stringify(choice.value), label: choice.label })),
      apply: async (choiceId) => {
        const value: Json | undefined = choices.find(
          (choice) => JSON.stringify(choice.value) === choiceId,
        )?.value;

        if (value === undefined) throw new Error(`Unknown ${setting.label}: ${choiceId}`);

        if (setting.scope === "session") {
          const outcome = await session.session.configure({ settings: { [setting.id]: value } });

          if (outcome.kind !== "configured") throw new Error(`Could not set ${setting.label}`);

          return;
        }

        const outcome = await this.host.settings.apply(setting.id, value);

        if (outcome.kind !== "applied") throw new Error(`Could not set ${setting.label}`);
      },
    };
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

    const items = [...skillsOf(session).values()]
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
        models: this.models,
        current: this.config.model,
        thinkingLevel: this.config.thinkingLevel,
        load: async () => {
          this.catalog = await this.host.models.list();

          return this.models;
        },
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
      const choice = { model: selection.model, thinkingLevel: selection.thinkingLevel };

      unchanged =
        modelId(selected.model) === modelId(choice.model) &&
        selected.thinkingLevel === choice.thinkingLevel;

      return unchanged ? undefined : choice;
    });

    if (this.disposed || this.session !== session) return;

    if (result.kind === "failed") throw new Error(result.message);

    if (result.kind !== "acknowledged" && !unchanged) return;

    notice(
      this.shell,
      `Model: ${modelId(selection.model)} · ${selection.thinkingLevel}`,
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
    const model = this.models.find((candidate) => modelId(candidate.ref) === choiceId);

    if (model === undefined) throw new Error(`Model is no longer available: ${choiceId}`);
    await this.changeModel(model);
  }

  /** The login driver over the shell: pickers for choices, a masked field for keys and codes. */
  private loginDriver(signal: AbortSignal): LoginDriver {
    return {
      signal,
      open: (url, code) => {
        if (signal.aborted || this.disposed) return;
        this.authenticationLink = { url, copy: code ?? url };
        this.refreshHints();
        notice(
          this.shell,
          code === undefined
            ? ["Open this URL to continue:", url]
            : [`Visit ${url} and enter the code ${code}`],
        );
        void open(url).catch(() => undefined);
      },
      paste: (message, secret) => readAuthPrompt(this.shell, { message, secret }, signal),
      choose: (message, options) =>
        selectChoice(this.shell, message, options, {
          signal,
          selectedId: this.config.model.provider,
        }),
      progress: (message) => {
        if (signal.aborted || this.disposed) return;
        this.authenticationLink = undefined;
        this.refreshHints();
        notice(this.shell, message);
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
    const current = this.config.model;
    const driver = this.loginDriver(signal);

    try {
      const providerId =
        argument === ""
          ? await selectChoice(
              this.shell,
              action === "login" ? "Sign in to a provider" : "Remove a stored credential",
              authProviderChoices(this.catalog, action),
              {
                signal,
                emptyLabel:
                  action === "login" ? "No providers support login" : "No stored credentials",
              },
            )
          : argument;

      const wasSignedOut = findModel(this.models, current) === undefined;
      const input = { connection: this.host, driver, providerId };

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
        if (action === "login") await this.host.models.refresh(result.provider.id);
        this.catalog = await this.host.models.list();

        if (signal.aborted || this.disposed || this.session !== session) return;

        if (modelId(this.config.model) !== modelId(current)) return;

        if (action === "login" ? !wasSignedOut : findModel(this.models, current) !== undefined)
          return;

        if (action === "logout" && result.provider.id !== current.provider) return;

        const candidates =
          action === "login"
            ? this.models.filter((model) => model.ref.provider === result.provider.id)
            : this.models;

        const first = candidates[0];

        if (first === undefined) {
          notice(
            this.shell,
            [
              result.message,
              this.models.length === 0
                ? "No authenticated models available. /login connects a provider; /model refreshes the catalog."
                : "No models available for this provider. /model selects another.",
            ],
            this.shell.theme.warning,
          );

          return;
        }

        await this.changeModel(first);
        notice(this.shell, [result.message, `Model: ${modelId(first.ref)}`], this.shell.theme.ok);
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

  private openUsage(): void {
    const { view } = this.requireSession();

    if (view === undefined || this.disposed || this.shell.ui.selecting || this.shell.ui.prompting)
      return;

    const close = (): void => {
      if (this.shell.dismissInfoPanel !== close) return;
      this.shell.dismissInfoPanel = undefined;

      if (panel.container.isDestroyed) return;
      closePanel(this.shell, panel);
      this.refreshHints();
    };

    const panel = openPanel(
      this.shell,
      new UsagePanel(this.shell, usageCard(view, this.catalog), close, (rows) =>
        setSlotRows(this.shell, rows),
      ),
    );

    this.shell.dismissInfoPanel = close;
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

    if (commandsOf(session).get(name)?.side === "core") return { kind: "plugin" };
    const skill = skillsOf(session).get(name);

    return skill === undefined ? { kind: "message" } : { kind: "skill", skill };
  }

  private async runCommand(
    parsed: ParsedSlashCommand,
    options: { readonly delivery?: Delivery; readonly target?: SlashTarget } = {},
  ): Promise<void> {
    const session = this.requireSession();

    if (this.changingDirectory || this.switchingSession)
      throw new Error("Wait for the workspace switch to finish.");

    if (this.authenticating !== undefined)
      throw new Error("Finish signing in or out first. Esc cancels.");
    const delivery = options.delivery ?? this.roles.steer;
    const target = options.target ?? this.resolveTarget(session, parsed.name);

    const asMessage = (): Promise<void> =>
      this.send(
        session,
        `/${parsed.name}${parsed.argument === "" ? "" : ` ${parsed.argument}`}`,
        delivery,
      );

    switch (target.kind) {
      case "plugin": {
        const outcome = await session.session.command(
          parsed.name,
          parsed.argument === "" ? undefined : parsed.argument,
        );

        switch (outcome.kind) {
          case "ran":
            if (outcome.output !== null) notice(this.shell, outcome.output);

            return;
          case "sent":
            return;
          case "unknown":
            await asMessage();

            return;
          case "invalid":
            throw new Error(outcome.issues.map((issue) => issue.message).join("; "));
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
          delivery,
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
        await this.switchSession(
          () => this.host.sessions.create({ workspace: session.info.workspace }),
          false,
        );

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

        const outcome = await session.session.compact(
          argument === "" ? undefined : { instructions: argument },
        );

        if (this.disposed || this.session !== session) return;

        switch (outcome.kind) {
          case "started":
            return;
          case "nothing-to-compact":
            notice(this.shell, "Nothing to compact");

            return;
          case "busy":
            throw new Error("Wait for the current run before compacting");
          default: {
            const _exhaustive: never = outcome;

            return _exhaustive;
          }
        }
      }

      case "usage":
        noArgument();
        this.openUsage();

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
        const rows = this.hostView?.plugins ?? [];

        const lines = [
          ...(this.plugins?.ids ?? []).map((id) => `${id} client`),
          ...rows.map((plugin) => {
            const where = plugin.path === null ? plugin.source : `${plugin.source} ${plugin.path}`;
            const issues = plugin.issues.map((issue) => issue.message).join("; ");

            return issues === "" ? `${plugin.id} ${where}` : `${plugin.id} ${where}: ${issues}`;
          }),
        ];

        const commands = [...commandsOf(session).keys()];

        if (commands.length > 0)
          lines.push(`Commands: ${commands.map((command) => `/${command}`).join(" ")}`);
        openDiagnosticReport(
          this.shell,
          "Plugins",
          lines.length === 0 ? ["No plugins"] : lines,
          () => this.refreshHints(),
        );

        return;
      }

      case "reload": {
        noArgument();
        notice(this.shell, "Reloading…");
        this.renderer.requestRender();
        await this.renderer.idle();
        await this.reloadWorkspace();
        const skills = skillsOf(session).size;
        notice(
          this.shell,
          `Reloaded this workspace's resources · ${String(skills)} ${skills === 1 ? "skill" : "skills"}`,
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
  | { readonly kind: "skill"; readonly skill: SkillInfo }
  | { readonly kind: "message" };
