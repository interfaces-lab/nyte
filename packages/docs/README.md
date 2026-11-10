# @nyte-ai/web

One TanStack Start app serves Nyte's documentation at nyte.sh and its design-system reference at design.nyte.sh. The guides describe what ships. Experiments belong in `packages/lab`.

## Run it

```sh
pnpm --dir packages/docs dev
```

`src/lib/hosts.ts` maps the design host onto the `/design` routes. Locally, `design.localhost` on the dev server's port plays design.nyte.sh. Hosts without a design subdomain, such as Vercel previews, serve the design site at `/design`.

## Page order

Each content folder's `meta.json` sets its page order:

- The root `meta.json` lists the pages and folders.
- `---Label---` starts a sidebar section.
- `...folder` inlines a folder in the order of its own `meta.json`.

The server fails at startup when a page appears in no `meta.json`.

## Search

When `VITE_ALGOLIA_APP_ID` and `VITE_ALGOLIA_SEARCH_KEY` are set at build time, search uses Algolia. Otherwise it uses the local `/api/search` index.

| Variable | Default | What it does |
| --- | --- | --- |
| `VITE_ALGOLIA_APP_ID` | unset | Algolia application ID for site search |
| `VITE_ALGOLIA_SEARCH_KEY` | unset | Algolia search key |
| `VITE_ALGOLIA_INDEX` | `docs` | Algolia index the site searches |

After each deploy, replace the Algolia index with the deployed pages. The script reads them from the site's `/api/search-records` and writes to the index that `ALGOLIA_INDEX` names, `docs` by default:

```sh
ALGOLIA_APP_ID=… ALGOLIA_WRITE_KEY=… pnpm --dir packages/docs sync:algolia https://nyte.sh
```

## MCP server

The site serves its docs as an MCP server at `/mcp`, built on the official MCP SDK in `src/lib/docs-mcp.ts`. It has three read-only tools: `list_docs`, `search_docs` and `read_doc`. It deploys with the site, needs no environment variables, and also runs under `pnpm --dir packages/docs dev`. It answers clients on MCP protocol 2026-07-28 and on the 2025 versions.

The examples below use `$DOCS`. Set it to the address the dev server prints:

```sh
DOCS=http://localhost:<port>
```

To try the server, run the MCP inspector, choose Streamable HTTP and enter `$DOCS/mcp`:

```sh
npx @modelcontextprotocol/inspector@latest
```

Or add it to Nyte:

```sh
nyte mcp add nyte-docs-local --url "$DOCS/mcp"
```

A raw request needs both content types in `Accept`, and the answer arrives as a server-sent event:

```sh
curl -s "$DOCS/mcp" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_docs","arguments":{"query":"part views"}}}'
```

Links in its answers use the address the request came in on, so a local or preview server links to its own pages. A request to design.nyte.sh gets nyte.sh links.

## Development

```sh
pnpm exec turbo typecheck --filter=@nyte-ai/web
pnpm --dir packages/docs check:base-ui
```

`check:base-ui` fails when the vendored Base UI reference pages are stale. Run `pnpm --dir packages/docs sync:base-ui` to update them. The generator's `BASE_UI_REF` must match the installed `@base-ui/react` release. Keep wording corrections in the generator so a sync preserves them.

Read [AGENTS.md](AGENTS.md) before changing the site.
