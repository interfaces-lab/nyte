import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createNyteClient } from "@nyte-ai/client";

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      "token-file": { type: "string" },
      "check-only": { type: "boolean" },
      "require-durable": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`Usage: pnpm test:provider --url <server-url> [--token-file <path>]

Creates a Cloud chat, checks provider access, streamed completion, and
the saved reply. The test chat remains on the server for inspection.
Uses NYTE_TOKEN unless --token-file is supplied. Never prints the token.
The deployment needs credentials for its default model. Times out after 90 seconds.

--check-only       Check authentication, server metadata, and the SDK model catalog
                   without sending a prompt or changing a session.
--require-durable  Fail unless the host advertises durable session storage.`);
    return;
  }

  const baseUrl = values.url ?? process.env.NYTE_SERVER_URL;
  if (!baseUrl) throw new Error("Pass --url or set NYTE_SERVER_URL.");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("The server URL must use HTTP or HTTPS.");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("The server URL must not contain credentials, a query, or a fragment.");
  const token =
    values["token-file"] === undefined
      ? process.env.NYTE_TOKEN
      : (await readFile(values["token-file"], "utf8")).trim();
  if (!token)
    throw new Error("Set NYTE_TOKEN or pass --token-file. Keep the token out of arguments.");

  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]);
  const client = createNyteClient({
    baseUrl,
    token,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
      }),
  });
  try {
    const info = await client.info();
    console.log(`Authenticated at ${url.origin}${url.pathname}: ${info.version}`);
    const persistence = info.host.kind === "described" ? info.host.persistence : "unknown";
    console.log(`Session storage: ${persistence}`);
    if (values["require-durable"] && persistence !== "durable")
      throw new Error("The host does not advertise durable session storage.");
    const [available, selected] = await Promise.all([
      client.provider.models.list(),
      client.provider.models.default(),
    ]);
    if (
      !selected ||
      !available.some((model) => model.id === selected.id && model.provider === selected.provider)
    )
      throw new Error(
        "The server's default model has no configured credentials or is unavailable.",
      );
    console.log(`Server model: ${selected.provider}/${selected.id}`);
    if (values["check-only"]) {
      console.log(
        "Configuration checks passed. Run test:provider to verify a real provider reply.",
      );
      return;
    }

    const { sessionId } = await client.sessions.create({ name: "Cloud desktop smoke test" });
    console.log(`Created test chat ${sessionId}`);
    const before = await client.sessions.snapshot({ sessionId });
    if (!before) throw new Error("The newly created chat could not be read.");
    // Replay from the snapshot so a fast reply cannot finish before the watch connects.
    const completion = (async () => {
      for await (const event of client.watch({ sessionId, afterSeq: before.seq, signal })) {
        if (event.kind !== "run") continue;
        if (event.run.phase.kind === "failed") throw new Error(event.run.phase.failure.message);
        if (event.run.phase.kind === "aborted") throw new Error("The test run was aborted.");
        if (event.run.phase.kind === "done") return;
      }
      throw new Error("The watch ended before the test run completed.");
    })();
    await Promise.all([
      completion,
      client.messages.send({
        sessionId,
        content: "Reply with exactly: Nyte cloud connection works.",
      }),
    ]);
    const after = await client.sessions.snapshot({ sessionId });
    const parts = after?.transcript.flatMap((turn) => (turn.kind === "turn" ? turn.parts : []));
    const reply = parts
      ?.flatMap((part) => (part.kind === "assistant" ? [part.text] : []))
      .join("\n")
      .trim();
    if (!reply) throw new Error("The run completed without a saved assistant reply.");
    console.log(`Reply: ${reply}`);
    console.log("Passed: authentication, server models, provider completion, and saved reply.");
  } finally {
    controller.abort();
  }
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(
    `Server check failed: ${
      /<(?:!doctype|html)\b/i.test(message)
        ? "The provider returned an HTML error page. Check provider access from this host."
        : message
    }`,
  );
  process.exitCode = 1;
});
