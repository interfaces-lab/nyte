import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHost } from "@nyte-ai/host";
import { fakeModels } from "@nyte-ai/host/bench";
import type { Reply, Request } from "@nyte-ai/host/bench";
import { TITLE_PROMPT } from "@nyte-ai/plugin/core/rename";
import { startService } from "@nyte-ai/service";
import { VERSION } from "../src/version.ts";

/** The answer of the project plugin `serveForBinary` writes when asked for one. */
export const PLUGIN_ANSWER = "QA plugin answered";

/** A Nyte service in this process over the fake provider, registered in its own HOME. */
export interface TestService extends AsyncDisposable {
  readonly cwd: string;
  /** Queues answers for the binary's runs, in order; session titles are answered apart. */
  reply(...replies: readonly Reply[]): void;
  /** Every request but the title requests. */
  readonly requests: readonly Request[];
  /** The binary's whole environment: never merge the caller's into it. */
  readonly env: Readonly<Record<string, string>>;
  /** How many requests the service saw end because their client went away. */
  disconnects(): number;
  /** Stops the service, as `nyte service stop` or a nyte of another build replacing it does. */
  stop(): Promise<void>;
}

/**
 * Returns the code id `binary` was built with: the third part of the build `nyte service status`
 * names when no service runs. A service started with it registers the build the binary expects.
 */
export async function readBinaryCode(binary: string): Promise<string | undefined> {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-binary-code-")));

  try {
    const child = Bun.spawn([binary, "service", "status"], {
      env: { HOME: home, NYTE_HOME: join(home, ".nyte"), PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });

    const text = await new Response(child.stdout).text();
    const build = /^This nyte is build (\S+)\.$/mu.exec(text)?.[1];

    if (build === undefined) throw new Error(`\`nyte service status\` named no build:\n${text}`);

    return build.split("+")[2];
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

/**
 * Starts the service the compiled binary finds through `~/.nyte/service.json`, so every
 * binary command connects here, to a real host over the fake provider, instead of starting
 * its own. Its build carries `code`, the binary's code id. With `plugin`, the workspace holds
 * a project plugin, which the folder's trust decision gates.
 */
export async function serveForBinary(options: {
  readonly plugin: boolean;
  readonly code: string | undefined;
}): Promise<TestService> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-binary-")));
  const home = join(root, "home");
  const cwd = join(root, "workspace");
  await mkdir(join(home, ".nyte"), { recursive: true, mode: 0o700 });
  await mkdir(cwd, { recursive: true });
  await mkdir(join(root, "tmp"));
  await writeFile(
    join(home, ".nyte", "settings.json"),
    '{ "autoUpdate": false, "theme": "dark" }\n',
  );

  if (options.plugin) {
    const plugin = join(cwd, ".nyte", "plugins", "qa-probe");
    await mkdir(plugin, { recursive: true });
    await writeFile(
      join(plugin, "index.js"),
      `export default {
  id: "qa-probe",
  activate(api) {
    api.contribute.commands.add({
      name: "qa-probe",
      title: "QA probe",
      description: "Show that the project plugin loaded",
      run: () => ${JSON.stringify(PLUGIN_ANSWER)},
    });
  },
};
`,
    );
  }

  const replies: Reply[] = [];
  const requests: Request[] = [];
  let disconnects = 0;

  const models = fakeModels({
    fallback(request) {
      const [first] = request.context.messages;

      if (first?.role === "system" && first.content === TITLE_PROMPT)
        return { content: [{ type: "text", text: "Binary smoke" }] };
      requests.push(request);

      return replies.shift() ?? { error: "No reply was scripted for this request." };
    },
  });

  const service = await startService({
    async open() {
      const host = await openHost({
        home,
        workspace: { kind: "local", path: cwd },
        models: models.models,
      });

      return {
        ...host,
        listen: (listening) =>
          host.listen({
            ...listening,
            before(request) {
              request.signal.addEventListener("abort", () => void (disconnects += 1), {
                once: true,
              });

              return listening.before?.(request);
            },
          }),
      };
    },
    home,
    port: 0,
    version: VERSION,
    code: options.code,
    connect: undefined,
  });

  return {
    cwd,
    reply: (...queued) => void replies.push(...queued),
    requests,
    disconnects: () => disconnects,
    stop: () => service.close(),
    env: {
      HOME: home,
      NYTE_HOME: join(home, ".nyte"),
      NYTE_SKIP_VERSION_CHECK: "1",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: "en_US.UTF-8",
      TMPDIR: join(root, "tmp"),
    },
    async [Symbol.asyncDispose]() {
      await service.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
