/** The existing inline picker, with a read-only transcript taking over on Enter. */
import type { Nyte, SessionEvent } from "@nyte-ai/core";
import { BoxRenderable, ScrollBoxRenderable, StyledText, TextRenderable, fg } from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { formatDuration } from "./format.ts";
import type { InlineMenu } from "./picker.ts";
import type { SessionState } from "./session-state.ts";
import { closePanel, notice, openInlineMenu, setHints, type Shell } from "./shell.ts";
import { canStopTask, TaskIndex, taskActivity, taskLabel, taskStatus, type Task } from "./tasks.ts";
import { ToolCard, ToolOutputExpansion, TranscriptView, type Transcript } from "./transcript.ts";

class TaskInspector {
  readonly container: BoxRenderable;
  readonly scroll: ScrollBoxRenderable;
  private readonly heading: TextRenderable;
  private readonly metadata: TextRenderable;
  private readonly transcript: Transcript;
  private readonly view: TranscriptView;
  private card: ToolCard | undefined;
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
    this.heading.content = new StyledText([
      fg(theme.accent)("Tasks"),
      fg(theme.muted)(" │ "),
      fg(theme.foreground)(taskLabel(task)),
    ]);
    const kind = task.kind === "agent" ? (task.state.info.parent?.agent ?? "agent") : "bash";
    const from =
      task.kind === "agent"
        ? "parent session"
        : (task.state.info.name ?? task.state.info.parent?.agent ?? "main session");
    this.metadata.content = new StyledText([
      fg(theme.dim)(`${kind} · ${taskStatus(task)} · from ${from}`),
    ]);
    if (this.id !== task.id) {
      this.card?.container.destroyRecursively();
      this.card = undefined;
      this.view.clear();
      this.id = task.id;
      this.scroll.scrollTo(0);
    }
    if (task.kind === "agent") {
      this.view.sync(task.state);
    } else {
      const live = task.state.overlay.findLast(
        (part) => part.kind === "tool" && part.callId === task.part.callId,
      );
      const progress = live?.kind === "tool" ? live.progress : undefined;
      if (this.card === undefined)
        this.card = new ToolCard(this.transcript, task.part, this.scroll, undefined);
      this.card.sync(task.part, progress);
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

type OpenTasks =
  | { readonly kind: "closed" }
  | { readonly kind: "menu"; readonly menu: InlineMenu; readonly hints: string }
  | {
      readonly kind: "inspector";
      readonly menu: InlineMenu;
      readonly hints: string;
      readonly inspector: TaskInspector;
      readonly taskId: string;
    };

interface TaskBrowserOptions {
  readonly shell: Shell;
  readonly nyte: Nyte;
  readonly onClose: () => void;
  readonly onError: (error: Error) => void;
}

export class TaskBrowser {
  private index: TaskIndex | undefined;
  private sessionId: string | undefined;
  private opened: OpenTasks = { kind: "closed" };

  private readonly options: TaskBrowserOptions;

  constructor(options: TaskBrowserOptions) {
    this.options = options;
    options.shell.taskStatus.onMouseDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.open();
    };
    options.shell.renderer.keyInput.on("keypress", this.onKey);
  }

  get hasTasks(): boolean {
    return (this.index?.tasks.length ?? 0) > 0;
  }

  update(state: SessionState, event?: SessionEvent): void {
    if (state.sessionId !== this.sessionId) {
      this.close();
      this.index?.close();
      this.sessionId = state.sessionId;
      this.index = new TaskIndex({
        nyte: this.options.nyte,
        onChange: () => this.repaint(),
        onError: this.options.onError,
      });
    }
    this.index?.update(state, event);
  }

  open(): void {
    const { shell } = this.options;
    if (this.opened.kind !== "closed" || shell.selecting || shell.prompting) return;
    const hints = shell.hintText;
    const menu = openInlineMenu(
      shell,
      {
        title: "Tasks",
        choices: this.choices(),
        selectLabel: "inspect",
        onSelect: (id) => this.inspect(id),
        onCancel: () => this.close(),
        // Bash runs may contain concurrent calls. Name the actual cancellation scope.
        actions: [{ command: "chat.task.stop", label: "stop run", run: (id) => this.stop(id) }],
      },
      (cause) => this.options.onError(cause instanceof Error ? cause : new Error(String(cause))),
    );
    this.opened = { kind: "menu", menu, hints };
    shell.dismissInfoPanel = () => this.close();
    setHints(shell, menu.hints);
  }

  close(): void {
    const opened = this.opened;
    if (opened.kind === "closed") return;
    this.opened = { kind: "closed" };
    const { shell } = this.options;
    if (opened.kind === "inspector") {
      opened.inspector.destroy();
      shell.live.add(shell.hints);
      shell.scroll.visible = true;
      shell.live.visible = true;
    }
    shell.dismissInfoPanel = undefined;
    closePanel(shell, opened.menu);
    setHints(shell, opened.hints);
    this.options.onClose();
  }

  dispose(): void {
    this.close();
    this.index?.close();
    this.options.shell.renderer.keyInput.off("keypress", this.onKey);
    this.options.shell.taskStatus.onMouseDown = undefined;
  }

  private choices() {
    return (this.index?.tasks ?? []).map((task) => {
      const status = taskStatus(task);
      const turn =
        task.kind === "shell"
          ? task.turn
          : task.state.transcript.items.findLast((item) => item.kind === "turn");
      const duration =
        ["running", "waiting", "retrying"].includes(status) && task.state.run !== undefined
          ? Math.max(0, Date.now() - task.state.run.startedAt)
          : turn?.durationMs;
      const elapsed = duration === undefined ? "" : formatDuration(duration);
      const kind = task.kind === "agent" ? (task.state.info.parent?.agent ?? "agent") : "bash";
      return {
        id: task.id,
        label: taskLabel(task),
        description: `${kind} · ${status}${elapsed === "" ? "" : ` · ${elapsed}`} · ${taskActivity(task)}`,
      };
    });
  }

  private repaint(): void {
    const { shell } = this.options;
    const tasks = this.index?.tasks ?? [];
    const statuses = tasks.map(taskStatus);
    const active = statuses.filter(
      (s) =>
        s === "running" ||
        s === "waiting" ||
        s === "retrying" ||
        s === "stopping" ||
        s === "queued",
    ).length;
    const failed = statuses.filter((s) => s === "failed").length;
    const done = statuses.filter((s) => s === "done").length;
    shell.taskStatus.visible = tasks.length > 0;
    shell.taskStatus.content = new StyledText([
      fg(shell.theme.running)("● "),
      fg(shell.theme.foreground)(`${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`),
      fg(shell.theme.dim)(`  ${active} active · ${done} done`),
      ...(failed === 0 ? [] : [fg(shell.theme.error)(` · ${failed} failed`)]),
      fg(shell.theme.dim)("  ↓ tasks"),
    ]);
    const opened = this.opened;
    if (opened.kind === "closed") return;
    opened.menu.setChoices(this.choices());
    if (opened.kind === "inspector") {
      const task = tasks.find((t) => t.id === opened.taskId);
      if (task === undefined) this.back();
      else this.inspect(task.id);
    }
  }

  private inspect(id: string): void {
    const task = this.index?.tasks.find((t) => t.id === id);
    const opened = this.opened;
    if (task === undefined || opened.kind === "closed") return;
    const { shell } = this.options;
    const inspector = opened.kind === "inspector" ? opened.inspector : new TaskInspector(shell);
    if (opened.kind === "menu") {
      opened.menu.container.visible = false;
      shell.scroll.visible = false;
      shell.live.visible = false;
      shell.root.add(inspector.container);
      shell.root.add(shell.hints);
      shell.focus.use(inspector);
    }
    this.opened = {
      kind: "inspector",
      menu: opened.menu,
      hints: opened.hints,
      inspector,
      taskId: id,
    };
    inspector.show(task);
    setHints(
      shell,
      `esc back · ↑↓ scroll · ←→ task · f follow${canStopTask(task) ? (task.kind === "agent" ? " · x stop agent" : " · x stop owning run") : ""}`,
    );
  }

  private back(): void {
    const opened = this.opened;
    if (opened.kind !== "inspector") return;
    const { shell } = this.options;
    opened.inspector.destroy();
    shell.live.add(shell.hints);
    shell.scroll.visible = true;
    shell.live.visible = true;
    opened.menu.container.visible = true;
    this.opened = { kind: "menu", menu: opened.menu, hints: opened.hints };
    shell.focus.use(opened.menu);
    setHints(shell, opened.menu.hints);
  }

  private stop(id: string): void {
    const task = this.index?.tasks.find((t) => t.id === id);
    if (task === undefined || !canStopTask(task)) return;
    void this.options.nyte.runs
      .abort({ sessionId: task.state.sessionId, head: task.state.head })
      .then((outcome) => {
        if (outcome.kind === "requested") notice(this.options.shell, "Stopping task run…");
      })
      .catch(this.options.onError);
  }

  private readonly onKey = (key: KeyEvent): void => {
    const opened = this.opened;
    if (opened.kind !== "inspector" || key.defaultPrevented || key.ctrl || key.meta) return;
    const tasks = this.index?.tasks ?? [];
    if (key.name === "escape") this.back();
    else if (key.name === "x") this.stop(opened.taskId);
    else if (key.name === "f")
      opened.inspector.scroll.scrollTo({ x: 0, y: opened.inspector.scroll.scrollHeight });
    else if (key.name === "up" || key.name === "down")
      opened.inspector.scroll.scrollBy(key.name === "up" ? -1 : 1);
    else if (key.name === "pageup" || key.name === "pagedown")
      opened.inspector.scroll.scrollBy(key.name === "pageup" ? -0.5 : 0.5, "viewport");
    else if ((key.name === "left" || key.name === "right") && tasks.length > 0) {
      const index = tasks.findIndex((task) => task.id === opened.taskId);
      const task = tasks[(index + (key.name === "left" ? -1 : 1) + tasks.length) % tasks.length];
      if (task !== undefined) this.inspect(task.id);
    } else return;
    key.preventDefault();
    key.stopPropagation();
  };
}
