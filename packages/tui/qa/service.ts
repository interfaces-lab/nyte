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
}

/**
 * Starts the service the compiled binary finds through `~/.nyte/service.json`, so every
 * binary command connects here, to a real host over the fake provider, instead of starting
 * its own. With `plugin`, the workspace holds a project plugin, which the folder's trust
 * decision gates.
 */
export async function serveForBinary(options: { readonly plugin: boolean }): Promise<TestService> {
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
    open: () => openHost({ home, workspace: { kind: "local", path: cwd }, models: models.models }),
    home,
    port: 0,
    version: VERSION,
    connect: undefined,
  });

  return {
    cwd,
    reply: (...queued) => void replies.push(...queued),
    requests,
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
