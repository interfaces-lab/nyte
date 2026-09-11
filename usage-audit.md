# Usage accounting

Implementation notes following the audit against [t3code at 7ac93e3](https://github.com/pingdotgg/t3code/tree/7ac93e300ee17a4ee5e92192264fcfd438805b6f).

## Start here

Usage has separate meanings. Do not sum a context snapshot into historical consumption or derive account quota from local tokens.

```text
Provider response
  → AI adapter validates and normalizes tokens, calculates API cost estimate
  → core records usage on assistant, tool-result, or compaction commits
      → active branch → context estimate → desktop gauge / TUI status
      → storedCommits → commitUsage → desktop Settings / TUI /usage

Provider account endpoint → quota windows → TUI subscription headroom

Claude Code JSONL → shared host reader → separate all-time section in TUI / desktop
Codex CLI transcripts → not imported
```

| Measurement | Meaning | Not equivalent to |
| --- | --- | --- |
| Context estimate | Tokens in the representation the next request would receive | Tokens consumed across a session |
| Response usage | Usage reported for one provider response | A user turn, which can contain several model calls |
| Recorded totals | Sum of usage on retained commits | An immutable lifetime billing ledger |
| Recorded cost | API-equivalent cost calculated at execution | Subscription charges or an invoice |
| Account headroom | Provider-reported remaining quota and reset windows | A percentage calculated from local tokens |

Nyte's Anthropic and OpenAI Codex adapters are providers used by Nyte. Claude Code and Codex CLI are separate applications with separate histories. Selecting the same model does not import their usage.

## Arithmetic and ownership

```text
prompt tokens = input + cacheRead + cacheWrite
component total = prompt tokens + output
cache-hit fraction = cacheRead / prompt tokens
reasoning ⊆ output
cacheWrite1h ⊆ cacheWrite
```

Cache writes belong in the cache-hit denominator. With 100 uncached input, 300 cache-read, and 600 cache-write tokens, the rate is 30%, not 75%. Do not add reasoning or the one-hour cache subset again.

- [Claude normalization](packages/ai/src/api/anthropic-messages.ts) keeps its separately reported input and cache buckets.
- [Responses normalization](packages/ai/src/api/openai-responses-shared.ts) subtracts cache tokens from inclusive input. Terminal usage is validated once as finite non-negative integer counts. Failed responses retain supplied usage before the adapter reports failure.
- [Core usage](packages/core/src/kernel/views/usage.ts) owns `commitUsage`, the commit classification, and `usageTokens`, which prefers a nonzero reported total and otherwise sums disjoint components. Context, TUI totals, and desktop totals share that count rule.
- [AI cost calculation](packages/ai/src/models.ts) handles prompt-size tiers, cache pricing, Claude's one-hour cache-write subset, and applicable service/speed adjustments. Historical costs are not repriced when the catalog changes. Zero recorded cost does not prove a request was free.

`commitUsage` preserves explicitly reported zero usage. Desktop omits zero-token, zero-cost chart rows; it does not discard tokens just because their recorded price is zero. Core groups models by provider/model tuples, not bare model IDs. Desktop adds local-day and folder grouping without redefining which commit kinds count.

## Which history counts

[Core `storedCommits`](packages/core/src/kernel/graph.ts) reads every retained commit once, including abandoned branches and loose commits from failed publication. TUI and desktop use this same selection rule. Moving a head does not erase consumption. Session deletion and garbage collection still can.

| | TUI | Desktop |
| --- | --- | --- |
| Store scope | Current workspace's `.nyte/sessions.db` | Home and registered desktop workspace stores |
| Commit selection | Every retained commit object | Every retained commit object |
| Model grouping | Provider and model | Provider and model |
| Account quota | Active Claude OAuth or Codex account windows | Not implemented in the usage path |
| Other applications' transcripts | Claude Code, all local projects | Claude Code, all local projects |

Desktop can initially copy a project-local database into its user-scoped store. This is a one-time seed, not synchronization. Later TUI activity need not appear in desktop. Shared accounting rules do not mean shared storage. See [desktop workspaces](packages/desktop/src/main/workspaces.ts) and [TUI setup](packages/tui/src/run.ts).

Subagents are separate sessions. Workspace totals include their own commits once. Parent-chat totals exclude child-session spending. Checkpoint backup messages are not recursively counted as new consumption.

## Compaction is consumption, not just a context change

[Compaction](packages/core/src/kernel/compaction.ts) accumulates every provider-reported summarization attempt, including retries and rejected chunks. Successful operations carry usage on their checkpoint or summary. Failed or cancelled operations preserve it in a loose summary commit without moving the head. These records follow normal garbage collection; there is no separate ledger.

Overflow recovery also preserves the failed assistant response that triggered compaction, under its original provider/model. For example, a 100-token overflow response, 200-token summary, and 300-token answer record 600 tokens. Cancelling native compaction after a response arrives preserves its supplied usage without installing its context. Missing provider usage cannot be reconstructed.

[Context projection](packages/core/src/kernel/views/context.ts) only uses an assistant usage baseline when it applies to the current prefix. A newer portable compaction summary invalidates older retained assistants' baselines. Native checkpoint output provides a baseline until a later assistant reports actual usage. Historical consumption never becomes the new context size.

[TUI session following](packages/tui/src/session-follow.ts) retains the snapshot's context, and context-changing commits refresh it. Redrawing after compaction must not restore a stale pre-compaction gauge.

## Client presentation

Desktop Usage is an explicit snapshot, not a live meter. [Queries](packages/desktop/src/renderer/src/queries.ts) reload on each visit. Refresh is available for populated, empty, and failed reports, joins an existing request, and does not poll entire histories. The page shows the snapshot time. Refresh failures are visible instead of presenting cached data as current.

Nyte cards and chat rows use the selected date window. A usage record is a commit with consumption, including tools and compaction, not necessarily a reply or user turn. Costs are labeled API estimates. Claude Code totals are all-time and displayed separately from the date-filtered Nyte report.

TUI `/usage` opens a dedicated read-only report with a fixed title and controls. Wheel, arrow, and page keys scroll its content without a filter field or selected row. Escape restores the composer draft and chat scroll position. Long model names and amounts wrap on narrow terminals. Report text uses the same foreground color as chat in both themes; bars carry color, and keyboard hints remain secondary. The report shows workspace totals, Claude Code history, then available account limits. Ongoing-thread statuses are no longer gathered or displayed here.

## Claude Code local history

[`@nyte-ai/host/usage`](packages/host/src/usage.ts) scans `CLAUDE_CONFIG_DIR/projects`, or `~/.claude/projects` when unset, including nested subagents. TUI scans when `/usage` opens; desktop scans with its existing visit and refresh snapshot. No sign-in, transcript upload, imported Nyte sessions, or persistent ledger is involved.

The reader validates assistant token counts and deduplicates repeated blocks and copied history by message/request identity across all projects. Either ID can stand alone; records lacking both remain independent. Repeated snapshots retain the whole largest token total, with output count and reported-cost availability breaking ties. Equal quantities on distinct requests still count separately.

Recorded `costUSD` takes precedence. Otherwise an exact Anthropic catalog match supplies a current API estimate, including cache-write TTL pricing. Unknown prices retain tokens and are labeled as missing, not free. Read failures and malformed records produce visible coverage warnings. Configured symlink roots work; child links are skipped. Deleted transcripts cease to contribute on the next read. These all-time local totals remain separate from Nyte workspace consumption, account quota, and subscription charges.

## What remains separate work

- Storage synchronization between TUI and desktop is unchanged.
- Desktop account-quota display and Codex CLI transcript imports are not implemented.
- Desktop reports failed Nyte stores separately and still displays readable Claude Code history. SDK session listing can resolve trusted workspace plugins; the read is not an activation-free store scan.
- Lifetime totals that survive deletion require an accounting record independent of conversation retention. The current reports intentionally do not promise that.

## What to borrow from t3code

T3code's cumulative dashboard reads CLI transcripts independently of its live context meter and turn telemetry:

```text
Claude / Codex / Grok transcript files
  → parse and deduplicate → price quantities → time/model buckets
  → merge environments
```

Sources pinned to the audited commit:

- [Transcript normalization and deduplication](https://github.com/pingdotgg/t3code/blob/7ac93e300ee17a4ee5e92192264fcfd438805b6f/apps/server/src/usage/usageTranscripts.ts)
- [Scan roots and rebuildable cache](https://github.com/pingdotgg/t3code/blob/7ac93e300ee17a4ee5e92192264fcfd438805b6f/apps/server/src/usage/UsageService.ts)
- [Pricing](https://github.com/pingdotgg/t3code/blob/7ac93e300ee17a4ee5e92192264fcfd438805b6f/apps/server/src/usage/usagePricing.ts)
- [Usage contract](https://github.com/pingdotgg/t3code/blob/7ac93e300ee17a4ee5e92192264fcfd438805b6f/packages/contracts/src/usage.ts)

Borrow the separation and the API-estimate label, not every accounting detail. Claude imports use message/request identity. Codex imports drop consecutive equal usage payloads and use a one-second gap heuristic for copied history. A fixture with advancing cumulative totals and equal per-call counts loses the second call. Equal quantities are not event identity.

Its historical pricing uses current rates or overrides, unlike Nyte's stored execution-time estimates. Its scanner does not cover every configured instance or Codex archived-session directory, and deleted transcripts still mean lost coverage. Nyte's Claude Code reader preserves source separation and deduplicates by identity, not token-count equality.
