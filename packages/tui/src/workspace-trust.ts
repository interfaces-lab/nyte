import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { bold, BoxRenderable, fg, StyledText, TextRenderable } from "@opentui/core";
import type { CliRenderer, KeyEvent, TextChunk } from "@opentui/core";
import { WorkspaceTrustStore } from "@nyte-ai/core";
import {
  WORKSPACE_TRUST_MESSAGE,
  WORKSPACE_TRUST_QUESTION,
  WORKSPACE_TRUST_TITLE,
} from "./constants.ts";
import type { CliTheme } from "./theme.ts";

export type WorkspaceTrustDecision = "trust" | "decline";

export function nyteHome(): string {
  return resolve(process.env["NYTE_HOME"] ?? join(homedir(), ".nyte"));
}

export function createWorkspaceTrustStore(): WorkspaceTrustStore {
  return new WorkspaceTrustStore(join(nyteHome(), "trust.json"));
}

function consume(key: KeyEvent): void {
  key.preventDefault();
  key.stopPropagation();
}

export interface WorkspaceTrustDialogOptions {
  readonly renderer: CliRenderer;
  readonly theme: CliTheme;
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly nextId: (prefix?: string) => string;
}

/** The single pre-workspace gate. It deliberately has no "allow once" path. */
class WorkspaceTrustDialog {
  readonly result: Promise<WorkspaceTrustDecision>;

  private readonly renderer: CliRenderer;
  private readonly overlay: BoxRenderable;
  private readonly trustRow: TextRenderable;
  private readonly declineRow: TextRenderable;
  private readonly theme: CliTheme;
  private readonly signal: AbortSignal | undefined;
  private resolveResult: ((decision: WorkspaceTrustDecision) => void) | undefined;
  private selected: WorkspaceTrustDecision = "decline";
  private settled = false;

  constructor(options: WorkspaceTrustDialogOptions) {
    this.renderer = options.renderer;
    this.theme = options.theme;
    this.signal = options.signal;
    const { nextId, theme } = options;

    this.overlay = new BoxRenderable(options.renderer, {
      id: nextId("trust-overlay"),
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      zIndex: 100,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.terminal,
    });
    const window = new BoxRenderable(options.renderer, {
      id: nextId("trust-window"),
      width: "90%",
      maxWidth: 120,
      maxHeight: "100%",
      flexDirection: "column",
      overflow: "hidden",
      paddingTop: 1,
      paddingBottom: 1,
      paddingLeft: 2,
      paddingRight: 2,
      border: true,
      borderStyle: "rounded",
      borderColor: theme.path,
      backgroundColor: theme.transparent,
    });
    const details = new BoxRenderable(options.renderer, {
      id: nextId("trust-details"),
      width: "100%",
      flexDirection: "column",
      flexShrink: 1,
      minHeight: 1,
      overflow: "hidden",
    });
    details.add(
      new TextRenderable(options.renderer, {
        id: nextId("trust-title"),
        content: new StyledText([
          fg(theme.warning)("⚠ "),
          bold(fg(theme.foreground)(WORKSPACE_TRUST_TITLE)),
        ]),
      }),
    );
    details.add(
      new TextRenderable(options.renderer, {
        id: nextId("trust-path"),
        marginTop: 1,
        content: `  ${options.cwd}`,
        fg: theme.path,
      }),
    );
    details.add(
      new TextRenderable(options.renderer, {
        id: nextId("trust-message"),
        marginTop: 1,
        content: WORKSPACE_TRUST_MESSAGE,
        fg: theme.foreground,
      }),
    );
    details.add(
      new TextRenderable(options.renderer, {
        id: nextId("trust-question"),
        marginTop: 1,
        marginBottom: 2,
        content: WORKSPACE_TRUST_QUESTION,
        fg: theme.foreground,
      }),
    );
    window.add(details);

    this.trustRow = new TextRenderable(options.renderer, {
      id: nextId("trust-accept"),
      content: "",
      height: 1,
      flexShrink: 0,
      wrapMode: "none",
    });
    this.declineRow = new TextRenderable(options.renderer, {
      id: nextId("trust-decline"),
      content: "",
      height: 1,
      flexShrink: 0,
      wrapMode: "none",
    });
    window.add(this.trustRow);
    window.add(this.declineRow);
    window.add(
      new TextRenderable(options.renderer, {
        id: nextId("trust-footer"),
        marginTop: 1,
        content: "↑↓ move · enter · a/q choose",
        fg: theme.dim,
        flexShrink: 0,
        wrapMode: "none",
      }),
    );
    this.overlay.add(window);
    options.renderer.root.add(this.overlay);
    this.paintRows();

    this.result = new Promise<WorkspaceTrustDecision>((resolveResult) => {
      this.resolveResult = resolveResult;
    });
    options.renderer.keyInput.on("keypress", this.onKeyPress);
    options.signal?.addEventListener("abort", this.onAbort, { once: true });
    if (options.signal?.aborted === true) this.select("decline");
  }

  private row(decision: WorkspaceTrustDecision, key: string, label: string): StyledText {
    const selected = decision === this.selected;
    const emphasis = selected ? bold : (chunk: TextChunk) => chunk;
    return new StyledText([
      fg(selected ? this.theme.ok : this.theme.dim)(selected ? "▸ " : "  "),
      fg(selected ? this.theme.foreground : this.theme.dim)(`[${key}] `),
      emphasis(fg(selected ? this.theme.foreground : this.theme.dim)(label)),
    ]);
  }

  private paintRows(): void {
    this.trustRow.content = this.row("trust", "a", "Trust this workspace");
    this.declineRow.content = this.row("decline", "q", "Quit");
  }

  private readonly onAbort = (): void => this.select("decline");

  private readonly onKeyPress = (key: KeyEvent): void => {
    if (this.settled) return;
    if (key.name === "a") {
      consume(key);
      this.select("trust");
      return;
    }
    if (key.name === "q" || key.name === "escape") {
      consume(key);
      this.select("decline");
      return;
    }
    if (key.name === "return") {
      consume(key);
      this.select(this.selected);
      return;
    }
    if (key.name === "up" || key.name === "down" || key.name === "tab") {
      consume(key);
      this.selected = this.selected === "trust" ? "decline" : "trust";
      this.paintRows();
    }
  };

  private select(decision: WorkspaceTrustDecision): void {
    if (this.settled) return;
    this.settled = true;
    this.signal?.removeEventListener("abort", this.onAbort);
    this.renderer.keyInput.off("keypress", this.onKeyPress);
    if (decision === "trust") {
      this.renderer.root.remove(this.overlay);
      this.overlay.destroyRecursively();
    }
    // On decline the renderer owns the overlay: the caller destroys it next,
    // and removing the box first would queue a frame under that teardown.
    this.resolveResult?.(decision);
  }
}

export function requestWorkspaceTrust(
  options: WorkspaceTrustDialogOptions,
): Promise<WorkspaceTrustDecision> {
  return new WorkspaceTrustDialog(options).result;
}
