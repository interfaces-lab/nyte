# Plugin examples

These plugins demonstrate Nyte's public `@nyte-ai/plugin` contract. The TUI preinstalls rename, fast mode, and the question tool. A plugin with the same id in a discovered directory replaces the preinstalled copy, which also demonstrates discovery:

```sh
mkdir -p ~/.nyte/plugins
ln -s "$PWD/packages/plugin/examples/question.ts" ~/.nyte/plugins/question.ts
```

| Plugin | What it demonstrates |
| --- | --- |
| `question.ts` | A model-visible tool that parks the run with `ToolWait` and settles on `runs.reply({ callId })`; the waiting `effect` event is what a client renders |
| `rename.ts` | A manual `/rename <name>` command and model-generated `/rename` using only the session's `messages()` and `rename()` primitives |
| `fast-mode.ts` | A host-configured plugin factory with a durable `/fast` command, a per-provider setting, and a `before_request` hook |
| `web-search/` | A plugin set: one tool plugin plus one plugin per search provider, each joining the tool through `tools.update`. Host-owned credentials, a routing setting that can withhold the tool, and stateless `tools/call` requests |
