import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Job } from "@nyte-ai/core";
import { afterEach, describe, expect, it } from "vitest";
import { localExec } from "../src/index.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

const PROMPT = "<ready> ";

const WAIT_MS = 10_000;

const TEST_MS = 30_000;

const ptyLoads =
  process.platform !== "win32" &&
  (await localExec(tmpdir())("true", { pty: { columns: 80, rows: 24 } }).then(
    async (job) => (await job.settled()).kind === "exited",
    () => false,
  ));

const zsh = ["/bin/zsh", "/usr/bin/zsh"].find((path) => existsSync(path));

type Terminal = {
  readonly job: Job;
  readonly home: string;
  text(): string;
  prompts(): number;
  /** Types a line and waits for the prompt after it. */
  submit(line: string): Promise<void>;
  /** Types a line without waiting. */
  type(line: string): Promise<void>;
  until(found: () => boolean, what: string): Promise<void>;
  /** Waits until the output shows `text`, which typed input must not echo. */
  shows(text: string): Promise<void>;
  close(): Promise<void>;
};

/** A real login shell in a pty through `localExec`, with HOME (and ZDOTDIR) at a fresh folder holding `files`. */
async function openTerminal(
  shell: string,
  files: Readonly<Record<string, string>>,
  env?: Readonly<Record<string, string>>,
): Promise<Terminal> {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-terminal-home-")));
  folders.push(home);

  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(home, name)), { recursive: true });
    await writeFile(join(home, name), text);
  }

  const job = await localExec(home, { shell: () => shell })([], {
    pty: { columns: 200, rows: 50 },
    env: { HOME: home, ZDOTDIR: home, NYTE_SHELL_INTEGRATION: "1", ...env },
  });

  const decoder = new TextDecoder();
  let text = "";

  const drained = (async () => {
    for await (const frame of job.output())
      if (frame.kind === "bytes") text += decoder.decode(frame.data, { stream: true });
  })();

  const until = async (found: () => boolean, what: string): Promise<void> => {
    const deadline = Date.now() + WAIT_MS;

    while (!found()) {
      if (Date.now() > deadline)
        throw new Error(
          `Timed out waiting for ${what}; output ends ${JSON.stringify(text.slice(-400))}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  const prompts = (): number => text.split(PROMPT).length - 1;

  const type = async (line: string): Promise<void> => {
    await job.write(new TextEncoder().encode(`${line}\r`));
  };

  await until(() => prompts() > 0, "the first prompt");

  return {
    job,
    home,
    text: () => text,
    prompts,
    type,
    until,
    async submit(line) {
      const before = prompts();
      await type(line);
      await until(() => prompts() > before, `the prompt after ${line}`);
    },
    shows: (shown) => until(() => text.includes(shown), JSON.stringify(shown)),
    async close() {
      await job.stop();
      await drained;
    },
  };
}

const interrupt = (terminal: Terminal): Promise<void> => terminal.job.write(new Uint8Array([3]));

const NONCE = /[0-9a-f]{64}/;

/** How many variables this process passes on whose values look like a nonce. */
const inheritedHex = (): number =>
  Object.entries(process.env).filter(([name, value]) => NONCE.test(`${name}=${value ?? ""}`))
    .length;

const fakeMarkers = [
  "spoof-start",
  "\x1b]633;A\x07\x1b]633;B\x07\x1b]633;D;0\x07\x1b]633;P;Cwd=/\x07\x1b]633;E;ls;nonce\x07",
  "\x1b]133;A\x07",
  "\x1b]633;Nyte;1;A;0\x07",
  `\x1b]633;Nyte;1;${"f".repeat(64)};A;0\x1b\\`,
  "spoof-end",
].join("");

describe.skipIf(!ptyLoads || zsh === undefined)("an integrated zsh terminal", () => {
  const shell = zsh ?? "";

  const hooks = `PS1='${PROMPT}'
precmd() { print -r -- "precmd $?" >> $HOME/hooks.log }
__slow_hook() {
  print -r -- "hook $?" >> $HOME/hooks.log
  if [[ -e $HOME/hold ]]; then
    : $(touch $HOME/entered; while [[ -e $HOME/hold ]]; do sleep 0.05; done)
  fi
}
precmd_functions+=(__slow_hook)
preexec() { print -r -- preexec >> $HOME/hooks.log }
`;

  it(
    "runs the user's startup files once each, in order, with their ZDOTDIR, history and exports, and keeps the nonce out of the environment and output",
    async () => {
      const log = (name: string): string => `print -r -- "${name} $ZDOTDIR" >> $HOME/startup.log\n`;

      const terminal = await openTerminal(shell, {
        ".zshenv": `${log("zshenv")}export STARTUP_VAR=from-zshenv\nZDOTDIR=$HOME/zdot\n`,
        "zdot/.zprofile": log("zprofile"),
        "zdot/.zshrc": `${log("zshrc")}PS1='${PROMPT}'\n`,
        "zdot/.zlogin": log("zlogin"),
      });

      try {
        await terminal.submit("setopt xtrace; true; unsetopt xtrace");
        await terminal.submit(
          "print -r -- nonce-$(env | grep -c -E '[0-9a-f]{64}')-${NYTE_SHELL_NONCE-unset} zdotdir=$ZDOTDIR var=$STARTUP_VAR history=$HISTFILE.",
        );

        await terminal.shows(
          `nonce-${inheritedHex()}-unset zdotdir=${terminal.home}/zdot var=from-zshenv history=`,
        );
        expect(terminal.text()).not.toMatch(/history=\S*nyte-shell-/);
        expect(terminal.text()).not.toMatch(NONCE);
        expect(terminal.text()).not.toContain("633;");
        expect(await readFile(join(terminal.home, "startup.log"), "utf8")).toBe(
          [
            `zshenv ${terminal.home}`,
            `zprofile ${terminal.home}/zdot`,
            `zshrc ${terminal.home}/zdot`,
            `zlogin ${terminal.home}/zdot`,
            "",
          ].join("\n"),
        );
      } finally {
        await terminal.close();
      }
    },
    TEST_MS,
  );

  it(
    "is idle at the prompt and while prompt hooks run, which still see the command's status, and busy while a command line runs, even without job control",
    async () => {
      const terminal = await openTerminal(shell, { ".zshrc": hooks });
      const hold = join(terminal.home, "hold");

      try {
        await terminal.submit("false");
        await terminal.submit("(exit 7)");

        expect(await readFile(join(terminal.home, "hooks.log"), "utf8")).toContain(
          "preexec\nprecmd 1\nhook 1\npreexec\nprecmd 7\nhook 7\n",
        );

        await writeFile(hold, "");
        const prompts = terminal.prompts();
        await terminal.type("sleep 0.1");
        await terminal.until(() => existsSync(join(terminal.home, "entered")), "the prompt hook");

        await expect.poll(() => terminal.job.idle(), { timeout: WAIT_MS }).toBe(true);
        await rm(hold);
        await terminal.until(() => terminal.prompts() > prompts, "the prompt after the hook");

        await terminal.type("set +m; echo busy-$((40+2)); sleep 30");
        await terminal.shows("busy-42");

        expect(await terminal.job.idle()).toBe(false);
        await interrupt(terminal);
        await expect.poll(() => terminal.job.idle(), { timeout: WAIT_MS }).toBe(true);

        await terminal.type("echo loop-$((40+2)); while :; do :; done");
        await terminal.shows("loop-42");

        expect(await terminal.job.idle()).toBe(false);
        await interrupt(terminal);
        await expect.poll(() => terminal.job.idle(), { timeout: WAIT_MS }).toBe(true);
      } finally {
        await terminal.close();
      }
    },
    TEST_MS,
  );

  it(
    "stays busy while a background job runs at the prompt, with or without job control, and goes idle once it ends",
    async () => {
      const terminal = await openTerminal(shell, { ".zshrc": `PS1='${PROMPT}'\n` });
      const hold = join(terminal.home, "hold");

      try {
        await terminal.submit("sleep 30 &");

        expect(await terminal.job.idle()).toBe(false);
        await terminal.submit("kill %1");
        await expect.poll(() => terminal.job.idle(), { timeout: WAIT_MS }).toBe(true);

        await writeFile(hold, "");
        await terminal.submit("set +m");
        await terminal.submit("(while [[ -e $HOME/hold ]]; do sleep 0.05; done) &");

        expect(await terminal.job.idle()).toBe(false);
        await rm(hold);
        await expect.poll(() => terminal.job.idle(), { timeout: WAIT_MS }).toBe(true);
      } finally {
        await terminal.close();
      }
    },
    TEST_MS,
  );

  it(
    "ignores markers a command prints and keeps every OSC 633 out of the output",
    async () => {
      const terminal = await openTerminal(shell, {
        ".zshrc": `PS1='${PROMPT}'\n`,
        fake: fakeMarkers,
      });

      try {
        await terminal.type("set +m; cat $HOME/fake; sleep 30");
        await terminal.shows("spoof-end");

        expect(await terminal.job.idle()).toBe(false);
        expect(terminal.text()).toContain("spoof-start\x1b]133;A\x07spoof-end");
        expect(terminal.text()).not.toContain("633;");
        await interrupt(terminal);
        await expect.poll(() => terminal.job.idle(), { timeout: WAIT_MS }).toBe(true);
      } finally {
        await terminal.close();
      }
    },
    TEST_MS,
  );

  it(
    "falls back to the process table, which cannot tell a `set +m` command from a prompt hook, when opted out before it starts, in the user's startup files, or at the prompt",
    async () => {
      const busy = async (terminal: Terminal): Promise<boolean> => {
        await terminal.type("set +m; echo busy-$((40+2)); sleep 30");
        await terminal.shows("busy-42");
        const idle = await terminal.job.idle();
        await interrupt(terminal);

        return !idle;
      };

      const before = await openTerminal(
        shell,
        { ".zshrc": `PS1='${PROMPT}'\n` },
        { NYTE_SHELL_INTEGRATION: "0" },
      );

      const startup = await openTerminal(shell, {
        ".zshrc": `PS1='${PROMPT}'\nNYTE_SHELL_INTEGRATION=0\n`,
      });

      const prompt = await openTerminal(shell, { ".zshrc": `PS1='${PROMPT}'\n` });

      try {
        await before.submit("print -r -- startup-${__nyte_zdotdir-none}.");
        await before.shows("startup-none.");
        await prompt.submit("NYTE_SHELL_INTEGRATION=0");

        expect(await Promise.all([before, startup, prompt].map(busy))).toEqual([
          false,
          false,
          false,
        ]);
      } finally {
        await Promise.all([before, startup, prompt].map((terminal) => terminal.close()));
      }
    },
    TEST_MS,
  );

  it(
    "keeps its startup folder while readers detach and removes it when the shell exits",
    async () => {
      const terminal = await openTerminal(shell, { ".zshrc": `PS1='${PROMPT}'\n` });

      try {
        await terminal.submit("print -r -- startup=$__nyte_zdotdir.");
        const folder = /startup=(\S+)\./.exec(terminal.text().split("\n").at(-2) ?? "")?.[1] ?? "";

        expect(existsSync(join(folder, "nyte.zsh"))).toBe(true);
        await terminal.job.close();

        expect(existsSync(folder)).toBe(true);
        await terminal.job.stop();
        await terminal.job.settled();

        expect(existsSync(folder)).toBe(false);
      } finally {
        await terminal.close();
      }
    },
    TEST_MS,
  );
});
