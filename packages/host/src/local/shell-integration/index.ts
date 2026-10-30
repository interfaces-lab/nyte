import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createShellStream } from "./stream.ts";
import type { ShellStream } from "./stream.ts";
import { zshFiles } from "./zsh.ts";

export type TerminalIntegration = ShellStream & {
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  /** Removes the startup files; call once the terminal's process has exited. */
  dispose(): void;
};

/** How a terminal starts and reads its output. An interactive zsh login shell (the terminal of an empty command on macOS or Linux, unless `NYTE_SHELL_INTEGRATION=0`) starts through Nyte's startup files in a private temporary folder, with a fresh nonce in `NYTE_SHELL_NONCE` that the shell takes out of its environment before the user's startup files run; its hooks then report the prompt and each command through markers that only this stream accepts. Every other terminal keeps its arguments and environment, and its stream only removes OSC 633 markers. */
export async function prepareShellIntegration(input: {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly loginShell: boolean;
}): Promise<TerminalIntegration> {
  if (
    !input.loginShell ||
    process.platform === "win32" ||
    input.env.NYTE_SHELL_INTEGRATION === "0" ||
    basename(input.file) !== "zsh"
  )
    return {
      ...createShellStream(null),
      args: input.args,
      env: input.env,
      dispose: () => undefined,
    };

  const nonce = randomBytes(32).toString("hex");
  const folder = await mkdtemp(join(tmpdir(), "nyte-shell-"));

  await Promise.all(
    Object.entries(zshFiles).map(([name, text]) =>
      writeFile(join(folder, name), text, { mode: 0o600 }),
    ),
  );

  return {
    ...createShellStream(nonce),
    args: input.args,
    env: {
      ...input.env,
      ZDOTDIR: folder,
      NYTE_USER_ZDOTDIR: input.env.ZDOTDIR ?? "",
      NYTE_SHELL_NONCE: nonce,
    },
    dispose: () => rmSync(folder, { recursive: true, force: true }),
  };
}
