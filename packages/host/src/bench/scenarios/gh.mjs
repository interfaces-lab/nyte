#!/usr/bin/env node
/**
 * A stand-in for the `gh` CLI answering the two commands the CI scenario's
 * `gh` branch runs, from the same run the CI MCP fixture reports:
 *
 * - `gh pr checks`: one tab-separated line per check run.
 * - `gh run view <job> --log-failed`: the failing job's log (`CI_LOG_BYTES`, default 5 MiB).
 *
 * Anything else exits 1 with a message on stderr, as `gh` does for an unknown command.
 */
import process from "node:process";
import { CHECK_RUNS, ciLog } from "./ci-log.mjs";

const [command, subcommand, ...rest] = process.argv.slice(2);

/** What the command prints and its exit code; a pipe gets all of it, since the process exits only once stdout drains. */
const answer = () => {
  if (command === "pr" && subcommand === "checks")
    return {
      out: CHECK_RUNS.map(
        (run) =>
          `${run.name}\t${run.conclusion === "success" ? "pass" : "fail"}\t${run.html_url}\n`,
      ).join(""),
      code: CHECK_RUNS.some((run) => run.conclusion !== "success") ? 1 : 0,
    };

  if (command === "run" && subcommand === "view" && rest.includes("--log-failed"))
    return { out: ciLog(Number(process.env.CI_LOG_BYTES) || undefined), code: 0 };

  return { err: `unknown command: gh ${process.argv.slice(2).join(" ")}\n`, code: 1 };
};

const { out, err, code } = answer();

if (out !== undefined) process.stdout.write(out);

if (err !== undefined) process.stderr.write(err);

process.exitCode = code;
