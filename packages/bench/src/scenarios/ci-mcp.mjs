#!/usr/bin/env node
import process from "node:process";
import { CHECK_RUNS, ciLog } from "./ci-log.mjs";
import { serve, sleep } from "./mcp-server.mjs";

const env = process.env;

const TOOLS = [
  {
    name: "list_check_runs",
    title: "List check runs",
    description: "List the check runs of a commit or branch of the current pull request.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string", description: "A commit sha, branch or HEAD." } },
      required: ["ref"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_job_logs",
    title: "Get job logs",
    description:
      "Download the log of one CI job. Logs can be large; the failure is usually at the end.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "integer" },
        tail_lines: { type: "integer", minimum: 1, description: "Return only the last lines." },
      },
      required: ["job_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];

const text = (value) => ({ content: [{ type: "text", text: value }] });

serve("ci", {
  async initialize() {
    await sleep(env.CI_COLD_MS);

    return {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "ci-fixture", version: "1.0.0" },
    };
  },
  async "tools/list"() {
    if (env.CI_CRASH === "list") process.exit(1);

    return { tools: TOOLS };
  },
  async "tools/call"(params) {
    if (env.CI_CRASH === "call") process.exit(1);
    await sleep(env.CI_DELAY_MS);
    const args = params?.arguments ?? {};

    if (params?.name === "list_check_runs") return text(JSON.stringify(CHECK_RUNS));

    if (params?.name !== "get_job_logs")
      return { isError: true, ...text(`No tool ${params?.name}.`) };

    if (!CHECK_RUNS.some((run) => run.id === args.job_id))
      return { isError: true, ...text(`No job ${args.job_id}.`) };
    const log = args.job_id === 2 ? ciLog(Number(env.CI_LOG_BYTES) || undefined) : "lint ok\n";

    return text(
      args.tail_lines === undefined
        ? log
        : log
            .split("\n")
            .slice(-args.tail_lines - 1)
            .join("\n"),
    );
  },
});
