import {
  BoxRenderable,
  CliRenderEvents,
  fg,
  RenderableEvents,
  StyledText,
  TextRenderable,
} from "@opentui/core";
import type { CliRenderer, KeyEvent, Renderable } from "@opentui/core";
import { GROKNIGHT } from "../../src/theme.ts";

type DemoProgressState = { kind: "loading" } | { kind: "running"; label: string; step: number };

export const DEMO_FRAME_MS = 6_000;
export const DEFAULT_DEMO_SPEED = 2;

type DemoSpeed = 0.5 | 1 | 2 | 4;

interface DemoProgressOptions {
  /** Synthetic QA keys must keep reaching the production TUI. */
  isDriving?: () => boolean;
  frameMs?: number;
  speed?: DemoSpeed;
}

function faster(speed: DemoSpeed): DemoSpeed {
  switch (speed) {
    case 0.5:
      return 1;
    case 1:
      return 2;
    case 2:
    case 4:
      return 4;
  }
}

function slower(speed: DemoSpeed): DemoSpeed {
  switch (speed) {
    case 0.5:
    case 1:
      return 0.5;
    case 2:
      return 1;
    case 4:
      return 2;
  }
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Three rows of playback chrome shown only by `qa:show`. */
export class DemoProgress {
  private readonly renderer: CliRenderer;
  private readonly total: number;
  private readonly frameMs: number;
  private readonly isDriving: () => boolean;
  private readonly label: TextRenderable;
  private readonly controls: TextRenderable;
  private readonly bar: TextRenderable;
  private state: DemoProgressState = { kind: "loading" };
  private speed: DemoSpeed;
  private paused = false;
  private remainingFrameMs = 0;
  private lastTick = Date.now();
  private wakeWaiter: (() => void) | undefined;
  private disposed = false;

  constructor(
    renderer: CliRenderer,
    app: Renderable,
    total: number,
    options: DemoProgressOptions = {},
  ) {
    if (!Number.isSafeInteger(total) || total < 1) {
      throw new Error("Demo progress needs at least one step");
    }
    const frameMs = options.frameMs ?? DEMO_FRAME_MS;
    if (!Number.isSafeInteger(frameMs) || frameMs < 0) {
      throw new Error("Demo frame duration must be a non-negative safe integer");
    }
    this.renderer = renderer;
    this.total = total;
    this.frameMs = frameMs;
    this.speed = options.speed ?? DEFAULT_DEMO_SPEED;
    this.isDriving = options.isDriving ?? (() => false);

    const shell = new BoxRenderable(renderer, {
      id: "qa-demo-shell",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: GROKNIGHT.background,
    });
    const header = new BoxRenderable(renderer, {
      id: "qa-demo-progress",
      width: "100%",
      height: 3,
      flexShrink: 0,
      flexDirection: "column",
      backgroundColor: GROKNIGHT.codeBackground,
    });
    this.label = new TextRenderable(renderer, {
      id: "qa-demo-label",
      height: 1,
      marginLeft: 2,
      marginRight: 2,
      wrapMode: "none",
      truncate: true,
    });
    this.controls = new TextRenderable(renderer, {
      id: "qa-demo-controls",
      height: 1,
      marginLeft: 2,
      marginRight: 2,
      wrapMode: "none",
      truncate: true,
    });
    this.bar = new TextRenderable(renderer, {
      id: "qa-demo-bar",
      height: 1,
      marginLeft: 2,
      marginRight: 2,
      wrapMode: "none",
      truncate: true,
    });
    header.add(this.label);
    header.add(this.controls);
    header.add(this.bar);

    renderer.root.remove(app);
    app.height = "auto";
    app.flexGrow = 1;
    app.minHeight = 0;
    shell.add(header);
    shell.add(app);
    renderer.root.add(shell);

    renderer.on(CliRenderEvents.RESIZE, this.draw);
    renderer.keyInput.on("keypress", this.onKeyPress);
    shell.once(RenderableEvents.DESTROYED, () => {
      this.disposed = true;
      renderer.off(CliRenderEvents.RESIZE, this.draw);
      renderer.keyInput.off("keypress", this.onKeyPress);
      this.wake();
    });
    this.draw();
  }

  advance(label: string): void {
    this.tick();
    const step = this.state.kind === "loading" ? 1 : this.state.step + 1;
    if (step > this.total) throw new Error("Demo advanced past its final step");
    this.state = { kind: "running", label, step };
    this.remainingFrameMs = this.frameMs;
    this.lastTick = Date.now();
    this.draw();
  }

  /** Wait at a scripted-input boundary while the viewer has playback paused. */
  async checkpoint(): Promise<void> {
    while (this.paused && !this.disposed) await this.waitForPlaybackChange();
  }

  /** Hold the current case for one movie-frame beat, adjusted by playback speed. */
  async finishFrame(): Promise<void> {
    for (;;) {
      this.tick();
      if (this.disposed || this.remainingFrameMs <= 0) return;
      if (this.paused) await this.waitForPlaybackChange();
      else await this.waitForPlaybackChange(this.remainingFrameMs / this.speed);
    }
  }

  typingDelay(baseMs: number): number {
    return Math.max(0, Math.round(baseMs / this.speed));
  }

  private tick(): void {
    const now = Date.now();
    if (!this.paused && this.state.kind === "running") {
      this.remainingFrameMs = Math.max(
        0,
        this.remainingFrameMs - (now - this.lastTick) * this.speed,
      );
    }
    this.lastTick = now;
  }

  private waitForPlaybackChange(timeoutMs?: number): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        if (this.wakeWaiter === done) this.wakeWaiter = undefined;
        resolve();
      };
      this.wakeWaiter = done;
      if (timeoutMs !== undefined) timer = setTimeout(done, Math.max(0, timeoutMs));
    });
  }

  private wake(): void {
    this.wakeWaiter?.();
  }

  private readonly onKeyPress = (key: KeyEvent): void => {
    if (key.defaultPrevented || this.isDriving()) return;
    const pause = key.name === "space" || key.sequence === " ";
    const speedDown = key.name === "[" || key.sequence === "[";
    const speedUp = key.name === "]" || key.sequence === "]";
    if (!pause && !speedDown && !speedUp) return;

    key.preventDefault();
    key.stopPropagation();
    this.tick();
    if (pause) this.paused = !this.paused;
    else if (speedDown) this.speed = slower(this.speed);
    else this.speed = faster(this.speed);
    this.wake();
    this.draw();
  };

  private readonly draw = (): void => {
    this.tick();
    const step = this.state.kind === "loading" ? 0 : this.state.step;
    const detail = this.state.kind === "loading" ? "Starting…" : this.state.label;
    const futureFrames = this.total - step;
    const virtualRemaining = this.remainingFrameMs + futureFrames * this.frameMs;
    const timeLeft = clock(virtualRemaining / this.speed);
    this.label.content = new StyledText([
      fg(this.paused ? GROKNIGHT.warning : GROKNIGHT.running)(this.paused ? "Ⅱ" : "●"),
      fg(GROKNIGHT.dim)(" QA  "),
      fg(GROKNIGHT.dim)(`${String(step)}/${String(this.total)}  `),
      fg(GROKNIGHT.foreground)(detail),
      fg(GROKNIGHT.muted)(`  · ${timeLeft} left`),
    ]);
    this.controls.content = new StyledText([
      fg(GROKNIGHT.user)("space"),
      fg(GROKNIGHT.dim)(this.paused ? " resume" : " pause"),
      fg(GROKNIGHT.muted)(" · "),
      fg(GROKNIGHT.user)("["),
      fg(GROKNIGHT.dim)(" slower"),
      fg(GROKNIGHT.muted)(" · "),
      fg(GROKNIGHT.user)("]"),
      fg(GROKNIGHT.dim)(" faster"),
      fg(GROKNIGHT.muted)(" · "),
      fg(GROKNIGHT.foreground)(`${String(this.speed)}×`),
    ]);

    const width = Math.max(1, this.renderer.width - 4);
    const completed = Math.round((width * step) / this.total);
    this.bar.content = new StyledText([
      fg(GROKNIGHT.running)("━".repeat(completed)),
      fg(GROKNIGHT.muted)("─".repeat(width - completed)),
    ]);
    this.renderer.requestRender();
  };
}
