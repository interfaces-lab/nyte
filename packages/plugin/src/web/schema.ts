import { standard } from "@nyte-ai/schema";
import type { Infer } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";

export const WEB_SEARCH_TOOL = "web_search";

export const WEB_FETCH_TOOL = "web_fetch";

export const SEARCH_PROVIDER_SETTING = "web_search.provider";

export const SEARCH_KEYS_SETTING = "web_search.keys";

export const PROVIDERS = [
  { id: "exa", name: "Exa" },
  { id: "tavily", name: "Tavily" },
  { id: "firecrawl", name: "Firecrawl" },
  { id: "parallel", name: "Parallel" },
] as const;

export type ShippedProvider = (typeof PROVIDERS)[number]["id"];

export const SEARCH_OFF = { value: "off", label: "Off" } as const;

/**
 * `web_search.keys` by provider id. The host seals each value. Clients read `{ secret: true }`
 * back, and writing that keeps the stored key.
 */
export const SearchKeysType = Type.Record(
  Type.String(),
  Type.Object({ secret: Type.Literal(true), value: Type.Optional(Type.String()) }),
);

export type SearchKeys = Static<typeof SearchKeysType>;

export const DEFAULT_FETCH_SECONDS = 30;

const MAX_FETCH_SECONDS = 120;

export const searchParameters = standard(
  Type.Object({ query: Type.String({ minLength: 1, description: "What to search the web for." }) }),
);

export const searchOutput = standard(
  Type.Object({
    provider: Type.String(),
    results: Type.Array(
      Type.Object({
        url: Type.String(),
        title: Type.Optional(Type.String()),
        content: Type.Optional(Type.String()),
        published: Type.Optional(
          Type.Number({ description: "Milliseconds since the Unix epoch." }),
        ),
      }),
    ),
  }),
);

export type SearchOutput = Infer<typeof searchOutput>;

export const fetchParameters = standard(
  Type.Object({
    url: Type.String({ minLength: 1, description: "The URL." }),
    format: Type.Optional(
      Type.Enum(["markdown", "text", "html"], {
        description: "Default markdown.",
      }),
    ),
    timeout: Type.Optional(
      Type.Number({
        exclusiveMinimum: 0,
        maximum: MAX_FETCH_SECONDS,
        description: `Seconds to wait; default ${DEFAULT_FETCH_SECONDS}.`,
      }),
    ),
  }),
);
