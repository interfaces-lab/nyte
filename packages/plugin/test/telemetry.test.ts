import { createServer } from "node:http";
import { expect, it } from "vitest";
import telemetry from "../src/telemetry.ts";
import { fakeModels, open, until } from "./fake-models.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

it("exports nothing while the endpoint is empty, then one span per request to the endpoint as it changes", async () => {
  const received: string[] = [];

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push(`${request.url} ${Buffer.concat(chunks).toString("utf8")}`);
      response.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;

  try {
    const fake = fakeModels();
    await using host = await open(fake, [telemetry]);
    const { session } = await host.sessions.start({ content: "Hi." });

    fake.reply({ content: [{ type: "text", text: "One." }] });
    await (await session.send("Hi.")).settled();
    await settle();

    expect(received).toEqual([]);

    await host.settings.apply("telemetry.endpoint", `${base}/a/v1/traces`);
    await settle();
    fake.reply({ content: [{ type: "text", text: "Two." }] });
    await (await session.send("Again.")).settled();
    const [first] = await until(() => (received.length > 0 ? received : undefined));

    expect(first).toContain("/a/v1/traces ");
    expect(first).toContain("assistant test/model");
    expect(first).toContain("gen_ai.usage.input_tokens");

    await host.settings.apply("telemetry.endpoint", `${base}/b/v1/traces`);
    await settle();
    fake.reply({ content: [{ type: "text", text: "Three." }] });
    await (await session.send("Once more.")).settled();
    await until(() => (received.length > 1 ? received : undefined));
    await settle();

    expect(received.map((body) => body.split(" ")[0])).toEqual(["/a/v1/traces", "/b/v1/traces"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
