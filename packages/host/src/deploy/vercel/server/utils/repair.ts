import { createHash, timingSafeEqual } from "node:crypto";
import { SdkError } from "@nyte-ai/schema";
import { encodeError, errorStatus } from "@nyte-ai/protocol";

export async function answerRepair(
  request: Request,
  secret: string | undefined,
  repair: () => Promise<void>,
): Promise<Response | undefined> {
  if (request.method !== "GET" || new URL(request.url).pathname !== "/.nyte/repair")
    return undefined;

  if (secret === undefined || secret === "")
    return failure(new SdkError("unknown", "This deployment sets no CRON_SECRET."));

  const given = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";

  if (!timingSafeEqual(digest(given), digest(secret)))
    return failure(new SdkError("unauthenticated", "Send Authorization: Bearer <CRON_SECRET>."));

  await repair();

  return new Response(null, { status: 204 });
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

function failure(error: SdkError): Response {
  return new Response(JSON.stringify(encodeError(error)), {
    status: errorStatus[error.code],
    headers: { "Content-Type": "application/json" },
  });
}
