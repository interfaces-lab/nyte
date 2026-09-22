# Plugin examples

These plugins demonstrate Nyte's public `@nyte-ai/plugin` contract. Hosts preinstall rename, fast mode, warming, and web search. The question tool is not preinstalled: it is the extensibility demo, and installing it from a discovered directory is the whole setup. Every client then renders it, because what it asks the user to pick travels with the waiting call rather than with the plugin:

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
| `anthropic-proxy.ts` | A toggleable replacement for the default Anthropic provider's session requests, using the existing credentials and model IDs |

## Provider overrides

A provider plugin uses the existing `Provider` contract. The shared host applies it to the current chat's model requests, so desktop and TUI use the same override without renderer changes. The default provider remains registered; no provider is deleted.

```ts
import { providerPlugin } from "@nyte-ai/plugin";
import { customAnthropicProvider } from "./provider.ts";

export default providerPlugin({
  id: "anthropic-override",
  provider: customAnthropicProvider(),
  enabled: false,
});
```

The provider must keep the default provider ID, `anthropic` in this example. Save the entry as `anthropic-override.ts` in a discovered plugin directory. Its toggle appears in the existing plugin settings. `/anthropic-override on` and `/anthropic-override off` change the same setting; calling it without an argument toggles it.

- Settings belong to the chat and survive restart. Other chats keep their own settings.
- The last enabled matching provider plugin in load order handles the next model request. Disabling it reveals an earlier override, or the default provider.
- Removing or disabling the plugin through the manifest restores the default when no other override applies.
- An enabled override's failure is a run error, not a silent retry against the default provider.
- The override shares the host's credential store and auth context. Anthropic OAuth remains unchanged.
- This replaces requests for existing model IDs. It does not add model-picker entries or change the default catalog's login UI. Independent requests made directly through a host's `Models` instance, such as title generation, do not use a chat override.

### Anthropic proxy example

Set `ANTHROPIC_BASE_URL` to a proxy you trust before starting Nyte, then install the example:

```sh
mkdir -p ~/.nyte/plugins
ln -s "$PWD/packages/plugin/examples/anthropic-proxy.ts" ~/.nyte/plugins/anthropic-proxy.ts
```

It starts off. Use `/anthropic-proxy on` or the existing plugin setting to enable it for a chat. The proxy receives that chat's model requests and Anthropic credentials. `/anthropic-proxy off` returns subsequent requests to the default endpoint.

Provider overrides replace model request implementations. They do not replace Nyte's tool-execution loop with an external agent runtime.
