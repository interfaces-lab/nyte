import { open, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { SdkError } from "@nyte-ai/schema";
import type { PrincipalId } from "@nyte-ai/schema";
import { classifyFile } from "./file-kind.ts";
import { readHead } from "./files.ts";

const IDLE_MS = 15 * 60_000;

const MAX_LINKS = 256;

const CHUNK = 256 * 1024;

type Link = {
  readonly path: string;
  readonly mime: string;
  readonly principal: PrincipalId;
  readonly used: number;
};

export interface MediaLinks {
  issue(path: string, principal: PrincipalId): Promise<string>;
  serve(token: string, range: string | null): Promise<Response>;
  revoke(principal: PrincipalId): void;
}

export function createMediaLinks(): MediaLinks {
  const links = new Map<string, Link>();

  const keep = (token: string, link: Link): void => {
    links.delete(token);
    links.set(token, link);

    for (const [held, kept] of links)
      if (links.size > MAX_LINKS || link.used - kept.used > IDLE_MS) links.delete(held);
  };

  return {
    async issue(path, principal) {
      if (!isAbsolute(path)) throw new SdkError("invalid", `${path} is not an absolute path.`);

      const head =
        (await stat(path).catch(() => null))?.isFile() === true
          ? await readHead(path).catch(() => null)
          : null;

      if (head === null) throw new SdkError("unknown", `No file is at ${path}.`);
      const file = classifyFile(path, head);

      if (file.kind !== "video") throw new SdkError("invalid", `${path} is not a video.`);
      const token = crypto.randomUUID();
      keep(token, { path, mime: file.mime, principal, used: Date.now() });

      return token;
    },
    async serve(token, header) {
      const link = links.get(token);
      const now = Date.now();

      if (link === undefined || now - link.used > IDLE_MS) {
        links.delete(token);

        throw new SdkError("unknown", "This media link is unknown or expired.");
      }

      keep(token, { ...link, used: now });
      const stats = await stat(link.path).catch(() => null);

      if (stats?.isFile() !== true) throw new SdkError("unknown", `No file is at ${link.path}.`);
      const size = stats.size;
      const range = parseRange(header, size);

      if (range === "unsatisfiable")
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      const start = range?.start ?? 0;
      const end = range?.end ?? size - 1;

      const headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Type": link.mime,
        "Content-Length": String(end + 1 - start),
        "X-Content-Type-Options": "nosniff",
      };

      return range === null
        ? new Response(size === 0 ? null : readRange(link.path, start, end), {
            status: 200,
            headers,
          })
        : new Response(readRange(link.path, start, end), {
            status: 206,
            headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}` },
          });
    },
    revoke(principal) {
      for (const [token, link] of links) if (link.principal === principal) links.delete(token);
    },
  };
}

function parseRange(
  header: string | null,
  size: number,
): { readonly start: number; readonly end: number } | "unsatisfiable" | null {
  const match = header === null ? null : /^bytes=(\d*)-(\d*)$/u.exec(header.trim());

  if (match === null || (match[1] === "" && match[2] === "")) return null;

  if (match[1] === "") {
    const suffix = Number(match[2]);

    return suffix === 0 || size === 0
      ? "unsatisfiable"
      : { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);

  if (start >= size) return "unsatisfiable";

  return end < start ? null : { start, end };
}

function readRange(path: string, start: number, end: number): ReadableStream<Uint8Array> {
  let handle: FileHandle | null = null;
  let position = start;

  const close = async (): Promise<void> => {
    const held = handle;
    handle = null;
    await held?.close();
  };

  return new ReadableStream({
    async pull(controller) {
      const length = Math.min(CHUNK, end + 1 - position);

      if (length <= 0) {
        await close();
        controller.close();

        return;
      }

      handle ??= await open(path, "r");
      const buffer = new Uint8Array(length);
      const reading = handle.read(buffer, 0, length, position);
      void reading.catch(() => close());
      const read = (await reading).bytesRead;

      if (read === 0) {
        await close();
        controller.error(new SdkError("unknown", `${path} ended before the range it promised.`));

        return;
      }

      position += read;
      controller.enqueue(buffer.subarray(0, read));
    },
    cancel: close,
  });
}
