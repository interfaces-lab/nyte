import { QueryObserver } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { asId } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/sdk";
import type { ClientConnection, Health } from "@nyte-ai/sdk/client";
import {
  connected,
  connection,
  currentConnection,
  installConnection,
  installedLive,
  onInstall,
} from "./connection.ts";
import { keys, queryClient } from "./query-client.ts";
import { scriptedConnection, viewStream } from "../../test/scripted-connection.ts";
import type { ViewStream } from "../../test/scripted-connection.ts";

const closed: string[] = [];

function named(name: string): ClientConnection {
  return {
    ...scriptedConnection().connection,
    close: async () => {
      closed.push(name);
    },
  };
}

const connections = new Map([
  ["a", named("a")],
  ["b", named("b")],
]);

function nameFor(current: ClientConnection | undefined): string | undefined {
  return [...connections].find((entry) => entry[1] === current)?.[0];
}

async function settled(waiter: Promise<ClientConnection>): Promise<string | undefined> {
  const won = await Promise.race([waiter, Promise.resolve("pending" as const)]);

  return won === "pending" ? won : nameFor(won);
}

const heard: boolean[] = [];

onInstall((replaced) => heard.push(replaced));

const health = installedLive((current) => current.health);

let follows = 0;

health.subscribe(() => {
  follows += 1;
});

test.each<{
  readonly name: string;
  readonly install: string | null;
  readonly current: string | undefined;
  readonly waiterBefore: string | undefined;
  readonly waiterAfter: string | undefined;
  readonly heard: readonly boolean[];
  readonly follows: number;
  readonly closed: readonly string[];
}>([
  {
    name: "before any install nothing is current and a waiter waits",
    install: null,
    current: undefined,
    waiterBefore: "pending",
    waiterAfter: "pending",
    heard: [],
    follows: 0,
    closed: [],
  },
  {
    name: "the first install resolves a waiter and is heard as no replacement",
    install: "a",
    current: "a",
    waiterBefore: "a",
    waiterAfter: "a",
    heard: [false],
    follows: 1,
    closed: [],
  },
  {
    name: "a second connection replaces the first, closes it and is heard as a replacement",
    install: "b",
    current: "b",
    waiterBefore: "a",
    waiterAfter: "b",
    heard: [false, true],
    follows: 2,
    closed: ["a"],
  },
  {
    name: "installing the current connection again is heard as a replacement and closes nothing",
    install: "b",
    current: "b",
    waiterBefore: "b",
    waiterAfter: "b",
    heard: [false, true, true],
    follows: 3,
    closed: ["a"],
  },
])("$name", async (row) => {
  const before = connected();
  const next = row.install === null ? undefined : connections.get(row.install);

  if (next !== undefined) installConnection(next);

  if (row.current === undefined) expect(connection).toThrow("No Nyte connection is installed");

  expect({
    current: nameFor(currentConnection()),
    held: currentConnection() === undefined ? undefined : nameFor(connection()),
    waiterBefore: await settled(before),
    waiterAfter: await settled(connected()),
    heard,
    follows,
    health: health.read()?.kind,
    closed,
  }).toEqual({
    current: row.current,
    held: row.current,
    waiterBefore: row.waiterBefore,
    waiterAfter: row.waiterAfter,
    heard: row.heard,
    follows: row.follows,
    health: row.current === undefined ? undefined : "open",
    closed: row.closed,
  });
});

function onHost(hostId: string, health?: ViewStream<Health>): ClientConnection {
  return { ...scriptedConnection({ health }).connection, hostId: asId<"host">(hostId) };
}

test.each<{
  readonly name: string;
  readonly host: string;
  readonly hostRead: string | undefined;
  readonly windowRead: string | undefined;
}>([
  {
    name: "a connection to the same host keeps the host reads it cached",
    host: "scripted",
    hostRead: "cached",
    windowRead: "cached",
  },
  {
    name: "a connection to another host drops the host reads and keeps the window's",
    host: "other",
    hostRead: undefined,
    windowRead: "cached",
  },
])("$name", async (row) => {
  installConnection(onHost("scripted"));
  queryClient.setQueryData(keys.document("notes.md"), "cached");
  queryClient.setQueryData(keys.server, "cached");
  installConnection(onHost(row.host));

  expect({
    hostRead: queryClient.getQueryData(keys.document("notes.md")),
    windowRead: queryClient.getQueryData(keys.server),
  }).toEqual({ hostRead: row.hostRead, windowRead: row.windowRead });
  queryClient.clear();
});

const RETRYING: Health = {
  kind: "retrying",
  attempt: 1,
  at: 0,
  error: new SdkError("unavailable", "Link down."),
};

test.each<{
  readonly name: string;
  readonly key: QueryKey;
  readonly next: Health;
  readonly reads: number;
}>([
  {
    name: "a host read that failed while the link was down reads again when it opens",
    key: keys.document("notes.md"),
    next: { kind: "open", since: 1 },
    reads: 2,
  },
  {
    name: "a host read that failed waits while the link is still down",
    key: keys.document("notes.md"),
    next: { ...RETRYING, attempt: 2 },
    reads: 1,
  },
  {
    name: "a read the host doesn't answer is left failed when the link opens",
    key: keys.server,
    next: { kind: "open", since: 1 },
    reads: 1,
  },
])("$name", async (row) => {
  const health = viewStream<Health>(RETRYING);
  installConnection(onHost("scripted", health));
  let reads = 0;

  const observer = new QueryObserver(queryClient, {
    queryKey: row.key,
    queryFn: async () => {
      reads += 1;

      if (reads === 1) throw new Error("Link down.");

      return "read";
    },
  });

  const leave = observer.subscribe(() => undefined);
  await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe("error"));
  health.push(row.next);

  expect(reads).toBe(row.reads);
  leave();
  queryClient.clear();
});

test("a store read through installedLive follows each connection and closes what it opened", () => {
  const log: string[] = [];
  const a = onHost("scripted");
  const b = onHost("scripted");
  installConnection(a);

  const followed = installedLive(
    (current) => {
      const name = current === a ? "a" : "b";
      log.push(`open ${name}`);

      return { ...current.health, name };
    },
    (opened) => log.push(`close ${opened.name}`),
  );

  const leave = followed.subscribe(() => undefined);
  followed.read();
  installConnection(b);
  followed.read();
  leave();

  expect(log).toEqual(["open a", "close a", "open b", "close b"]);
});
