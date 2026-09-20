import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runProviderCommand } from "./github.ts";
import { createShellEnvironmentRepair } from "./shell-environment.ts";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(body: string) {
  const directory = await mkdtemp(join(tmpdir(), "nyte-shell-environment-"));
  directories.push(directory);
  const shell = join(directory, "login shell");
  await writeFile(shell, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return { directory, shell };
}

describe.skipIf(process.platform === "win32")("shell environment recovery", () => {
  it("reads only marked PATH, keeps inherited tools and repairs once", async () => {
    const local = await fixture(`
[ "$1" = '-ilc' ] || exit 1
printf 'called\\n' >> "$HOME/calls"
printf 'welcome, PATH=/wrong\\n'
printf 'stderr chatter\\n' >&2
export PATH='/shell tools:/usr/bin:/bin'
export GH_TOKEN='shell-only-token'
/bin/sh -c "$2"
printf 'goodbye\\n'
`);
    const env = {
      SHELL: local.shell,
      HOME: local.directory,
      PATH: "/inherited tools",
      GH_TOKEN: "inherited-token",
    };
    const repair = createShellEnvironmentRepair({ env });
    await Promise.all([repair(), repair(), repair()]);
    expect(env).toEqual({
      SHELL: local.shell,
      HOME: local.directory,
      PATH: "/shell tools:/usr/bin:/bin:/inherited tools",
      GH_TOKEN: "inherited-token",
    });
    await repair();
    expect(await readFile(join(local.directory, "calls"), "utf8")).toBe("called\n");
  });

  it.each([
    ["missing markers", "printf '/wrong'"],
    ["empty PATH", "PATH='' /bin/sh -c \"$2\""],
    ["nonzero exit", '/bin/sh -c "$2"; exit 1'],
    ["output limit", "while :; do printf '%01000d' 0; done"],
    ["unterminated marker", "printf '%s' \"$2\""],
  ])("preserves inherited PATH on %s", async (_name, body) => {
    const local = await fixture(body);
    const env = { SHELL: local.shell, PATH: "/inherited" };
    await createShellEnvironmentRepair({ env })();
    expect(env.PATH).toBe("/inherited");
  });

  it("preserves absent PATH when the shell cannot start and does not retry", async () => {
    const local = await fixture('PATH=/recovered /bin/sh -c "$2"');
    const env: NodeJS.ProcessEnv = { SHELL: join(local.directory, "missing") };
    const repair = createShellEnvironmentRepair({ env });
    await repair();
    env.SHELL = local.shell;
    await repair();
    expect(env.PATH).toBeUndefined();
  });

  it.skipIf(process.platform !== "darwin")(
    "reads real zsh login and interactive startup files",
    async () => {
      const local = await fixture("");
      await writeFile(
        join(local.directory, ".zprofile"),
        "printf 'login chatter\\n'\nexport PATH='/login-tools'\n",
      );
      await writeFile(
        join(local.directory, ".zshrc"),
        "printf 'interactive chatter\\n'\nexport PATH=\"/interactive-tools:$PATH\"\n",
      );
      const env = {
        SHELL: "/bin/zsh",
        ZDOTDIR: local.directory,
        HOME: local.directory,
        PATH: "/inherited",
      };
      await createShellEnvironmentRepair({ env })();
      expect(env.PATH).toBe("/interactive-tools:/login-tools:/inherited");
    },
  );

  it("recovers PATH when none was inherited", async () => {
    const local = await fixture('PATH=/recovered /bin/sh -c "$2"');
    const env: NodeJS.ProcessEnv = { SHELL: local.shell };
    await createShellEnvironmentRepair({ env })();
    expect(env.PATH).toBe("/recovered");
  });

  it("rejects a relative shell rather than resolving it through PATH", async () => {
    const env = { SHELL: "sh", PATH: "/inherited" };
    await createShellEnvironmentRepair({ env })();
    expect(env.PATH).toBe("/inherited");
  });

  it("bounds startup even when descendants retain stdout and ignore TERM", async () => {
    const local = await fixture("trap '' TERM; /bin/sleep 30 & wait");
    const env = { SHELL: local.shell, PATH: "/inherited" };
    const started = Date.now();
    await createShellEnvironmentRepair({ env, timeoutMs: 100 })();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(env.PATH).toBe("/inherited");
  });

  it("makes recovered executables available to GitHub commands", async () => {
    const local = await fixture('PATH="$HOME" /bin/sh -c "$2"');
    await writeFile(join(local.directory, "gh"), "#!/bin/sh\nprintf 'fixture-gh'\n", {
      mode: 0o755,
    });
    vi.stubEnv("SHELL", local.shell);
    vi.stubEnv("HOME", local.directory);
    vi.stubEnv("PATH", "/missing-inherited-tools");
    await createShellEnvironmentRepair()();
    expect(
      await runProviderCommand({
        command: "gh",
        args: ["--version"],
        cwd: local.directory,
        timeoutMs: 1_000,
      }),
    ).toEqual({ kind: "completed", code: 0, stdout: "fixture-gh", stderr: "" });
  });
});

it("preserves the complete inherited environment on Windows", async () => {
  const env = { Path: "C:\\tools", PATH: "unchanged", SHELL: "/invalid", GH_TOKEN: "secret" };
  const original = { ...env };
  await createShellEnvironmentRepair({ env, platform: "win32" })();
  expect(env).toEqual(original);
});
