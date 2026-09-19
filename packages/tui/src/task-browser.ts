import type { JobInfo, Nyte, SessionEvent, SessionId } from "@nyte-ai/core";
import { BoxRenderable, ScrollBoxRenderable, StyledText, TextRenderable, fg } from "@opentui/core";
import { GLYPHS, keycap } from "./constants.ts";
import { formatDuration } from "./format.ts";
import { registerChatLayer } from "./keymap.ts";
import type { InlineMenu, MenuScreen } from "./picker.ts";
import { waitingCall } from "@nyte-ai/client";
import type { SessionState } from "@nyte-ai/client";
import { closePanel, notice, openInlineMenu, setHints } from "./app/ui.ts";
import type { Shell } from "./app/ui.ts";

import {
  TaskIndex,
  backgroundJob,
  projectTasks,
  statusMark,
  taskAgent,
  taskElapsedMs,
  taskLabel,
  taskStatus,
  taskActivity,
  unfinishedTask,
  canStopTask,
} from "./tasks.ts";
import type { Task } from "./tasks.ts";
import { ToolOutputExpansion, TranscriptView } from "./transcript.ts";
import type { Transcript } from "./transcript.ts";

class TaskInspector {
  readonly container: BoxRenderable;
  readonly scroll: ScrollBoxRenderable;
  private readonly heading: TextRenderable;
  private readonly metadata: TextRenderable;
  private readonly transcript: Transcript;
  private readonly view: TranscriptView;
  private output: TextRenderable | undefined;
  private id: string | undefined;

  private readonly shell: Shell;

  constructor(shell: Shell) {
    this.shell = shell;
    this.container = new BoxRenderable(shell.renderer, {
      id: shell.nextId("task-inspector"),
      flexDirection: "column",
      flexGrow: 1,
      minHeight: 0,
      backgroundColor: shell.theme.background,
    });
    this.heading = new TextRenderable(shell.renderer, {
      id: shell.nextId(),
      height: 1,
      marginLeft: 3,
      marginTop: 1,
      wrapMode: "none",
      truncate: true,
    });
    this.metadata = new TextRenderable(shell.renderer, {
      id: shell.nextId(),
      height: 1,
      marginLeft: 3,
      marginBottom: 1,
      wrapMode: "none",
      truncate: true,
    });
    this.scroll = new ScrollBoxRenderable(shell.renderer, {
      id: shell.nextId(),
      flexGrow: 1,
      minHeight: 0,
      scrollX: false,
      scrollY: true,
      stickyScroll: true,
      stickyStart: "bottom",
      scrollAcceleration: shell.newScrollAcceleration(),
      paddingLeft: 1,
      paddingRight: 1,
    });
    this.container.add(this.heading);
    this.container.add(this.metadata);
    this.container.add(this.scroll);
    const toolOutput = new ToolOutputExpansion();
    toolOutput.toggle();
    this.transcript = { ...shell.transcript, container: this.scroll, toolOutput };
    this.view = new TranscriptView(this.transcript);
  }

  show(task: Task): void {
    const { theme } = this.shell;
    const status = taskStatus(task);
    const mark = statusMark(status);
    const elapsed = taskElapsedMs(task, Date.now());
    this.heading.content = new StyledText([
      fg(theme.accent)("Tasks"),
      fg(theme.muted)(" │ "),
      fg(theme[mark.tone])(mark.glyph),
      fg(theme.foreground)(` ${taskAgent(task)}`),
      fg(theme.muted)(" │ "),
      fg(theme.foreground)(taskLabel(task)),
    ]);
    this.metadata.content = new StyledText([
      fg(theme.dim)(
        [
          status,
          task.kind === "job" && backgroundJob(task.job) ? "background" : undefined,
          ...(task.kind === "agent"
            ? [task.state.config.model?.id, task.state.config.thinkingLevel]
            : []),
          elapsed === undefined ? undefined : formatDuration(Math.max(0, elapsed)),
        ]
          .filter((value) => value !== undefined)
          .join(" · "),
      ),
    ]);
    if (this.id !== `${task.kind}:${task.id}`) {
      this.output?.destroyRecursively();
      this.output = undefined;
      this.view.clear();
      this.id = `${task.kind}:${task.id}`;
      this.scroll.scrollTo(0);
    }
    if (task.kind === "agent") {
      this.view.sync(task.state);
    } else {
      if (this.output === undefined) {
        this.output = new TextRenderable(this.shell.renderer, {
          fg: theme.foreground,
          wrapMode: "word",
        });
        this.scroll.add(this.output);
      }
      this.output.content = task.job.output || "No output yet.";
    }
  }

  focus(): void {
    this.scroll.focus();
  }
  blur(): void {
    this.scroll.blur();
  }
  destroy(): void {
    this.view.clear();
    this.container.parent?.remove(this.container);
    this.container.destroyRecursively();
  }
}

interface TaskBrowserOptions {
  readonly shell: Shell;
  readonly nyte: Nyte;
  readonly onChange?: () => void;
  readonly onClose: () => void;
  readonly onError: (cause: unknown) => void;
}

function foregroundJob(job: JobInfo): boolean {
  return job.phase.kind === "running" && job.phase.mode === "foreground";
}

/** Session-owned jobs stay alive when their menu or output view closes. */
export class TaskBrowser {
  private readonly options: TaskBrowserOptions;
  private state: SessionState | undefined;
  private jobs: readonly JobInfo[] = [];
  private rows: readonly Task[] = [];
  private menu: InlineMenu | undefined;
  private inspector: { view: TaskInspector; id: string; unregister: () => void } | undefined;
  private index: TaskIndex | undefined;
  private finished = false;
  private menuHasTasks = false;
  private generation = 0;
  private request = 0;
  private backgrounding = false;

  constructor(options: TaskBrowserOptions) {
    this.options = options;
    options.shell.transcript.tasks = () => this.rows;
    options.shell.taskStatus.onMouseDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.open();
    };
  }

  update(state: SessionState, event?: SessionEvent): void {
    const changedSession = this.state?.sessionId !== state.sessionId;
    const previousWaiting = this.state === undefined ? undefined : waitingCall(this.state);
    if (changedSession) {
      this.close();
      this.generation += 1;
      this.jobs = [];
      this.index?.close();
      this.index = new TaskIndex({
        nyte: this.options.nyte,
        onChange: () => this.updateTasks(),
        onError: this.options.onError,
      });
    }
    this.state = state;
    this.index?.update(state, event);
    if (event?.kind === "job") {
      const jobs = new Map(this.jobs.map((job) => [job.id, job]));
      jobs.set(event.job.id, event.job);
      this.jobs = [...jobs.values()];
    }
    if (changedSession || event?.kind === "job") this.updateTasks();
    // Parent questions must still notify the host without repainting unchanged tasks.
    else if (previousWaiting?.waitId !== waitingCall(state)?.waitId) this.options.onChange?.();
    if (changedSession || event === undefined || event.kind === "synced") {
      void this.refresh().catch(this.options.onError);
    }
  }

  private async refresh(): Promise<void> {
    const state = this.state;
    if (state === undefined) return;
    const generation = this.generation;
    const request = ++this.request;
    const before = new Map(this.jobs.map((job) => [job.id, job]));
    const listed = await this.options.nyte.jobs.list({ sessionId: state.sessionId });
    if (generation !== this.generation || request !== this.request) return;
    const merged = new Map(listed.map((job) => [job.id, job]));
    // A watch update received during the read wins, even within the same clock tick.
    for (const job of this.jobs) {
      if (job !== before.get(job.id)) merged.set(job.id, job);
    }
    this.jobs = [...merged.values()];
    this.updateTasks();
  }

  async backgroundForeground(): Promise<void> {
    if (this.backgrounding) return;
    const state = this.state;
    if (state === undefined) return;
    this.backgrounding = true;
    const generation = this.generation;
    try {
      const jobs = await this.options.nyte.jobs.list({
        sessionId: state.sessionId,
        head: state.head,
      });
      if (generation !== this.generation) return;
      const foreground = jobs.filter(foregroundJob);
      if (foreground.length === 0) {
        notice(this.options.shell, "No foreground work to background.");
        return;
      }
      for (const job of foreground) {
        if (generation !== this.generation) return;
        await this.act(state.sessionId, job.id, "background");
      }
    } finally {
      this.backgrounding = false;
    }
  }

  get tasks(): readonly Task[] {
    return this.rows;
  }

  private updateTasks(): void {
    this.rows = projectTasks(this.index?.states ?? [], this.jobs);
    this.repaint();
  }

  get hasTasks(): boolean {
    return this.tasks.length > 0;
  }

  /** Foreground work is not a task row, but it is what Ctrl+Z moves. */
  get hasForegroundWork(): boolean {
    return this.jobs.some(foregroundJob);
  }

  get waiting() {
    for (const state of this.index?.states ?? []) {
      const waiting = waitingCall(state);
      if (waiting !== undefined) return waiting;
    }
    return undefined;
  }

  private screen(): MenuScreen {
    return {
      title: this.finished ? "Tasks · Finished" : "Tasks",
      choices: this.choices(),
      selectLabel: "inspect",
      cancelLabel: this.finished ? "back" : "close",
      actions: this.finished
        ? []
        : [
            {
              command: "chat.job.background",
              label: "background",
              keepOpen: true,
              run: (id) => this.selectedAction(id, "background"),
            },
            {
              command: "chat.task.stop",
              label: "cancel",
              keepOpen: true,
              run: (id) => this.selectedAction(id, "cancel"),
            },
          ],
      onSelect: (id) => {
        if (id === "section:finished" || id === "section:active")
          this.showSection(id === "section:finished");
        else this.inspect(id);
      },
      onCancel: () => {
        if (this.finished) this.showSection(false);
        else this.close();
      },
    };
  }

  private showSection(finished: boolean): void {
    this.finished = finished;
    this.menuHasTasks = this.tasks.some((task) => unfinishedTask(task) !== this.finished);
    this.menu?.show(this.screen());
    if (this.menu !== undefined) setHints(this.options.shell, this.menu.hints);
  }

  open(): void {
    const { shell } = this.options;
    if (this.menu !== undefined || shell.ui.selecting || shell.ui.prompting) return;
    this.index?.discover();
    this.finished = false;
    this.menuHasTasks = this.tasks.some(unfinishedTask);
    this.menu = openInlineMenu(shell, this.screen(), this.options.onError);
    shell.dismissInfoPanel = () => this.close();
    setHints(shell, this.menu.hints);
    const menu = this.menu;
    void this.refresh().catch((cause) => {
      if (this.menu !== menu) return;
      this.close();
      this.options.onError(cause);
    });
  }

  close(): void {
    this.back();
    if (this.menu === undefined) return;
    const menu = this.menu;
    this.menu = undefined;
    this.options.shell.dismissInfoPanel = undefined;
    closePanel(this.options.shell, menu);
    this.options.onClose();
  }

  dispose(): void {
    this.generation += 1;
    this.state = undefined;
    this.close();
    this.index?.close();
    this.rows = [];
    this.options.shell.taskStatus.onMouseDown = undefined;
  }

  private choices() {
    const tasks = this.tasks;
    const now = Date.now();
    return [
      ...tasks
        .filter((task) => unfinishedTask(task) !== this.finished)
        .map((task) => {
          const mark = statusMark(taskStatus(task));
          const elapsed = taskElapsedMs(task, now);
          return {
            id: task.id,
            mark: { text: mark.glyph, tone: mark.tone },
            label: `${task.kind === "job" && backgroundJob(task.job) ? `${GLYPHS.steer} ` : ""}${taskAgent(task)} · ${taskLabel(task)}`,
            description: [
              elapsed === undefined ? undefined : formatDuration(Math.max(0, elapsed)),
              ...(task.kind === "agent"
                ? [task.state.config.model?.id, task.state.config.thinkingLevel]
                : []),
            ]
              .filter((value) => value !== undefined)
              .join(" · "),
            status: { text: taskActivity(task), tone: "dim" as const },
          };
        }),
      {
        id: this.finished ? "section:active" : "section:finished",
        label: this.finished
          ? "Back to Tasks"
          : `Finished · ${tasks.filter((task) => !unfinishedTask(task)).length}`,
      },
    ];
  }

  private repaint(): void {
    const { shell } = this.options;
    const active = this.tasks.filter((task) =>
      task.kind === "job" ? backgroundJob(task.job) : unfinishedTask(task),
    ).length;
    shell.taskStatus.visible = active > 0;
    // A background child waiting on the user outranks the count: it is the one thing to act on.
    const mark = statusMark(this.waiting === undefined ? "running" : "waiting");
    shell.taskStatus.content = new StyledText([
      fg(shell.theme[mark.tone])(`${mark.glyph} `),
      fg(shell.theme.foreground)(
        this.waiting === undefined
          ? `${active} running in background`
          : "a background task needs your answer",
      ),
      fg(shell.theme.dim)(` · ${keycap("chat.history.next", "symbol")} view`),
    ]);
    this.repaintMenu();
    const inspector = this.inspector;
    if (inspector !== undefined) {
      const task = this.tasks.find((candidate) => candidate.id === inspector.id);
      if (task !== undefined) {
        inspector.view.show(task);
        setHints(
          shell,
          [
            `${keycap("chat.interrupt")} back`,
            `${keycap("chat.history.previous", "symbol")}${keycap("chat.history.next", "symbol")} scroll`,
            ...(canStopTask(task) ? [`${keycap("chat.task.stop")} cancel`] : []),
            ...(task.kind === "job" && foregroundJob(task.job)
              ? [`${keycap("chat.job.background")} background`]
              : []),
            `${keycap("chat.tools.toggle")} follow`,
          ].join(" · "),
        );
      }
    }
    this.options.onChange?.();
  }

  private repaintMenu(): void {
    if (this.menu === undefined || this.inspector !== undefined) return;
    const choices = this.choices();
    this.menu.setChoices(choices, this.menuHasTasks ? undefined : choices[0]?.id);
    this.menuHasTasks = choices.length > 1;
  }

  private async selectedAction(id: string, action: "background" | "cancel"): Promise<void> {
    const state = this.state;
    const task = this.tasks.find((candidate) => candidate.id === id);
    if (state === undefined || task === undefined) return;
    if (this.inspector === undefined) this.close();
    if (task.kind === "agent") {
      if (action !== "cancel" || !canStopTask(task)) return;
      notice(this.options.shell, "Cancellation requested.");
      await this.options.nyte.runs.abort({
        sessionId: task.state.sessionId,
        head: task.state.head,
      });
      return;
    }
    if (task.job.phase.kind !== "running") {
      notice(this.options.shell, "This task has already finished. /tasks opens its output.");
      return;
    }
    if (action === "background" && backgroundJob(task.job)) {
      notice(this.options.shell, "This task is already running in background.");
      return;
    }
    await this.act(state.sessionId, task.job.id, action);
  }

  private async act(
    sessionId: SessionId,
    jobId: string,
    action: "background" | "cancel",
  ): Promise<void> {
    const generation = this.generation;
    // The request is acknowledged before the host works on it; the notice
    // stands unless the host answers that there was nothing to do.
    notice(
      this.options.shell,
      action === "background"
        ? "Running in background. /tasks to inspect."
        : "Cancellation requested.",
    );
    const outcome = await this.options.nyte.jobs[action]({ sessionId, jobId });
    if (generation !== this.generation) return;
    switch (outcome.kind) {
      case "applied":
        break;
      case "not_found":
        notice(this.options.shell, "This task is no longer available.");
        break;
      case "finished":
        notice(this.options.shell, "This task has already finished. /tasks opens its output.");
        break;
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
    await this.refresh();
  }

  private inspect(id: string): void {
    const { shell } = this.options;
    const menu = this.menu;
    if (menu === undefined || this.inspector !== undefined) return;
    const task = this.tasks.find((candidate) => candidate.id === id);
    if (task === undefined) return;
    const view = new TaskInspector(shell);
    const scroll = view.scroll;
    menu.container.visible = false;
    shell.setUi("screen", view.container);
    shell.focus.use(view);
    const unregister = registerChatLayer(shell.keymap, {
      enabled: () => this.inspector !== undefined,
      commands: {
        "chat.task.stop": {
          title: "Cancel task",
          run: () => {
            void this.selectedAction(this.inspector?.id ?? id, "cancel").catch(
              this.options.onError,
            );
            return true;
          },
        },
        "chat.job.background": {
          title: "Background task",
          run: () => {
            void this.selectedAction(this.inspector?.id ?? id, "background").catch(
              this.options.onError,
            );
            return true;
          },
        },
        "chat.tools.toggle": {
          title: "Follow output",
          run: () => {
            scroll.scrollTo(scroll.scrollHeight);
            return true;
          },
        },
        "chat.message.previous": { title: "Previous task", run: () => this.adjacent(-1) },
        "chat.message.next": { title: "Next task", run: () => this.adjacent(1) },
        "chat.interrupt": {
          title: "Back to Tasks",
          run: () => {
            this.back();
            return true;
          },
        },
        "chat.history.previous": {
          title: "Scroll up",
          run: () => {
            scroll.scrollBy(-1);
            return true;
          },
        },
        "chat.history.next": {
          title: "Scroll down",
          run: () => {
            scroll.scrollBy(1);
            return true;
          },
        },
        "chat.scroll.page.up": {
          title: "Scroll up",
          run: () => {
            scroll.scrollBy(-0.5, "viewport");
            return true;
          },
        },
        "chat.scroll.page.down": {
          title: "Scroll down",
          run: () => {
            scroll.scrollBy(0.5, "viewport");
            return true;
          },
        },
      },
    });
    this.inspector = { view, id, unregister };
    this.repaint();
  }

  private adjacent(delta: number): boolean {
    const tasks = this.tasks.filter((task) => unfinishedTask(task) !== this.finished);
    const index = tasks.findIndex((task) => task.id === this.inspector?.id);
    const task = tasks[(index + delta + tasks.length) % tasks.length];
    if (task !== undefined) {
      this.back();
      this.inspect(task.id);
    }
    return true;
  }

  private back(): void {
    const inspector = this.inspector;
    if (inspector === undefined) return;
    this.inspector = undefined;
    inspector.unregister();
    inspector.view.destroy();
    const { shell } = this.options;
    shell.setUi("screen", undefined);
    if (this.menu !== undefined) {
      this.menu.container.visible = true;
      this.repaintMenu();
      shell.focus.use(this.menu);
      setHints(shell, this.menu.hints);
    }
  }
}
