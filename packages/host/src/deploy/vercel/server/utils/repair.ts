import { createHash, timingSafeEqual } from "node:crypto";
import { SdkError } from "@nyte-ai/core";
import { encodeError, errorStatus } from "@nyte-ai/protocol";

/** Answers the repair cron's `GET /.nyte/repair` and nothing else (any other request answers `undefined`, so the listener goes on): with `Authorization: Bearer <secret>`, compared in constant time over SHA-256 digests, it runs `repair` and answers 204; a missing or wrong bearer answers `unauthenticated` (401) and an unset or empty `secret` (no `CRON_SECRET`) `unknown` (404), running nothing. What the Vercel listener's `before` calls with `process.env.CRON_SECRET`. */
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
