export interface Mode {
  readonly interactive: boolean;
  readonly ci: boolean;
  readonly browser: boolean;
  readonly tty: { readonly stdin: boolean; readonly stdout: boolean };
  readonly stdout: Presentation;
  readonly stderr: Presentation;
}

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

  if (forceColor !== undefined) {
    return { rich, color: forceColor !== "0" && forceColor !== "false" };
  }

  return { rich, color: rich };
}
