import { asId, asSeq, isJson } from "@nyte-ai/schema";
import type {
  ByteReader,
  Capability,
  CapabilityWire,
  CommitId,
  HeadName,
  HostView,
  HostViewWire,
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
import {
  SdkError,
  advanceSeen,
  applyBatch,
  dev,
  headRef,
  heldReceipt,
  move,
  sendReceipt,
  sessionEvents,
} from "@nyte-ai/core";
import type {
  BrowserApi,
  Connection,
  FeedItem,
  FilesApi,
  GitApi,
  Job,
  Kernel,
  Login,
  Page,
  Receipt,
} from "@nyte-ai/core";
import type {
  Declarations,
  OperationInput,
  OperationName,
  OperationOutput,
} from "./declarations.ts";
import { mapped } from "./streams.ts";

/** Returns what a row's binding receives besides its input: the request's body (the bytes of `files.write`, `job.write` and `files.upload`) and the client's abort signal. */
export type BindingRequest = {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly signal: AbortSignal;
};

/** Returns a byte row's answer: the reader and the headers the response adds (`X-Nyte-Version` for `files.bytes`, §40p). */
export type ByteBody = {
  readonly reader: ByteReader;
  readonly headers?: Readonly<Record<string, string>>;
};

/** Names the rows answered once with JSON: queries, commands and receipts. */
export type CallName = {
  [N in OperationName]: Declarations[N]["kind"] extends "query" | "command" | "receipt" ? N : never;
}[OperationName];

/** Names the stream rows whose frames are bytes, answered as a raw octet stream. */
export type ByteName = {
  [N in OperationName]: Declarations[N]["kind"] extends "stream"
    ? OperationOutput<N> extends Uint8Array
      ? N
      : never
    : never;
}[OperationName];

/** Names the rows answered with JSON frames over server-sent events: every watch and the JSON streams. */
export type FrameName = Exclude<
  {
    [N in OperationName]: Declarations[N]["kind"] extends "watch" | "stream" ? N : never;
  }[OperationName],
  ByteName | "job.output"
>;

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
export type OutputBinding = {
  readonly "job.output": (
    input: OperationInput<"job.output">,
    request: BindingRequest,
  ) => Promise<AsyncIterable<OutputFrame>>;
};

/** Returns the server side of the table for one connection: each row takes its decoded input and the request's body and abort signal, and answers its output, its frames, or a byte reader; setup failures (authority, capability, unknown ids) reject before any frame. */
export type Binding = CallBinding & FrameBinding & ByteBinding & OutputBinding;

/** Describes what a binding needs beyond the connection: the kernel, for the rows that carry a wire-only id (§40o), `head.watch` and `parts.create`. */
export type BindingOptions = {
  readonly kernel: Kernel;
};

const LOGIN_LIFETIME = 10 * 60 * 1000;

const SEEN_DELAY = 16;

type Attempt = {
  readonly login: Login;
  readonly timer: ReturnType<typeof setTimeout>;
  steps: AsyncIterator<OperationOutput<"login.steps">> | null;
};

const attempts = new WeakMap<Kernel, Map<string, Attempt>>();

const holds = new WeakMap<Kernel, Map<string, Page[]>>();

/** Returns each row bound to the call it names: ids bind handles on the connection, handles returned become ids, `Set`s and `Map`s become their wire forms; `head.move`, `files.batch` and `browser.open` go through core's kernel-level functions with their wire id (§40o, §40x). `head.watch` sends the watched head's pair first, then `sessionEvents` after `after` with each head-moving event's pair behind it, and marks the principal's seen tip from the live feed only (§40a, §54a). Authority is the caller's gate: the server checks each row's before binding. */
export function bindConnection(connection: Connection, options: BindingOptions): Binding {
  const { kernel } = options;
  const { principal } = connection;
  const logins = attempts.get(kernel) ?? new Map<string, Attempt>();
  attempts.set(kernel, logins);
  const pages = holds.get(kernel) ?? new Map<string, Page[]>();
  holds.set(kernel, pages);

  const session = (id: SessionId) => connection.session(id);
  const workspace = (id: WorkspaceId) => connection.workspace(id);

  const files = async (id: WorkspaceId): Promise<FilesApi> =>
    available(await workspace(id).files(), "files");

  const git = async (id: WorkspaceId): Promise<GitApi> =>
    available(await workspace(id).git(), "git");

  const browser = async (id: WorkspaceId): Promise<BrowserApi> =>
    available(await workspace(id).browser(), "browser");

  const attemptOf = (provider: string): Attempt =>
    logins.get(keyOf(principal, provider)) ??
    fail("unknown", `No login for ${provider} is in progress.`);

  const endLogin = (provider: string, attempt: Attempt): void => {
    clearTimeout(attempt.timer);
    const key = keyOf(principal, provider);

    if (logins.get(key) === attempt) logins.delete(key);
    void attempt.steps?.return?.();
  };

  const hold = (page: Page): Page => {
    const key = keyOf(principal, page.id);
    const known = pages.get(key) ?? [];
    pages.set(key, known.includes(page) ? known : [...known, page]);

    return page;
  };

  const release = async (page: PageId): Promise<void> => {
    const key = keyOf(principal, page);
    const [last, ...rest] = [...(pages.get(key) ?? [])].reverse();

    if (rest.length === 0) pages.delete(key);
    else pages.set(key, rest.reverse());
    await last?.close();
  };

  const pageOf = async (at: WorkspaceId, id: PageId): Promise<Page> =>
    pages.get(keyOf(principal, id))?.[0] ??
    kernel.pages.page(id) ??
    hold(await (await browser(at)).adopt(id));

  const infoOf = async (page: Page): Promise<PageInfo> => {
    const view = await page.view();

    return {
      id: page.id,
      url: view.url,
      title: view.title,
      holders: kernel.pages.holders(page.id),
    };
  };

  const receiptOf = (at: SessionId | null, id: ReceiptId): Receipt<unknown> | undefined =>
    at === null ? heldReceipt(kernel, id) : session(at).receipt(id);

  const jobOf = (job: Job): OperationOutput<"jobs.start"> => ({
    ...(kernel.jobs.get(job.id)?.view ?? fail("unknown", `Job ${job.id} is gone.`)),
    key: job.key,
  });

  return {
    "connection.watch": async () => mapped(connection.watch(), (view) => hostWire(view, principal)),
    "connection.blob": async ({ id }) => ({ reader: await connection.blob(id) }),

    "models.list": () => connection.models.list(),
    "models.refresh": async ({ provider }) => {
      await connection.models.refresh(provider);

      return null;
    },
    "models.setDefault": ({ ref }) => connection.models.setDefault(ref),
    "models.verify": ({ provider }) => connection.models.verify(provider),
    "models.login": async ({ provider, method }) => {
      const login = connection.models.login({ provider, method });
      const key = keyOf(principal, provider);
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
      const attempt = attemptOf(provider);

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
      await attemptOf(provider).login.answer(code);

      return null;
    },

    "settings.apply": ({ id, value }) => connection.settings.apply(id, value),

    "workspaces.list": () => connection.workspaces.list(),
    "workspaces.inspect": ({ target }) => connection.workspaces.inspect(target),
    "workspaces.add": ({ target, options }) => connection.workspaces.add(target, options),
    "workspaces.forget": ({ id }) => connection.workspaces.forget(id),

    "sessions.watch": async (input) => connection.sessions.watch(input),
    "sessions.create": async (input) => ({ session: (await connection.sessions.create(input)).id }),
    "sessions.list": (input) => connection.sessions.list(input),

    "session.info": ({ session: id }) => session(id).info(),
    "session.update": ({ session: id, patch }) => session(id).update(patch),
    "session.remove": ({ session: id }) => session(id).remove(),
    "session.stop": ({ session: id }) => session(id).stop(),
    "session.command": ({ session: id, name, args }) => session(id).command(name, args),

    "head.send": async ({ session: id, head, content, options }) => {
      const receipt = await session(id).head(head).send(content, options);

      return { receipt: receipt.id, message: receipt.message };
    },
    "head.configure": ({ session: id, head, patch }) => session(id).head(head).configure(patch),
    "head.view": ({ session: id, head, options }) => session(id).head(head).view(options),
    "head.watch": async ({ session: id, head, after }) => {
      await session(id).info();
      const ref = await kernel.store.refs.get(headRef(id, head));
      const events = sessionEvents(kernel, id, after ?? asSeq(0));

      const pair =
        ref === null || ref.target === null
          ? { tip: null, revision: asId<"revision">("") }
          : { tip: asId<"commit">(ref.target), revision: ref.revision };

      return revisions(
        { kind: "revision", head, ...pair },
        seeing(kernel, principal, id, head, events),
      );
    },
    "head.history": ({ session: id, head, before, limit }) =>
      session(id).head(head).history({ before, limit }),
    "head.tree": ({ session: id, head }) => session(id).head(head).tree(),
    "head.move": async ({ session: id, head, position, options, id: receipt }) => ({
      receipt: (await move(kernel, id, head, position, { ...options, id: receipt })).id,
    }),
    "head.compact": ({ session: id, head, instructions }) =>
      session(id).head(head).compact({ instructions }),

    "heads.create": ({ session: id, name, input }) => session(id).heads.create(name, input),
    "heads.merge": ({ session: id, name, options }) => session(id).heads.merge(name, options),
    "heads.remove": ({ session: id, name, options }) => session(id).heads.remove(name, options),

    "run.stop": ({ session: id, run }) => session(id).run(run).stop(),
    "run.settled": ({ session: id, run }, { signal }) => session(id).run(run).settled({ signal }),

    "receipt.status": async ({ session: id, receipt }) => {
      const status = (await receiptOf(id, receipt)?.status()) ?? { kind: "missing" };

      return status.kind === "settled"
        ? { kind: "settled", outcome: jsonOf(status.outcome) }
        : status;
    },
    "receipt.settled": async ({ session: id, receipt }, { signal }) => {
      const handle = receiptOf(id, receipt) ?? fail("unknown", `No receipt has the id ${receipt}.`);

      return jsonOf(await handle.settled({ signal }));
    },
    "receipt.stop": async ({ session: id, receipt }) => {
      const stopped = (await receiptOf(id, receipt)?.stop()) ?? { kind: "missing" };

      return stopped.kind === "settled"
        ? { kind: "settled", outcome: jsonOf(stopped.outcome) }
        : stopped;
    },
    "receipt.landed": async ({ session: id, receipt }) =>
      sendReceipt(
        kernel,
        id ?? fail("invalid", "Only a send's receipt has landed."),
        receipt,
      ).landed(),

    "parts.create": async ({ session: id, kind, input }) => {
      await kernel.pluginsFor(id).ready;
      const registered = kernel.partDefinitions.get(kind);

      if (registered === undefined) fail("unknown", `No part definition has the kind ${kind}.`);

      return { part: (await session(id).parts.create(registered.definition, input)).id };
    },
    "part.update": ({ session: id, part, next }) => session(id).part(part).update(next),
    "part.act": async ({ session: id, part, action, input }) => {
      const outcome = await session(id).part(part).act(action, input);

      return outcome.kind === "ok" ? { kind: "ok", output: jsonOf(outcome.output) } : outcome;
    },
    "part.answer": async ({ session: id, part }) => {
      const answer = await session(id).part(part).answer();

      return answer === null
        ? null
        : { action: String(answer.action), input: jsonOf(answer.input) };
    },
    "part.close": async ({ session: id, part }) => {
      await session(id).part(part).close();

      return null;
    },

    "workspace.info": ({ workspace: id }) => workspace(id).info(),
    "workspace.watch": async ({ workspace: id }) => workspace(id).watch(),
    "workspace.update": ({ workspace: id, patch }) => workspace(id).update(patch),
    "workspace.reload": ({ workspace: id }) => workspace(id).reload(),
    "workspace.changes": ({ workspace: id, run }) => workspace(id).changes(run),
    "workspace.patches": async ({ workspace: id, run, paths, options }) =>
      mapped(workspace(id).patches(run, paths, options), patchesWire),
    "workspace.files": async ({ workspace: id }) => capabilityWire(await workspace(id).files()),
    "workspace.git": async ({ workspace: id }) => capabilityWire(await workspace(id).git()),
    "workspace.browser": async ({ workspace: id }) => capabilityWire(await workspace(id).browser()),

    "jobs.start": async ({ workspace: id, command, session, title, pty, id: job }) =>
      jobOf(await workspace(id).jobs.start({ command, session, title, pty, id: job })),
    "jobs.recover": async ({ workspace: id, key }) => {
      const recovered = await workspace(id).jobs.recover(key);

      return "id" in recovered ? jobOf(recovered) : recovered;
    },
    "jobs.list": ({ workspace: id }) => workspace(id).jobs.list(),
    "jobs.watch": async ({ workspace: id }) => workspace(id).jobs.watch(),

    "job.write": async ({ workspace: id, job }, { body }) => {
      await workspace(id)
        .job(job)
        .write(await bytesOf(body));

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
      (await files(id)).write(path, await bytesOf(body), options),
    "files.remove": async ({ workspace: id, path, options }) =>
      (await files(id)).remove(path, options),
    "files.batch": async ({ workspace: id, entries, id: receipt }) => ({
      receipt: (
        await applyBatch(kernel, { workspace: id }, await files(id), entries, { id: receipt })
      ).id,
    }),
    "files.format": async ({ workspace: id, path, contents }) =>
      (await files(id)).format(path, contents),
    "files.scan": async ({ workspace: id, directory, ignored }) =>
      (await files(id)).scan({ directory, ignored }),
    "files.find": async ({ workspace: id, query, limit }) =>
      (await files(id)).find({ query, limit }),
    "files.search": async ({ workspace: id, query, limit }) =>
      (await files(id)).search({ query, limit }),
    "files.watch": async ({ workspace: id, paths }) => (await files(id)).watch({ paths }),
    "files.upload": async ({ workspace: id }, { body }) => (await files(id)).upload(chunksOf(body)),

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

    "browser.open": async ({ workspace: id, url, id: key }) => {
      const api = await browser(id);

      return infoOf(
        hold(
          await kernel.pages.open({
            id: key,
            input: { workspace: id, url },
            open: () => api.open({ url }),
          }),
        ),
      );
    },
    "browser.adopt": async ({ workspace: id, id: page }) =>
      infoOf(hold(await (await browser(id)).adopt(page))),
    "browser.list": async ({ workspace: id }) => (await browser(id)).list(),
    "browser.watch": async ({ workspace: id }) => (await browser(id)).watch(),

    "page.view": async ({ workspace: id, page }) => (await pageOf(id, page)).view(),
    "page.watch": async ({ workspace: id, page }) => (await pageOf(id, page)).watch(),
    "page.snapshot": async ({ workspace: id, page, ref }) =>
      (await pageOf(id, page)).snapshot({ ref }),
    "page.navigate": async ({ workspace: id, page, url }) => (await pageOf(id, page)).navigate(url),
    "page.back": async ({ workspace: id, page }) => (await pageOf(id, page)).back(),
    "page.forward": async ({ workspace: id, page }) => (await pageOf(id, page)).forward(),
    "page.reload": async ({ workspace: id, page }) => (await pageOf(id, page)).reload(),
    "page.stopLoading": async ({ workspace: id, page }) => (await pageOf(id, page)).stopLoading(),
    "page.click": async ({ workspace: id, page, ref, button, double, expect }) =>
      (await pageOf(id, page)).click({ ref, button, double, expect }),
    "page.type": async ({ workspace: id, page, ref, text, clear, submit, expect }) =>
      (await pageOf(id, page)).type({ ref, text, clear, submit, expect }),
    "page.press": async ({ workspace: id, page, key, ref }) =>
      (await pageOf(id, page)).press({ key, ref }),
    "page.scroll": async ({ workspace: id, page, direction, ref, pages: count }) =>
      (await pageOf(id, page)).scroll({ direction, ref, pages: count }),
    "page.wait": async ({ workspace: id, page, condition }) =>
      (await pageOf(id, page)).wait(condition),
    "page.console": async ({ workspace: id, page, limit, clear }) =>
      (await pageOf(id, page)).console({ limit, clear }),
    "page.capture": async ({ workspace: id, page }) => ({
      reader: await (await pageOf(id, page)).capture(),
    }),
    "page.evaluate": async ({ workspace: id, page, expression, options }) =>
      (await pageOf(id, page)).evaluate(expression, options),
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

/** Forwards a session's events and, once the feed is live (the first seed or patch), writes the principal's seen mark for each tip change one frame after it lands or when the stream closes (§40a, §40x). Replayed history moves the tracked tip and writes nothing, so a watch closed mid-replay leaves the mark where it was. A failed write is a `dev` line. */
function seeing(
  kernel: Kernel,
  principal: PrincipalId,
  session: SessionId,
  head: HeadName,
  source: AsyncIterable<FeedItem>,
): AsyncIterable<FeedItem> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();
      let live = false;
      let tip: CommitId | null | undefined;
      let seen: CommitId | null | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let writing: Promise<void> = Promise.resolve();

      const write = (): Promise<void> => {
        clearTimeout(timer);
        timer = undefined;
        const commit = tip;

        if (!live || commit === undefined || commit === seen) return writing;
        seen = commit;

        writing = writing
          .then(() => advanceSeen(kernel, { session, principal, head, commit }))
          .catch(() => dev("binding", "seen failed", { session, head }));

        return writing;
      };

      const schedule = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => void write(), SEEN_DELAY);
      };

      return {
        async next() {
          const next = await iterator.next();

          if (next.done === true) {
            await write();

            return next;
          }

          const event = next.value.event;

          if (event.kind === "seen" && event.head === head && event.principal === principal)
            seen = event.commit;
          else if ((event.kind === "commit" || event.kind === "head") && event.head === head) {
            tip = event.kind === "commit" ? event.id : event.to;

            if (live) schedule();
          }

          if (!live && (event.kind === "patch" || event.seq === 0)) {
            live = true;
            schedule();
          }

          return next;
        },
        async return() {
          await iterator.return?.();
          await write();

          return { done: true, value: undefined };
        },
      };
    },
  };
}

/** Yields the watched head's pair first, then the session's events, each `commit` or `head` event followed at once by the pair its feed item carries, so the client applies tip and revision together (§40s, §54a). */
function revisions(
  first: OperationOutput<"head.watch">,
  source: AsyncIterable<FeedItem>,
): AsyncIterable<OperationOutput<"head.watch">> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();
      let after: OperationOutput<"head.watch"> | null = first;

      return {
        async next(): Promise<IteratorResult<OperationOutput<"head.watch">>> {
          if (after !== null) {
            const value = after;
            after = null;

            return { done: false, value };
          }

          const next = await iterator.next();

          if (next.done === true) return next;
          const { event, head: pair } = next.value;

          if (
            (event.kind === "commit" || event.kind === "head") &&
            event.head !== null &&
            pair !== null
          )
            after = { kind: "revision", head: event.head, ...pair };

          return { done: false, value: event };
        },
        async return() {
          await iterator.return?.();

          return { done: true, value: undefined };
        },
      };
    },
  };
}

async function* chunksOf(body: ReadableStream<Uint8Array> | null): AsyncGenerator<Uint8Array> {
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

async function bytesOf(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of chunksOf(body)) chunks.push(chunk);
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

function jsonOf(value: unknown): Json {
  return isJson(value) ? value : null;
}

function keyOf(principal: PrincipalId, name: string): string {
  return JSON.stringify([principal, name]);
}

function fail(code: "unknown" | "invalid" | "denied" | "unavailable", message: string): never {
  throw new SdkError(code, message);
}
