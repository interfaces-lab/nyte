import { openQuestions } from "@nyte-ai/plugin/question";
import type { OpenQuestion } from "@nyte-ai/plugin/question";
import type { Connection, SessionId, SessionInfo } from "@nyte-ai/sdk";
import { BoxRenderable, ScrollBoxRenderable, StyledText, TextRenderable, fg } from "@opentui/core";
import { keycap } from "./lib/constants.ts";
import { formatDuration } from "./lib/format.ts";
import { registerChatLayer } from "./keymap.ts";
import type { InlineMenu, MenuScreen } from "./picker.ts";
import { closePanel, notice, openInlineMenu, setHints } from "./app/ui.ts";
import type { Shell } from "./app/ui.ts";

import {
  statusMark,
  taskAgent,
  taskConfiguration,
  taskElapsedMs,
  taskLabel,
  taskStatus,
  taskActivity,
  unfinishedTask,
  canStopTask,
} from "./lib/tasks.ts";
import type { Task } from "./lib/tasks.ts";
import { TaskIndex } from "./services/task-index.ts";
import { Timeline } from "./timeline.ts";
import { ToolOutputExpansion } from "./surface.ts";
import type { Transcript } from "./surface.ts";

class TaskInspector {
  readonly container: BoxRenderable;
  readonly scroll: ScrollBoxRenderable;
  private readonly heading: TextRenderable;
  private readonly metadata: TextRenderable;
  private readonly transcript: Transcript;
  private readonly view: Timeline;
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
    this.view = new Timeline(this.transcript);
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
          task.kind === "agent" ? taskConfiguration(task) : undefined,
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
      if (task.view !== undefined) this.view.sync(task.view, { key: task.id });
    } else {
      if (this.output === undefined) {
        this.output = new TextRenderable(this.shell.renderer, {
          fg: theme.foreground,
          wrapMode: "word",
        });
        this.scroll.add(this.output);
      }

      this.output.content = task.job.tail || "No output yet.";
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
  readonly connection: Connection;
  readonly onChange?: () => void;
  readonly onClose: () => void;
  readonly onError: (cause: unknown) => void;
}

/** Session-owned jobs stay alive when their menu or output view closes. */
export class TaskBrowser {
  private readonly options: TaskBrowserOptions;
  private session: SessionInfo | undefined;
  private rows: readonly Task[] = [];
  private menu: InlineMenu | undefined;
  private inspector: { view: TaskInspector; id: string; unregister: () => void } | undefined;
  private index: TaskIndex | undefined;
  private finished = false;
  private menuHasTasks = false;
  private generation = 0;

  constructor(options: TaskBrowserOptions) {
    this.options = options;
    options.shell.transcript.tasks = () => this.rows;
    options.shell.transcript.openTask = (id) => {
      this.open();
      this.inspect(id);
    };
    options.shell.taskStatus.onMouseDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.open();
    };
  }

  /** Follows the tasks of the session on screen; a new session starts a new index. */
  follow(session: SessionInfo): void {
    if (this.session?.id === session.id) return;
    this.close();
    this.generation += 1;
    this.session = session;
    this.index?.close();
    this.index = new TaskIndex(session, {
      connection: this.options.connection,
      onChange: () => this.updateTasks(),
      onError: this.options.onError,
    });
    this.updateTasks();
  }

  get tasks(): readonly Task[] {
    return this.rows;
  }

  private updateTasks(): void {
    this.rows = this.index?.tasks ?? [];
    this.repaint();
  }

  get hasTasks(): boolean {
    return this.tasks.length > 0;
  }

  /** The first question a child is waiting on, with the child that asks it. */
  get waiting(): { readonly session: SessionId; readonly question: OpenQuestion } | undefined {
    for (const task of this.rows) {
      if (task.kind !== "agent" || task.view === undefined) continue;
      const question = openQuestions(task.view)[0];

      if (question !== undefined) return { session: task.id, question };
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
              command: "chat.task.stop",
              label: "cancel",
              keepOpen: true,
              run: (id) => this.cancelTask(id),
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
    this.finished = false;
    this.menuHasTasks = this.tasks.some(unfinishedTask);
    this.menu = openInlineMenu(shell, this.screen(), this.options.onError);
    shell.dismissInfoPanel = () => this.close();
    setHints(shell, this.menu.hints);
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
    this.session = undefined;
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
            label: `${taskAgent(task)} · ${taskLabel(task)}`,
            description: [
              elapsed === undefined ? undefined : formatDuration(Math.max(0, elapsed)),
              task.kind === "agent" ? taskConfiguration(task) : undefined,
            ]
              .filter((value) => value !== undefined && value !== "")
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

    const active = this.tasks.filter(unfinishedTask).length;

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

  private async cancelTask(id: string): Promise<void> {
    const session = this.session;
    const task = this.tasks.find((candidate) => candidate.id === id);

    if (session === undefined || task === undefined) return;

    if (this.inspector === undefined) this.close();

    if (task.kind === "agent") {
      if (!canStopTask(task)) return;
      notice(this.options.shell, "Cancellation requested.");
      await this.options.connection.session(task.id).stop();

      return;
    }

    if (task.job.state.kind !== "running") {
      notice(this.options.shell, "This task has already finished. /tasks opens its output.");

      return;
    }

    const generation = this.generation;
    notice(this.options.shell, "Cancellation requested.");

    const outcome = await this.options.connection
      .workspace(session.workspace)
      .job(task.job.id)
      .stop();

    if (generation !== this.generation) return;

    if (outcome.kind === "missing") notice(this.options.shell, "This task is no longer available.");
    else if (outcome.kind === "settled")
      notice(this.options.shell, "This command has already finished.");
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
            void this.cancelTask(this.inspector?.id ?? id).catch(this.options.onError);

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
