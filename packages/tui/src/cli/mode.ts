/** How one invocation talks to the terminal. Resolved once, at the entry, from the environment and the standard streams; nothing else reads `isTTY`, `CI`, `NO_COLOR`, `FORCE_COLOR` or `TERM`. */
export interface Mode {
  /** Prompts and browser opening are allowed: stdin and stderr are terminals, `CI` is unset and the command did not take `--json`. */
  readonly interactive: boolean;
  /** `CI` is set and isn't `0` or `false`. Nobody can stop a follow there, so it needs a bound such as `--timeout`. */
  readonly ci: boolean;
  /** A browser opened here reaches the person at the terminal: interactive, and not over SSH (`SSH_CONNECTION`, `SSH_CLIENT` or `SSH_TTY` set). Otherwise print the URL and the next step. */
  readonly browser: boolean;
  /** Which streams are terminals, whatever `TERM` says: the full-screen app needs stdin and stdout, and a terminal stdin is never read as a prompt. */
  readonly tty: { readonly stdin: boolean; readonly stdout: boolean };
  readonly stdout: Presentation;
  readonly stderr: Presentation;
}

/** Per stream. `rich` allows glyphs, alignment padding and redraws; `color` allows ANSI color and weight. Color implies nothing about rich. */
export interface Presentation {
  readonly rich: boolean;
  readonly color: boolean;
}

export interface Terminal {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: { readonly isTTY?: boolean };
  readonly stdout: { readonly isTTY?: boolean };
  readonly stderr: { readonly isTTY?: boolean };
}

/**
 * Color precedence, highest first: a nonempty `NO_COLOR`, then `FORCE_COLOR` (`0` means off), then
 * detection per stream, which is off for a non-terminal and for `TERM=dumb`. `CI` never changes color.
 * Rich presentation needs a terminal whose `TERM` isn't `dumb`; `FORCE_COLOR` doesn't make a pipe rich.
 */
export function resolveMode(terminal: Terminal, json: boolean): Mode {
  const variable = terminal.env["CI"];
  const ci = variable !== undefined && variable !== "" && variable !== "0" && variable !== "false";

  const interactive =
    terminal.stdin.isTTY === true && terminal.stderr.isTTY === true && !ci && !json;

  return {
    interactive,
    ci,
    browser:
      interactive &&
      ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"].every(
        (name) => (terminal.env[name] ?? "") === "",
      ),
    tty: { stdin: terminal.stdin.isTTY === true, stdout: terminal.stdout.isTTY === true },
    stdout: resolvePresentation(terminal.env, terminal.stdout),
    stderr: resolvePresentation(terminal.env, terminal.stderr),
  };
}

export function resolvePresentation(
  env: Terminal["env"],
  stream: { readonly isTTY?: boolean },
): Presentation {
  const rich = stream.isTTY === true && env["TERM"] !== "dumb";
  const noColor = env["NO_COLOR"];
  const forceColor = env["FORCE_COLOR"];

  if (noColor !== undefined && noColor !== "") return { rich, color: false };

  if (forceColor !== undefined)
    return { rich, color: forceColor !== "0" && forceColor !== "false" };

  return { rich, color: rich };
}
