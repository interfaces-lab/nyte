import { isJson, SdkError } from "@nyte-ai/schema";
import type {
  ByteReader,
  Capability,
  CapabilityWire,
  HostView,
  HostViewWire,
  JobsChange,
  JobView,
  Json,
  OutputFrame,
  PageId,
  PageInfo,
  PatchSet,
  PatchSetWire,
  PrincipalId,
  ReceiptId,
  SessionId,
  WorkspaceId,
} from "@nyte-ai/schema";
import type {
  BrowserApi,
  Connection,
  FilesApi,
  GitApi,
  GitHubApi,
  Job,
  Login,
  Page,
  Receipt,
} from "@nyte-ai/core";
import type { ServerHost } from "@nyte-ai/core/server";
import { mapped, sessionsFrames, viewFrames } from "@nyte-ai/protocol";
import type {
  ByteName,
  CallName,
  FrameName,
  OperationInput,
  OperationOutput,
} from "@nyte-ai/protocol";

/** Returns what a row's binding receives besides its input: the request's body (the bytes of `files.write`, `job.write` and `files.upload`) and the client's abort signal. */
export type BindingRequest = {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly signal: AbortSignal;
};

/** Returns a byte row's answer: the reader and the headers the response adds (`X-Nyte-Version` for `files.bytes`, §40p). */
type ByteBody = {
  readonly reader: ByteReader;
  readonly headers?: Readonly<Record<string, string>>;
};

/** Returns the bindings of the rows answered once. */
export type CallBinding = {
  readonly [N in CallName]: (
    input: OperationInput<N>,
    request: BindingRequest,
  ) => Promise<OperationOutput<N>>;
};

/** Returns the bindings of the rows answered with JSON frames. */
export type FrameBinding = {
  readonly [N in FrameName]: (
    input: OperationInput<N>,
    request: BindingRequest,
  ) => Promise<AsyncIterable<OperationOutput<N>>>;
};

/** Returns the bindings of the rows answered with bytes. */
export type ByteBinding = {
  readonly [N in ByteName]: (
    input: OperationInput<N>,
    request: BindingRequest,
  ) => Promise<ByteBody>;
};

/** Returns the binding of `job.output`, whose frames are framed bytes and control frames (§40h). */
type OutputBinding = {
  readonly "job.output": (
    input: OperationInput<"job.output">,
    request: BindingRequest,
  ) => Promise<AsyncIterable<OutputFrame>>;
};

/** Returns the server side of the table for one connection: each row takes its decoded input and the request's body and abort signal, and answers its output, its frames, or a byte reader; setup failures (authority, capability, unknown ids) reject before any frame. */
export type Binding = CallBinding & FrameBinding & ByteBinding & OutputBinding;

/** Describes what a binding needs beyond the connection: the server port, for the rows that carry a wire-only id (§40o) and `parts.create`. */
export type BindingOptions = {
  readonly server: ServerHost;
};

const LOGIN_LIFETIME = 10 * 60 * 1000;

type Attempt = {
  readonly login: Login;
  readonly timer: ReturnType<typeof setTimeout>;
  steps: AsyncIterator<OperationOutput<"login.steps">> | null;
};

const attempts = new WeakMap<ServerHost, Map<string, Attempt>>();

const holds = new WeakMap<ServerHost, Map<string, Page[]>>();

export function bindConnection(connection: Connection, options: BindingOptions): Binding {
  const { wire } = options.server;
  const { principal } = connection;
  const logins = attempts.get(options.server) ?? new Map<string, Attempt>();
  attempts.set(options.server, logins);
  const pages = holds.get(options.server) ?? new Map<string, Page[]>();
  holds.set(options.server, pages);

  const session = (id: SessionId) => connection.session(id);
  const workspace = (id: WorkspaceId) => connection.workspace(id);

  const files = async (id: WorkspaceId): Promise<FilesApi> =>
    available(await workspace(id).files(), "files");

  const git = async (id: WorkspaceId): Promise<GitApi> =>
    available(await workspace(id).git(), "git");

  const github = async (id: WorkspaceId): Promise<GitHubApi> =>
    available(await workspace(id).github(), "github");

  const browser = async (id: WorkspaceId): Promise<BrowserApi> =>
    available(await workspace(id).browser(), "browser");

  const findLogin = (provider: string): Attempt =>
    logins.get(principalKey(principal, provider)) ??
    fail("unknown", `No login for ${provider} is in progress.`);

  const endLogin = (provider: string, attempt: Attempt): void => {
    clearTimeout(attempt.timer);
    const key = principalKey(principal, provider);

    if (logins.get(key) === attempt) logins.delete(key);
    void attempt.steps?.return?.();
  };

  const hold = (page: Page): Page => {
    const key = principalKey(principal, page.id);
    const known = pages.get(key) ?? [];
    pages.set(key, known.includes(page) ? known : [...known, page]);

    return page;
  };

  const release = async (page: PageId): Promise<void> => {
    const key = principalKey(principal, page);
    const [last, ...rest] = [...(pages.get(key) ?? [])].reverse();

    if (rest.length === 0) pages.delete(key);
    else pages.set(key, rest.reverse());
    await last?.close();
  };

  const findPage = async (at: WorkspaceId, id: PageId): Promise<Page> =>
    pages.get(principalKey(principal, id))?.[0] ??
    wire.page(id) ??
    hold(await (await browser(at)).adopt(id));

  const describePage = async (page: Page): Promise<PageInfo> => {
    const view = await page.view();

    return { id: page.id, url: view.url, title: view.title, holders: wire.holders(page.id) };
  };

  const findReceipt = (at: SessionId | null, id: ReceiptId): Receipt<unknown> | undefined =>
    at === null ? wire.batchReceipt(id) : session(at).receipt(id);

  const startedJob = (job: Job): OperationOutput<"jobs.start"> => ({
    ...(wire.job(job.id) ?? fail("unknown", `Job ${job.id} is gone.`)),
    key: job.key,
  });

  return {
    "connection.watch": async () => mapped(connection.watch(), (view) => hostWire(view, principal)),
    "connection.blob": async ({ id }) => ({ reader: await connection.blob(id) }),

    "models.list": () => connection.models.list(),
    "models.accounts": ({ provider }) => connection.models.accounts(provider),
    "models.selectAccount": async ({ provider, account }) => {
      await connection.models.selectAccount(provider, account);

      return null;
    },
    "models.usage": () => connection.models.usage(),
    "models.refresh": async ({ provider }) => {
      await connection.models.refresh(provider);

      return null;
    },
    "models.setDefault": ({ ref }) => connection.models.setDefault(ref),
    "models.setListing": ({ refs, listing }) => connection.models.setListing(refs, listing),
    "models.verify": ({ provider }) => connection.models.verify(provider),
    "models.login": async (input) => {
      const { provider } = input;
      const login = connection.models.login(input);
      const key = principalKey(principal, provider);
      const previous = logins.get(key);

      if (previous !== undefined) endLogin(provider, previous);

      const attempt: Attempt = {
        login,
        steps: null,
        timer: setTimeout(() => endLogin(provider, attempt), LOGIN_LIFETIME),
      };

      logins.set(key, attempt);

      return null;
    },
    "models.logout": async ({ provider }) => {
      await connection.models.logout(provider);

      return null;
    },
    "login.steps": async ({ provider }) => {
      const attempt = findLogin(provider);

      if (attempt.steps !== null)
        fail("invalid", `The login for ${provider} is already streaming.`);
      const steps = attempt.login.steps()[Symbol.asyncIterator]();
      attempt.steps = steps;

      return {
        [Symbol.asyncIterator]: () => ({
          async next() {
            const next = await steps.next();

            if (next.done === true || next.value.kind === "done" || next.value.kind === "failed")
              endLogin(provider, attempt);

            return next;
          },
          async return() {
            endLogin(provider, attempt);

            return { done: true, value: undefined };
          },
        }),
      };
    },
    "login.answer": async ({ provider, code }) => {
      await findLogin(provider).login.answer(code);

      return null;
    },

    "settings.apply": ({ id, value }) => connection.settings.apply(id, value),

    "workspaces.list": () => connection.workspaces.list(),
    "workspaces.inspect": ({ target }) => connection.workspaces.inspect(target),
    "workspaces.add": ({ target, options }) => connection.workspaces.add(target, options),
    "workspaces.forget": ({ id }) => connection.workspaces.forget(id),

    "sessions.watch": async (input) => sessionsFrames(connection.sessions.watch(input)),
    "sessions.start": async (input) => {
      const { session, receipt } = await connection.sessions.start(input);

      return { session: session.id, receipt: receipt.id, message: receipt.message };
    },
    "sessions.list": (input) => connection.sessions.list(input),

    "session.info": ({ session: id }) => session(id).info(),
    "session.update": ({ session: id, patch }) => session(id).update(patch),
    "session.remove": ({ session: id }) => session(id).remove(),
    "session.stop": ({ session: id }) => session(id).stop(),
    "session.command": ({ session: id, name, text }) => session(id).command(name, text),
    "session.completeCommand": ({ session: id, name, prefix }) =>
      session(id).completeCommand(name, prefix),

    "head.send": async ({ session: id, head, content, options }) => {
      const receipt = await session(id).head(head).send(content, options);

      return { receipt: receipt.id, message: receipt.message };
    },
    "head.configure": ({ session: id, head, patch }) => session(id).head(head).configure(patch),
    "head.view": ({ session: id, head, options }) => session(id).head(head).view(options),
    "head.watch": async ({ session: id, head, options }) => {
      await session(id).info();

      return viewFrames(session(id).head(head).watch(options));
    },
    "head.see": async ({ session: id, head, commit }) => {
      await session(id).head(head).see(commit);

      return null;
    },
    "head.history": ({ session: id, head, before, limit }) =>
      session(id).head(head).history({ before, limit }),
    "head.tree": ({ session: id, head }) => session(id).head(head).tree(),
    "head.move": async ({ session: id, head, position, options, id: receipt }) => ({
      receipt: (await wire.move(id, head, position, { ...options, id: receipt })).id,
    }),
    "head.compact": ({ session: id, head, instructions }) =>
      session(id).head(head).compact({ instructions }),

    "heads.create": ({ session: id, name, input }) => session(id).heads.create(name, input),
    "heads.merge": ({ session: id, name, options }) => session(id).heads.merge(name, options),
    "heads.remove": ({ session: id, name, options }) => session(id).heads.remove(name, options),

    "run.stop": ({ session: id, run }) => session(id).run(run).stop(),
    "run.settled": ({ session: id, run }, { signal }) => session(id).run(run).settled({ signal }),

    "receipt.status": async ({ session: id, receipt }) => {
      const status = (await findReceipt(id, receipt)?.status()) ?? { kind: "missing" };

      return status.kind === "settled"
        ? { kind: "settled", outcome: toJson(status.outcome) }
        : status;
    },
    "receipt.settled": async ({ session: id, receipt }, { signal }) => {
      const handle =
        findReceipt(id, receipt) ?? fail("unknown", `No receipt has the id ${receipt}.`);

      return toJson(await handle.settled({ signal }));
    },
    "receipt.stop": async ({ session: id, receipt }) => {
      const stopped = (await findReceipt(id, receipt)?.stop()) ?? { kind: "missing" };

      return stopped.kind === "settled"
        ? { kind: "settled", outcome: toJson(stopped.outcome) }
        : stopped;
    },
    "receipt.landed": async ({ session: id, receipt }) =>
      wire
        .sendReceipt(id ?? fail("invalid", "Only a send's receipt has landed."), receipt)
        .landed(),

    "parts.create": async ({ session: id, kind, input }) => {
      const definition =
        (await wire.partDefinition(id, kind)) ??
        fail("unknown", `No part definition has the kind ${kind}.`);

      return { part: (await session(id).parts.create(definition, input)).id };
    },
    "part.update": ({ session: id, part, next, options }) =>
      session(id).part(part).update(next, options),
    "part.act": async ({ session: id, part, action, input }) => {
      const outcome = await session(id).part(part).act(action, input);

      return outcome.kind === "ok" ? { kind: "ok", output: toJson(outcome.output) } : outcome;
    },
    "part.answer": async ({ session: id, part }, { signal }) => {
      const answer = await session(id).part(part).answer({ signal });

      return answer === null
        ? null
        : { action: String(answer.action), input: toJson(answer.input) };
    },
    "part.close": async ({ session: id, part }) => {
      await session(id).part(part).close();

      return null;
    },

    "workspace.info": ({ workspace: id }) => workspace(id).info(),
    "workspace.catalog": ({ workspace: id }) => workspace(id).catalog(),
    "workspace.command": ({ workspace: id, name, text }) => workspace(id).command(name, text),
    "workspace.completeCommand": ({ workspace: id, name, prefix }) =>
      workspace(id).completeCommand(name, prefix),
    "workspace.watch": async ({ workspace: id }) => workspace(id).watch(),
    "mcp.watch": async ({ workspace: id }) => workspace(id).mcp.watch(),
    "mcp.reconnect": ({ workspace: id, server }) => workspace(id).mcp.reconnect(server),
    "mcp.setEnabled": ({ workspace: id, server, enabled }) =>
      workspace(id).mcp.setEnabled(server, enabled),
    "mcp.login": async ({ workspace: id, server }) => {
      const login = JSON.stringify(["mcp", id, server]);
      const previous = logins.get(principalKey(principal, login));

      if (previous !== undefined) endLogin(login, previous);

      const attempt: Attempt = {
        login: workspace(id).mcp.login(server),
        steps: null,
        timer: setTimeout(() => endLogin(login, attempt), LOGIN_LIFETIME),
      };

      logins.set(principalKey(principal, login), attempt);

      return { login };
    },
    "mcp.logout": ({ workspace: id, server }) => workspace(id).mcp.logout(server),
    "mcp.add": ({ workspace: id, server, config, scope }) =>
      workspace(id).mcp.add(server, config, scope),
    "mcp.remove": ({ workspace: id, server, scope }) => workspace(id).mcp.remove(server, scope),
    "workspace.update": ({ workspace: id, patch }) => workspace(id).update(patch),
    "workspace.reload": ({ workspace: id }) => workspace(id).reload(),
    "workspace.changes": ({ workspace: id, source }) => workspace(id).changes(source),
    "workspace.patches": async ({ workspace: id, source, paths, options }) =>
      mapped(workspace(id).patches(source, paths, options), patchesWire),
    "workspace.files": async ({ workspace: id }) => capabilityWire(await workspace(id).files()),
    "workspace.git": async ({ workspace: id }) => capabilityWire(await workspace(id).git()),
    "workspace.github": async ({ workspace: id }) => capabilityWire(await workspace(id).github()),
    "workspace.browser": async ({ workspace: id }) => capabilityWire(await workspace(id).browser()),

    "jobs.start": async ({ workspace: id, command, session, title, pty, id: job }) =>
      startedJob(await workspace(id).jobs.start({ command, session, title, pty, id: job })),
    "jobs.recover": async ({ workspace: id, key }) => {
      const recovered = await workspace(id).jobs.recover(key);

      return "id" in recovered ? startedJob(recovered) : recovered;
    },
    "jobs.list": ({ workspace: id }) => workspace(id).jobs.list(),
    "jobs.watch": async ({ workspace: id }) => jobChanges(workspace(id).jobs.watch()),

    "job.write": async ({ workspace: id, job }, { body }) => {
      await workspace(id)
        .job(job)
        .write(await readBytes(body));

      return null;
    },
    "job.output": async ({ workspace: id, job }) => workspace(id).job(job).output(),
    "job.resize": ({ workspace: id, job, size }) => workspace(id).job(job).resize(size),
    "job.idle": ({ workspace: id, job }) => workspace(id).job(job).idle(),
    "job.stop": ({ workspace: id, job }) => workspace(id).job(job).stop(),
    "job.settled": ({ workspace: id, job }, { signal }) =>
      workspace(id).job(job).settled({ signal }),

    "files.read": async ({ workspace: id, path }) => (await files(id)).read(path),
    "files.bytes": async ({ workspace: id, path }) => {
      const reader = await (await files(id)).bytes(path);

      const version =
        "version" in reader && typeof reader.version === "string" ? reader.version : null;

      return version === null ? { reader } : { reader, headers: { "X-Nyte-Version": version } };
    },
    "files.stat": async ({ workspace: id, path }) => (await files(id)).stat(path),
    "files.write": async ({ workspace: id, path, options }, { body }) =>
      (await files(id)).write(path, await readBytes(body), options),
    "files.remove": async ({ workspace: id, path, options }) =>
      (await files(id)).remove(path, options),
    "files.batch": async ({ workspace: id, entries, id: receipt }) => ({
      receipt: (await wire.batch(id, await files(id), entries, receipt)).id,
    }),
    "files.format": async ({ workspace: id, path, contents }) =>
      (await files(id)).format(path, contents),
    "files.scan": async ({ workspace: id, directory, ignored }) =>
      (await files(id)).scan({ directory, ignored }),
    "files.find": async ({ workspace: id, query, limit }) =>
      (await files(id)).find({ query, limit }),
    "files.search": async ({ workspace: id, ...input }) => (await files(id)).search(input),
    "files.watch": async ({ workspace: id, paths }) => (await files(id)).watch({ paths }),
    "files.upload": async ({ workspace: id }, { body }) =>
      (await files(id)).upload(readChunks(body)),

    "git.status": async ({ workspace: id }) => (await git(id)).status(),
    "git.watch": async ({ workspace: id }) => (await git(id)).watch(),
    "git.changes": async ({ workspace: id, scope, options }) =>
      (await git(id)).changes(scope, options),
    "git.watchChanges": async ({ workspace: id, scope, options }) =>
      (await git(id)).watchChanges(scope, options),
    "git.patches": async ({ workspace: id, scope, paths, options }) =>
      mapped((await git(id)).patches(scope, paths, options), patchesWire),
    "git.contents": async ({ workspace: id, path, scope }) => (await git(id)).contents(path, scope),
    "git.log": async ({ workspace: id, cursor, limit }) => (await git(id)).log({ cursor, limit }),
    "git.refs": async ({ workspace: id }) => (await git(id)).refs(),
    "git.blame": async ({ workspace: id, path }) => (await git(id)).blame(path),
    "git.stage": async ({ workspace: id, paths, options }) => (await git(id)).stage(paths, options),
    "git.unstage": async ({ workspace: id, paths, options }) =>
      (await git(id)).unstage(paths, options),
    "git.discard": async ({ workspace: id, paths, options }) =>
      (await git(id)).discard(paths, options),
    "git.commit": async ({ workspace: id, input, options }) =>
      (await git(id)).commit(input, options),
    "git.branch": async ({ workspace: id, input, options }) =>
      (await git(id)).branch(input, options),
    "git.push": async ({ workspace: id, input, options }) => (await git(id)).push(input, options),

    "github.account": () => connection.github.account(),
    "github.signIn": () => connection.github.signIn(),
    "github.signOut": () => connection.github.signOut(),
    "github.state": async ({ workspace: id }) => (await github(id)).state(),
    "github.createPullRequest": async ({ workspace: id, input }) =>
      (await github(id)).createPullRequest(input),

    "browser.open": async ({ workspace: id, url, id: key }) => {
      const api = await browser(id);

      return describePage(
        hold(
          await wire.openPage({
            id: key,
            input: { workspace: id, url },
            open: () => api.open({ url }),
          }),
        ),
      );
    },
    "browser.adopt": async ({ workspace: id, id: page }) =>
      describePage(hold(await (await browser(id)).adopt(page))),
    "browser.list": async ({ workspace: id }) => (await browser(id)).list(),
    "browser.watch": async ({ workspace: id }) => (await browser(id)).watch(),

    "page.view": async ({ workspace: id, page }) => (await findPage(id, page)).view(),
    "page.watch": async ({ workspace: id, page }) => (await findPage(id, page)).watch(),
    "page.snapshot": async ({ workspace: id, page, ref }) =>
      (await findPage(id, page)).snapshot({ ref }),
    "page.navigate": async ({ workspace: id, page, url }) =>
      (await findPage(id, page)).navigate(url),
    "page.back": async ({ workspace: id, page }) => (await findPage(id, page)).back(),
    "page.forward": async ({ workspace: id, page }) => (await findPage(id, page)).forward(),
    "page.reload": async ({ workspace: id, page }) => (await findPage(id, page)).reload(),
    "page.stopLoading": async ({ workspace: id, page }) => (await findPage(id, page)).stopLoading(),
    "page.click": async ({ workspace: id, page, ref, button, double, expect }) =>
      (await findPage(id, page)).click({ ref, button, double, expect }),
    "page.type": async ({ workspace: id, page, ref, text, clear, submit, expect }) =>
      (await findPage(id, page)).type({ ref, text, clear, submit, expect }),
    "page.press": async ({ workspace: id, page, key, ref }) =>
      (await findPage(id, page)).press({ key, ref }),
    "page.scroll": async ({ workspace: id, page, direction, ref, pages: count }) =>
      (await findPage(id, page)).scroll({ direction, ref, pages: count }),
    "page.wait": async ({ workspace: id, page, condition }) =>
      (await findPage(id, page)).wait(condition),
    "page.console": async ({ workspace: id, page, limit, clear }) =>
      (await findPage(id, page)).console({ limit, clear }),
    "page.capture": async ({ workspace: id, page }) => ({
      reader: await (await findPage(id, page)).capture(),
    }),
    "page.evaluate": async ({ workspace: id, page, expression, options }) =>
      (await findPage(id, page)).evaluate(expression, options),
    "page.close": async ({ page }) => {
      await release(page);

      return null;
    },

    "plugins.replace": ({ plugins, scope }) => connection.plugins.replace(plugins, scope),
    "plugins.check": ({ plugins }) => connection.plugins.check(plugins),

    "principals.list": async () =>
      (await connection.principals.list()).map((view) => ({
        ...view,
        authority: [...view.authority],
      })),
    "principals.pair": ({ authority, label }) =>
      connection.principals.pair({ authority: new Set(authority), label }),
    "principals.revoke": async ({ id }) => {
      await connection.principals.revoke(id);

      return null;
    },
  };
}

/** The wire form of a job list watch: the whole list first, then each job the next list moved (a new view object) or dropped, alone. */
async function* jobChanges(lists: AsyncIterable<readonly JobView[]>): AsyncIterable<JobsChange> {
  let previous: readonly JobView[] | null = null;

  for await (const jobs of lists) {
    if (previous === null) yield { kind: "jobs", jobs };
    else {
      const kept = new Set(jobs.map((job) => job.id));
      const unmoved = new Set(previous);

      for (const job of previous) if (!kept.has(job.id)) yield { kind: "forgotten", id: job.id };

      for (const job of jobs) if (!unmoved.has(job)) yield { kind: "job", job };
    }

    previous = jobs;
  }
}

async function* readChunks(body: ReadableStream<Uint8Array> | null): AsyncGenerator<Uint8Array> {
  if (body === null) return;
  const reader = body.getReader();

  try {
    for (;;) {
      const read = await reader.read();

      if (read.done) return;
      yield read.value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function readBytes(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of readChunks(body)) chunks.push(chunk);
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function hostWire(view: HostView, principal: PrincipalId): HostViewWire {
  return { ...view, authority: [...view.authority], principal };
}

function patchesWire(set: PatchSet): PatchSetWire {
  return { revision: set.revision, entries: Object.fromEntries(set.entries) };
}

function capabilityWire<T>(capability: Capability<T>): CapabilityWire {
  if (capability.kind !== "available") return capability;

  return { kind: "available" };
}

function available<T>(capability: Capability<T>, what: string): T {
  if (capability.kind === "available") return capability.api;

  if (capability.kind === "denied") fail("denied", `${what}: ${capability.reason}`);

  return fail("unavailable", `${what}: ${capability.reason}`);
}

function toJson(value: unknown): Json {
  return isJson(value) ? value : null;
}

function principalKey(principal: PrincipalId, name: string): string {
  return JSON.stringify([principal, name]);
}

function fail(code: "unknown" | "invalid" | "denied" | "unavailable", message: string): never {
  throw new SdkError(code, message);
}
