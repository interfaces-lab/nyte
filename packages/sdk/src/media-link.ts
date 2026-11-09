import { isJson, isJsonObject, MEDIA_PATH, SdkError } from "@nyte-ai/schema";
import { decodeError } from "@nyte-ai/protocol";
import { credentialHeaders, hostUrl } from "./host-connection.ts";
import type { HostCredentials } from "./host-connection.ts";

/** A URL a `<video>` element can stream the video at the absolute `path` from, with `Range` and no credentials; it stops answering after 15 minutes unused. Needs owner authority. */
export async function mediaLink(
  address: string,
  path: string,
  options: {
    readonly credentials: HostCredentials;
    readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  },
): Promise<string> {
  const response = await (options.fetch ?? fetch)(hostUrl(address, MEDIA_PATH, "http"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await credentialHeaders(options.credentials)),
    },
    body: JSON.stringify({ path }),
  });

  const answer: unknown = await response.json().catch(() => null);

  if (!response.ok) throw decodeError(isJson(answer) ? answer : null, response.status);
  const link = isJson(answer) && isJsonObject(answer) ? answer["path"] : undefined;

  if (typeof link !== "string" || !link.startsWith(`${MEDIA_PATH}/`))
    throw new SdkError("invalid", "The host answered no media link.");

  return hostUrl(address, link, "http");
}
