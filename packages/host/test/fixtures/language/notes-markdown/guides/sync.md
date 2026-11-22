# Sync Guide

Synchronization keeps two workspaces aligned without rewriting unrelated notes.

## Conflict Resolution

When two edits diverge, the host compares the latest [[glossary#snapshot]] before merging changes from [Storage](../architecture.md#storage).

## Retry Policy

Transient transport errors back off exponentially until the peer reconnects. Return to the [Knowledge Base](../index.md) for other topics.
