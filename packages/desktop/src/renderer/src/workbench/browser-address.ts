const SEARCH_URL = "https://duckduckgo.com/?q=";

function parseWebUrl(value: string): string | undefined {
  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function looksLikeHost(value: string): boolean {
  if (/\s/.test(value)) return false;
  const host = value.split(/[/?#]/, 1)[0] ?? "";

  if (host === "localhost" || host.startsWith("localhost:")) return true;

  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)) return true;

  return /^[\w-]+(\.[\w-]+)+(:\d+)?$/.test(host);
}

/** URL, then bare host with `https://`, then a search. No request before Enter. */
export function resolveBrowserAddress(input: string): string | undefined {
  const value = input.trim();

  if (value === "") return undefined;
  const direct = parseWebUrl(value);

  if (direct !== undefined) return direct;

  if (looksLikeHost(value)) {
    const scheme = value.startsWith("localhost") || /^\d/.test(value) ? "http://" : "https://";

    return parseWebUrl(`${scheme}${value}`);
  }

  return `${SEARCH_URL}${encodeURIComponent(value)}`;
}

/** What the address bar shows for a loaded page. */
export function displayAddress(url: string): string {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "https:") return url;
    const rest = `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;

    return rest.endsWith("/") &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === ""
      ? rest.slice(0, -1)
      : rest;
  } catch {
    return url;
  }
}
