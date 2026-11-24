# Architecture

The store keeps plain Markdown files alongside an index built from headings and links.

## Storage

Notes live as UTF-8 files under the workspace root. Each checkpoint records a [Snapshot](glossary.md#snapshot) so recovery stays deterministic.

See the [Operations Runbook](runbook.md#recovery-steps) for recovery steps.

## Sync Protocol

Peers exchange compact deltas described in the [Sync Guide](guides/sync.md). Conflicts follow the rules in [[sync#conflict-resolution]].
