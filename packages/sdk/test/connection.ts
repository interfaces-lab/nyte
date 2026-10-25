import { inflateRawSync } from "node:zlib";
import type { SessionView } from "@nyte-ai/schema";
import { isPart, text as textPart } from "@nyte-ai/core";
import type { Connection, Session } from "@nyte-ai/core";
import { parseSse, readStreamFrame } from "@nyte-ai/protocol";
import { connect } from "../src/connect.ts";
import { createSendJournal } from "../src/journal.ts";
import { BASE, TOKEN_SECRET, served } from "./served.ts";
import type { Served } from "./served.ts";

export const cleanups: (() => Promise<void>)[] = [];

/** Runs, newest first, the cleanup of every host and connection a test opened; register it with `afterEach`. */
export async function closeOpened(): Promise<void> {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
}

export async function open(options?: Parameters<typeof served>[0]): Promise<Served> {
  const host = await served(options);
  cleanups.push(() => host.close());

  return host;
}

export async function client(host: Served, journal = createSendJournal()): Promise<Connection> {
  const connection = await connect({
    url: BASE,
    credentials: { kind: "token", token: TOKEN_SECRET },
    fetch: host.fetch,
    journal,
  });

  cleanups.push(() => connection.close());

  return connection;
}

/** Starts a chat whose first exchange, `Hi.` answered `Ready.`, has settled, so a test begins from an idle chat. */
export async function settledChat(host: Served, connection: Connection): Promise<Session> {
  host.fake.reply(text("Ready."));
  const { session, receipt } = await connection.sessions.start({ content: "Hi." });
  await receipt.settled();

  return session;
}

export function text(markdown: string) {
  return { content: [{ type: "text" as const, text: markdown }] };
}

export function users(view: SessionView): readonly string[] {
  return view.messages.flatMap((message) =>
    message.kind === "user" && typeof message.content === "string" ? [message.content] : [],
  );
}

export function queued(view: SessionView): readonly string[] {
  return view.queue.flatMap((message) =>
    typeof message.content === "string" ? [message.content] : [],
  );
}

export function answer(view: SessionView): string | null {
  const found = view.messages.find((message) => isPart(message, textPart));

  return found !== undefined && isPart(found, textPart) ? found.state.markdown : null;
}

export function tapped(
  body: ReadableStream<Uint8Array>,
  seen: (chunk: string, stream: string) => void,
  cut?: {
    readonly after: number;
    readonly kind: "reset" | "end";
    readonly when: (stream: string) => boolean;
  },
): ReadableStream<Uint8Array> {
  let chunks = 0;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const frames = parseSse(body);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await frames.next();

      if (next.done) {
        controller.close();

        return;
      }

      const frame = readStreamFrame(next.value);
      const data = frame.kind === "chunk" || frame.kind === "deflated";
      const counted = data && (cut === undefined || cut.when(frame.stream));

      if (cut !== undefined && counted && chunks >= cut.after) {
        if (cut.kind === "reset") controller.error(new TypeError("terminated"));
        else controller.close();
        void frames.return(undefined);

        return;
      }

      if (counted) chunks += 1;

      if (frame.kind === "chunk")
        seen(decoder.decode(Uint8Array.fromBase64(frame.data)), frame.stream);

      if (frame.kind === "deflated")
        seen(decoder.decode(inflateRawSync(Uint8Array.fromBase64(frame.data))), frame.stream);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));
    },
    cancel: () => frames.return(undefined).then(() => undefined),
  });
}
