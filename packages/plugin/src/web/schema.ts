import { standard } from "@nyte-ai/schema";
import type { Infer } from "@nyte-ai/schema";
import { Type } from "typebox";

export const WEB_SEARCH_TOOL = "web_search";

export const WEB_FETCH_TOOL = "web_fetch";

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
