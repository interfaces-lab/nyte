import { chmod, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import process from "node:process";
import {
  PLACES_SERVER,
  PLACES_TOOL,
  RESTAURANT_ANSWER,
  RESTAURANT_CANVAS,
  RESTAURANT_PROMPT,
  RESTAURANT_SKILL,
  titleReply,
} from "@nyte-ai/bench";
import type { Reply, Request } from "@nyte-ai/bench";
import { contentText } from "@nyte-ai/schema/model";

export const HOURS_COMMAND = "./places-hours luigi";

export const HOURS_DONE = "places-hours: luigi is open until 22:30";

export const RUN_HOURS = "Run it";

export const HOURS_QUESTION = "Check whether Luigi's Trattoria is open now?";

export const HOURS_ANSWER = `${RESTAURANT_ANSWER} It is open until 22:30 tonight.`;

export function restaurantSkill(home: string): string {
  return join(home, ".agents", "skills", "restaurant-picker", "SKILL.md");
}

const PACE: Reply["timing"] = { firstMs: 30, deltaMs: 2 };

export function restaurantReplies(input: {
  readonly skill: string;
  readonly origin?: string;
  readonly log?: boolean;
}): (request: Request) => Reply | null {
  const canvas =
    input.origin === undefined
      ? RESTAURANT_CANVAS
      : RESTAURANT_CANVAS.replaceAll("https://fixture.test", input.origin);

  return (request) => {
    const first = request.context.messages.find((message) => message.role === "user");

    if (
      first?.role !== "user" ||
      contentText(first.content, "") !== RESTAURANT_PROMPT ||
      titleReply(request) !== null
    )
      return null;
    const last = request.context.messages.at(-1);

    if (input.log === true && last?.role === "toolResult")
      console.log(
        `NYTE_E2E_U ${JSON.stringify({ tool: last.toolName, text: contentText(last.content).slice(0, 600) })}`,
      );

    if (last?.role === "user")
      return {
        timing: PACE,
        content: [
          { type: "text", text: "Let me look nearby." },
          { type: "toolCall", id: "skill", name: "read", arguments: { path: input.skill } },
        ],
      };

    if (last?.role !== "toolResult") return null;

    switch (last.toolName) {
      case "read":
        return {
          timing: PACE,
          content: [
            {
              type: "toolCall",
              id: "search",
              name: PLACES_TOOL,
              arguments: { near: "here", limit: 5 },
            },
          ],
        };
      case PLACES_TOOL:
        return {
          timing: PACE,
          content: [
            {
              type: "toolCall",
              id: "canvas",
              name: "canvas_render",
              arguments: { title: "Random pick nearby", source: canvas },
              deltas: 40,
            },
          ],
        };
      case "canvas_render":
        return {
          timing: PACE,
          content: [
            {
              type: "toolCall",
              id: "approve",
              name: "question",
              arguments: {
                questions: [
                  {
                    question: HOURS_QUESTION,
                    header: "Run places-hours",
                    options: [
                      {
                        label: RUN_HOURS,
                        description: `Runs ${HOURS_COMMAND} in your home folder.`,
                      },
                      { label: "Skip", description: "Answer without checking the hours." },
                    ],
                  },
                ],
              },
            },
          ],
        };
      case "question":
        return contentText(last.content).includes(RUN_HOURS)
          ? {
              timing: PACE,
              content: [
                {
                  type: "toolCall",
                  id: "hours",
                  name: "bash",
                  arguments: { command: HOURS_COMMAND, description: "Check the opening hours" },
                },
              ],
            }
          : { timing: PACE, content: [{ type: "text", text: RESTAURANT_ANSWER }] };
      case "bash":
        return {
          timing: { firstMs: 30, deltaMs: 250 },
          tokens: 40,
          content: [{ type: "text", text: HOURS_ANSWER }],
        };
      default:
        return null;
    }
  };
}

const HOURS_CLI = `#!/bin/sh
echo "places-hours: looking up $1"
for hour in 12:00 13:00 15:00 18:00 20:00 22:30; do
  sleep 0.5
  echo "  $1 open at $hour"
done
echo "places-hours: $1 is open until 22:30"
`;

export interface ScenarioU {
  readonly origin: string;
  readonly traceFile: string;
  readonly visits: readonly string[];
  close(): Promise<void>;
}

export async function prepareScenarioU(home: string): Promise<ScenarioU> {
  const traceFile = join(home, "mcp-spans.jsonl");
  await writeFile(traceFile, "");
  await mkdir(join(home, ".nyte"), { recursive: true });
  await writeFile(
    join(home, ".nyte", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        places: {
          command: process.execPath,
          args: [PLACES_SERVER],
          env: { PLACES_COLD_MS: "400", PLACES_DELAY_MS: "50", NYTE_TRACE_FILE: traceFile },
          exposure: "direct",
        },
      },
    }),
  );
  await mkdir(join(restaurantSkill(home), ".."), { recursive: true });
  await writeFile(restaurantSkill(home), RESTAURANT_SKILL);
  await writeFile(join(home, "places-hours"), HOURS_CLI);
  await chmod(join(home, "places-hours"), 0o755);

  const visits: string[] = [];

  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    visits.push(path);
    const name = path.split("/").at(-1) ?? "";
    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    response.end(
      `<!doctype html><html><head><title>Menu: ${name}</title></head><body><h1>Menu: ${name}</h1></body></html>`,
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();

  if (address === null || typeof address === "string")
    throw new Error("The places site has no port.");

  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    traceFile,
    visits,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
