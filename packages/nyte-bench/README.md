# Nyte Bench

Nyte Bench measures Nyte as a harness: given the same tools, does a model get its work done through Nyte in as few rounds as the instruction needs, with every call landing the first time? A harness can't make a model smarter, but its prompt, tool descriptions, schemas and errors decide whether the model finds the right tool, fills it in right and recovers quickly. Nyte Bench catches the places where Nyte makes that harder than it should be, across models.

Each sample opens a fresh host from this checkout with `simulate()` from `@nyte-ai/bench`, on a temp store, home and workspace, and sends one prompt to a new chat on a real model. The model sees what a Nyte chat sees, built from this checkout, so a copy change in a plugin shows up in the next run. Tools really run: files are read, subagents are real child sessions on real models, and MCP calls reach fixture servers that log every call they serve. Nothing touches your own sessions, workspaces or MCP servers.

## Suites

| Suite | Measures |
| --- | --- |
| [`tool-calls`](suites/tool-calls/README.md) | Subagents, background agents and MCP tools, called right in one round |
| [`subagent-models`](suites/subagent-models/README.md) | A subagent started on the model the user named loosely, in one round |
| [`canvas`](suites/canvas/README.md) | A canvas when data reads faster as one, unprompted, that runs without errors |

## Run

```sh
pnpm --dir packages/nyte-bench bench --out /tmp/nyte-bench
pnpm --dir packages/nyte-bench bench --suite tool-calls --case mcp-codemode --samples 1 --out /tmp/nyte-bench
pnpm --dir packages/nyte-bench bench --model gpt-6-astra --model anthropic/claude-haiku-5-5 --out /tmp/nyte-bench
pnpm --dir packages/nyte-bench bench --list
```

- Models default to the lineup in `src/models.ts`: Claude Haiku 5.5 and Sonnet 5.5, and GPT-5.6 Luna and Sol, GPT-6 Luna, GPT-6.1 Sol and GPT-6 Astra on the ChatGPT login. Pass `--model provider/id` once per model, or an id of the lineup alone.
- Credentials are your Nyte logins. The bench opens the host's store (`~/.nyte/nyte.db`, or `NYTE_DB`) read-only and decrypts the requested providers' logins in memory with `~/.nyte/secret.key`. It never refreshes, changes or writes them, because refreshing an OAuth token outside the host rotates it and can sign Nyte out. A login that expires within 15 minutes is refused: use that provider's model in Nyte once so the host refreshes it, then run again. A provider without a Nyte login falls back to its environment variable, such as `ANTHROPIC_API_KEY`.
- Flags: `--suite <id>` and `--case <id>` (repeatable), `--samples <n>` (default 3), `--concurrency <n>` (samples in flight, default 4), `--timeout <s>` per sample (default 240).
- A run writes `results.jsonl`, one row per sample with every call, its arguments and outcome, `summary.md`, which it prints, and `summary.json`, the pass counts per suite and model.
- It calls paid models, so CI doesn't run it. Each row records the token cost of the chat and its subagents; subscription logins report their list price.

## Harness overhead and prompt size

```sh
pnpm --dir packages/nyte-bench overhead --out /tmp/nyte-overhead
pnpm --dir packages/nyte-bench overhead --out /tmp/nyte-overhead --model anthropic/claude-sonnet-5-5
```

It runs turns on a scripted model that answers at once, so the time left is the harness's own: opening a host, the message to the first model request, a tool result to the next request and the last answer to settled, as medians and p90s. It also lists what a chat's first request carries, the system sections and each tool by size, largest first. With `--model`, it sends one real message per model and records the first request's input tokens. It writes `overhead.json`.

## DeepSWE

```sh
pnpm --dir packages/nyte-bench deepswe --dataset /tmp/deep-swe/tasks --out /tmp/nyte-deepswe
```

It runs Nyte on DeepSWE v1.1 tasks the way the benchmark grades them: the task's image runs with no network in Docker, every command the chat starts runs inside it, the task's collect command turns the commits into a patch, and the task's verifier grades it in a fresh container. It needs Docker and a clone of `datacurve-ai/deep-swe`. Without `--task`, it picks 12 tasks with a fixed seed, 3 attempts each, on Claude Sonnet 5.5 with high reasoning and a 20-minute limit. It writes `results.jsonl` and a `summary.json` in the shape eve publishes its harness results in.

## Compare against a baseline

Run the lineup on the text before a change and after it, then compare the two runs:

```sh
pnpm --dir packages/nyte-bench compare /tmp/nyte-bench-before/results.jsonl /tmp/nyte-bench-after/results.jsonl
```

It prints samples passed, calls ok and cost per model, and samples passed per case and model, as before → after. Two runs of the same text differ by up to 3 samples of 24 per model, so read a change against that.

## Scoring

A sample passes when every check of its case passes and it settled before the timeout. Every case also holds the chat to its rounds: a minimal instruction should need one round of tool calls and then the answer, so the chat's first turn may make 2 model requests, and none of its calls may fail. A retry, a lookup before the real call, or an extra `await` fails the sample, and the run stops the chat once it goes over. Requests are counted in the provider: those that offer `task`, which only a top-level chat has, with the prompt as their one user message, so subagents and a background agent's later report don't count.

The report has:

- **A leaderboard**: samples passed, calls that ended ok, and cost, per model.
- **Each suite's cases**: samples passed per case and model.
- **Tool-call success rate**: calls that ended ok over all calls, per tool and model, counting the chat's and its subagents' calls. A retry is a call of its own. A codemode script's calls are recorded next to the `codemode` call that made them, so a `mcp__…` row can come from a script.
- **Calls that did not end ok**, each with its error.

## Add a suite or a case

A suite is a list of cases in `suites/<id>/cases.ts`, registered in `src/suites.ts`, with a README that says what it measures. A case reproduces a real bad experience in Nyte or guards a good one: its `kind` is `bad`, `guard` or `control`, and its `experience` names what happened. Write it before the fix: it must fail on the text before and pass on the text after. Add a control next to a fix that could overcorrect. Model output varies, so compare runs on the same model with several samples, not one sample against a fixed score.

A case that measures only how the chat starts a subagent sets `subagentReply`: every subagent request gets that reply instead of reaching its model, and the bench still records which model each one was sent to, for `expect.subagentModel`.
