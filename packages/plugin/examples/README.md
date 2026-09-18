# Plugin examples

These plugins demonstrate Nyte's public `@nyte-ai/plugin` contract. Hosts preinstall rename, fast mode, and web search. The question tool is not preinstalled: it is the extensibility demo, and installing it from a discovered directory is the whole setup. Every client then renders it, because what it asks the user to pick travels with the waiting call rather than with the plugin:

```sh
mkdir -p ~/.nyte/plugins
ln -s "$PWD/packages/plugin/examples/question.ts" ~/.nyte/plugins/question.ts
```

A plugin with the same id in a discovered directory replaces a preinstalled copy.

| Plugin | What it demonstrates |
| --- | --- |
| `question.ts` | A model-visible tool that parks with a single or multiple `Selection`, accepts a separate custom response, and applies a host-independent deadline from its plugin setting. TUI, desktop, and remote clients render the same waiting data. |
| `rename.ts` | A manual `/rename <name>` command, model-generated `/rename`, and a `rename_chat` tool the model calls itself, over the session's `context()` and `rename()` primitives |
| `fast-mode.ts` | A host-configured plugin factory with a durable `/fast` command, a per-provider setting, and a `before_request` hook |
| `web-search/` | A plugin set: one tool plugin plus one plugin per search provider, each joining the tool through `tools.update`. Host-owned credentials, a routing setting that can withhold the tool, and stateless `tools/call` requests |
| `notifications.ts` | An observer: `api.events.subscribe` folds the same `SessionEvent` stream a client folds and asks for attention through `diagnostics.notify`. Nothing it returns reaches the run |
| `warming.ts` | A background setting-driven plugin that re-sends the chat's own context on a timer to keep the provider's cached prefix warm |
