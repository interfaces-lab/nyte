import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createNonceFilter, createShellStream } from "./stream.ts";
import type { ShellStream } from "./stream.ts";
import { bashScript } from "./bash.ts";
import { zshFiles } from "./zsh.ts";

export type TerminalIntegration = ShellStream & {
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  /** Removes the startup files; call once the terminal's process has exited. */
  dispose(): void;
};

/** How a terminal starts and reads its output. An interactive zsh or bash login shell (the terminal of an empty command on macOS or Linux, unless `NYTE_SHELL_INTEGRATION=0`) starts through Nyte's startup files in a private temporary folder (bash as `--init-file … -i`, which runs the login startup files itself), with a fresh nonce in `NYTE_SHELL_NONCE` that the shell takes out of its environment before the user's startup files run; its hooks then report the prompt and each command through markers that only this stream accepts. Every other terminal keeps its arguments and environment, and its stream only removes OSC 633 markers. */
export async function prepareShellIntegration(input: {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly loginShell: boolean;
}): Promise<TerminalIntegration> {
  const shell = basename(input.file);

  const plain = {
    ...createShellStream(null),
    args: input.args,
    env: input.env,
    dispose: () => undefined,
  };

  if (
    !input.loginShell ||
    process.platform === "win32" ||
    input.env.NYTE_SHELL_INTEGRATION === "0" ||
    (shell !== "zsh" && shell !== "bash")
  )
    return plain;

  const nonce = randomBytes(32).toString("hex");
  const folder = await mkdtemp(join(tmpdir(), "nyte-shell-")).catch(() => null);

  if (folder === null) return plain;

  const launch =
    shell === "zsh"
      ? {
          files: zshFiles,
          args: input.args,
          env: { ZDOTDIR: folder, NYTE_USER_ZDOTDIR: input.env.ZDOTDIR ?? "" },
        }
      : {
          files: { "nyte.bash": bashScript },
          args: ["--init-file", join(folder, "nyte.bash"), "-i"],
          env: {},
        };

  const written = await Promise.allSettled(
    Object.entries(launch.files).map(([name, text]) =>
      writeFile(join(folder, name), text, { mode: 0o600 }),
    ),
  );

  if (written.some((result) => result.status === "rejected")) {
    rmSync(folder, { recursive: true, force: true });

    return plain;
  }

  const stream = createShellStream(nonce);
  const hidden = createNonceFilter(nonce);

  return {
    read: (text) => hidden.read(stream.read(text)),
    end: () => hidden.read(stream.end()) + hidden.end(),
    state: () => stream.state(),
    args: launch.args,
    env: { ...input.env, ...launch.env, NYTE_SHELL_NONCE: nonce },
    dispose: () => rmSync(folder, { recursive: true, force: true }),
  };
}
