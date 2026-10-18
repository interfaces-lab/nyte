import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { ConnectRuntime, hostShare } from "@nyte-ai/connect/host";
import { openHost } from "@nyte-ai/host";
import { fakeModels } from "@nyte-ai/bench";
import type { SessionId, SessionView } from "@nyte-ai/sdk";
import { desktopService, retireService, stopService } from "@nyte-ai/service";
import type { Registration } from "@nyte-ai/service";
import { expect, test } from "bun:test";
import { readCodeId } from "../src/code-id.ts";
import { connectLocalService } from "../src/service.ts";
import { VERSION } from "../src/version.ts";

const BINARY = join(import.meta.dir, "..", "src", "binary.ts");

const TOKEN = "a".repeat(32);

async function openApp(home: string, cwd: string) {
  const fake = fakeModels();
  const host = await openHost({
    home,
    workspace: { kind: "local", path: cwd },
    models: fake.models,
  });

  const connect = new ConnectRuntime({
    config: undefined,
    home: join(home, ".nyte"),
    authorizer: undefined,
    onChange: () => service.connectChanged(),
  });

  const service = desktopService({
    home,
    token: TOKEN,
    version: VERSION,
    connect,
    share: hostShare(host),
  });

  const listener = await host.listen({
    transport: { kind: "http", port: 0 },
    auth: { kind: "token", token: TOKEN },
    before: service.before,
  });

  await service.register({ url: listener.address ?? "", hostId: host.hostId });

  return {
    host,
    fake,
    async close() {
      await service.close();
      await connect.close();
      await host.close();
    },
  };
}

function nextRegistration(following: {
  subscribe(listener: (registration: Registration) => void): () => void;
}): Promise<Registration> {
  return new Promise((resolve) => {
    const leave = following.subscribe((registration) => {
      leave();
      resolve(registration);
    });
  });
}

async function nextView(
  views: AsyncIterator<SessionView>,
  seen: Set<SessionView>,
): Promise<SessionView> {
  for (;;) {
    const next = await views.next();

    if (next.done === true) throw new Error("The session watch ended.");

    if (!seen.has(next.value)) {
      seen.add(next.value);

      return next.value;
    }
  }
}

test("a nyte follows its chats from Nyte.app to the service it starts and back when the app returns", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-follow-")));
  const home = join(root, "home");
  const cwd = join(root, "workspace");
  await mkdir(join(home, ".nyte"), { recursive: true, mode: 0o700 });
  await mkdir(cwd, { recursive: true });

  const app = await openApp(home, cwd);
  app.fake.reply({ content: [{ type: "text", text: "Opened in the app." }] });
  const { session, receipt } = await app.host.sessions.start({ content: "Hi" });
  await receipt.settled();
  const id: SessionId = session.id;

  const tui = await connectLocalService({
    home,
    version: VERSION,
    code: await readCodeId(),
    command: [process.execPath, BINARY, "service", "run"],
  });

  try {
    expect(tui.following.current()?.owner).toBe("desktop");
    const views = tui.connection.session(id).watch()[Symbol.asyncIterator]();
    const seen = new Set<SessionView>();
    expect((await nextView(views, seen)).messages.length).toBeGreaterThan(0);

    const toService = nextRegistration(tui.following);
    await app.close();
    const service = await toService;
    expect(service.owner).toBeUndefined();
    expect((await tui.connection.session(id).info()).id).toBe(id);
    expect((await nextView(views, seen)).messages.length).toBeGreaterThan(0);

    const toApp = nextRegistration(tui.following);
    expect((await retireService(home)).kind).toBe("stopped");
    const again = await openApp(home, cwd);

    try {
      expect((await toApp).owner).toBe("desktop");
      expect((await tui.connection.session(id).info()).id).toBe(id);
      expect((await nextView(views, seen)).messages.length).toBeGreaterThan(0);
    } finally {
      await views.return?.();
      await tui.connection.close();
      await again.close();
    }
  } finally {
    await stopService(home);
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
