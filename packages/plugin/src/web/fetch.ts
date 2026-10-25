import { standard } from "@nyte-ai/schema";
import type { BlobId } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition } from "@nyte-ai/plugin/core";
import { readCapped } from "./body.ts";
import type { Fetch } from "./body.ts";
import { htmlToMarkdown, htmlToText } from "./html-markdown.ts";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

const INLINE_CHARS = 50 * 1024;

const MAX_REDIRECTS = 10;

const DEFAULT_TIMEOUT_SECONDS = 30;

const MAX_TIMEOUT_SECONDS = 120;

const USER_AGENT =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Nyte/1.0; +https://nyte.sh";

const fetchParameters = Type.Object({
  url: Type.String({ minLength: 1, description: "The http:// or https:// URL to fetch." }),
  format: Type.Optional(
    Type.Union([Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")], {
      description: "What to return the page as. Defaults to markdown.",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({
      exclusiveMinimum: 0,
      maximum: MAX_TIMEOUT_SECONDS,
      description: `Seconds to wait, at most ${MAX_TIMEOUT_SECONDS}. Defaults to ${DEFAULT_TIMEOUT_SECONDS}.`,
    }),
  ),
});

type Format = NonNullable<Static<typeof fetchParameters>["format"]>;

type Page =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly blob: BlobId; readonly mime: string };

const ACCEPT = {
  markdown:
    "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1",
  text: "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1",
  html: "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1",
} satisfies { readonly [F in Format]: string };

/**
 * The `web_fetch` tool: GETs an http(s) URL through `fetch`, following at most ten
 * redirects that stay on http(s), and returns HTML as markdown, text or itself, other
 * text as is, and an image as a file. Bodies stop at 5 MiB; text shown inline at 50 KiB.
 */
export function webFetch(fetch: Fetch): ToolDefinition<Static<typeof fetchParameters>> {
  return {
    name: "web_fetch",
    description:
      "Fetch an http(s) URL and return it as markdown (the default), text or HTML; an image comes back as a file. Read-only. Prefer a more specific tool when one fits.",
    parameters: standard(fetchParameters),
    class: (args) => ({ kind: "custom", label: `Fetching ${args.url}` }),
    effects: "none",
    approval: "never",
    replay: "safe",
    async execute(args, invocation) {
      const url = URL.parse(args.url);

      if (url === null || (url.protocol !== "http:" && url.protocol !== "https:"))
        throw new Error(`Fetch an http:// or https:// URL; ${args.url} isn't one.`);
      const format = args.format ?? "markdown";
      const seconds = args.timeout ?? DEFAULT_TIMEOUT_SECONDS;

      const page = await invocation.memo("page", async (): Promise<Page> => {
        const deadline = AbortSignal.timeout(seconds * 1000);
        const signal = AbortSignal.any([invocation.signal, deadline]);

        try {
          const response = await follow(fetch, url, format, signal);

          const mime =
            (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ??
            "";

          if (
            mime.startsWith("image/") &&
            mime !== "image/svg+xml" &&
            mime !== "image/vnd.fastbidsheet"
          ) {
            const bytes = await readCapped(response, MAX_RESPONSE_BYTES);

            const blob = await invocation.env.files.upload(
              (async function* () {
                yield bytes;
              })(),
            );

            return { kind: "image", blob, mime };
          }

          if (
            mime !== "" &&
            !mime.startsWith("text/") &&
            mime !== "application/json" &&
            !mime.endsWith("+json") &&
            mime !== "application/xml" &&
            !mime.endsWith("+xml") &&
            mime !== "application/javascript" &&
            mime !== "application/x-javascript"
          ) {
            await response.body?.cancel();
            throw new Error(`${url.href} is ${mime}; web_fetch reads text, HTML and images.`);
          }

          const body = new TextDecoder().decode(await readCapped(response, MAX_RESPONSE_BYTES));

          const text =
            mime !== "text/html" || format === "html"
              ? body
              : format === "markdown"
                ? htmlToMarkdown(body)
                : htmlToText(body);

          return {
            kind: "text",
            text:
              text.length > INLINE_CHARS
                ? `${text.slice(0, INLINE_CHARS)}\n\n… Cut at ${INLINE_CHARS} of ${text.length} characters.`
                : text,
          };
        } catch (error) {
          if (deadline.aborted && !invocation.signal.aborted)
            throw new Error(`${url.href} didn't answer within ${seconds} s.`, { cause: error });

          throw error;
        }
      });

      if (page.kind === "image")
        return { content: [{ kind: "file", blob: page.blob, mime: page.mime }] };

      return {
        content: [{ kind: "text", text: page.text === "" ? "The page is empty." : page.text }],
      };
    },
  };
}

/** GETs `start`, following redirects by hand so every hop stays on http(s), and returns the final 2xx response. */
async function follow(
  fetch: Fetch,
  start: URL,
  format: Format,
  signal: AbortSignal,
): Promise<Response> {
  let url = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await get(fetch, url, format, signal);
    const location = response.headers.get("location");

    if (response.status < 300 || response.status >= 400 || location === null) {
      if (response.ok) return response;
      await response.body?.cancel();
      throw new Error(
        `${url.href} answered HTTP ${response.status}${response.statusText === "" ? "" : ` ${response.statusText}`}.`,
      );
    }

    await response.body?.cancel();
    const next = new URL(location, url);

    if (next.protocol !== "http:" && next.protocol !== "https:")
      throw new Error(`${url.href} redirects to ${next.href}, which isn't http(s).`);
    url = next;
  }

  throw new Error(`${start.href} redirects more than ${MAX_REDIRECTS} times.`);
}

/** One GET, sent again as plain `nyte` when Cloudflare answers with a browser challenge. */
async function get(fetch: Fetch, url: URL, format: Format, signal: AbortSignal): Promise<Response> {
  const send = (agent: string) =>
    fetch(url, {
      headers: {
        "User-Agent": agent,
        Accept: ACCEPT[format],
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "manual",
      signal,
    });

  const response = await send(USER_AGENT);

  if (response.status !== 403 || response.headers.get("cf-mitigated") !== "challenge")
    return response;
  await response.body?.cancel();

  return send("nyte");
}
