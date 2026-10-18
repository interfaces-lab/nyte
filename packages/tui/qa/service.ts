import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHost } from "@nyte-ai/host";
import { fakeModels } from "@nyte-ai/bench";
import type { Reply, Request } from "@nyte-ai/bench";
import { TITLE_PROMPT } from "@nyte-ai/plugin/core/rename";
import { findService, startService, stopService } from "@nyte-ai/service";
import { VERSION } from "../src/version.ts";

export const PLUGIN_ANSWER = "QA plugin answered";

export interface TestService extends AsyncDisposable {
  readonly cwd: string;
  reply(...replies: readonly Reply[]): void;
  readonly requests: readonly Request[];
  readonly env: Readonly<Record<string, string>>;
  disconnects(): number;
  stop(): Promise<void>;
}

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

export async function serveForBinary(options: {
  readonly plugin: boolean;
  readonly code: string | undefined;
}): Promise<TestService> {
  const { root, home, cwd, env } = await isolate();

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
    env,
    async [Symbol.asyncDispose]() {
      await service.close();
      await stopService(home);
      await rm(root, { recursive: true, force: true });
    },
  };
}

export interface FreshHome extends AsyncDisposable {
  readonly cwd: string;
  readonly nyteHome: string;
  readonly registration: string;
  readonly env: Readonly<Record<string, string>>;
}

export async function freshHome(): Promise<FreshHome> {
  const { root, home, cwd, env } = await isolate();
  const registration = join(home, ".nyte", "service.json");

  return {
    cwd,
    nyteHome: join(home, ".nyte"),
    registration,
    env,
    async [Symbol.asyncDispose]() {
      const deadline = Date.now() + 20_000;

      while (Date.now() < deadline && (await findService(home)) === undefined) await Bun.sleep(50);
      await stopService(home);
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function isolate() {
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

  const env = {
    HOME: home,
    NYTE_HOME: join(home, ".nyte"),
    NYTE_SKIP_VERSION_CHECK: "1",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: "en_US.UTF-8",
    TMPDIR: join(root, "tmp"),
  };

  return { root, home, cwd, env };
}
