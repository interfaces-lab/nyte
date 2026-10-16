# CLI verification

Choose checks from the behavior that changed. A wording fix does not require an auth audit; a shared output helper may need coverage from several consumers.

| Change | Useful proof |
| --- | --- |
| Help or copy | The actual command output communicates the intended meaning and next action. Assert exact wording only when it is the contract. |
| Prompts | Interactive input reaches the intended result; flags or non-interactive mode reach it without waiting for a terminal. |
| JSON or other machine output | Stdout parses to the expected value, diagnostics use stderr, and exit codes match success or failure. |
| Resource resolution or confirmation | The user sees the actual target before approving risky work; cancellation leaves state unchanged. |
| Mutation or retry | The intended effect happens, failure is observable, and retries do not duplicate non-idempotent work. |
| Streaming or progress | Output stays usable in the affected terminal/pipe modes; interruption releases resources and machine streams remain valid. |
| Layout or styling | Representative narrow widths, long names, Unicode, and color-disabled output remain readable where relevant. |
| Auth or external input | Secrets remain private, invalid input is rejected at its boundary, and unattended execution does not launch interactive auth. |

## Test the result

```text
result = run_cli("list --json", fixture_with_two_items)
assert result.exit_code == 0
assert parse_json(result.stdout) == expected_items

result = run_cli("delete item-1", confirmation="no")
assert read_item("item-1") == original_item
```

Prefer real local fixtures. Fake unavailable external services at their documented boundary, then assert both the request contract and the command's result.

A mock proving that a print helper ran does not prove stdout is valid JSON. A test banning an old phrase adds value only if that phrase represents behavior or copy the contract actually forbids. Use the change-detector skill when an assertion merely repeats implementation choices.

For a shared helper, inspect its consumers and select cases with different relevant behavior. No fixed number of command families is required. Search for stale wording or references when a rename or removal can leave contradictions, not as a mandatory banned-word sweep.

Report what ran and what it showed. Distinguish failures, skipped checks, and assumptions. Do not claim an untested path passed because a nearby one did.
