# Shared usage

Usage includes two separate measurements: recorded tokens with estimated API cost,
and live account subscription windows. Neither is calculated from the other.

- Both clients share `readLocalUsage` for Claude Code and Codex token history.
- TUI uses `readAccountUsage` for the accounts signed into Nyte, including Claude's
  5-hour, weekly, and model-scoped Fable windows when the provider reports them.
- TUI displays one completed report in a compact scrollable composer panel.
  A single loading line precedes the report; sections do not load progressively.
- Desktop retains its existing local usage page and background history worker.
- Local file caches are reused. No new plugin framework or tests are added.

External CLI credential discovery and token rotation remain outside the implementation.
Verification uses existing tests, typechecks, lint, formatting, and the TUI build.
