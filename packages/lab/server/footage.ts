import { readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

/** The film's footage, which Remotion reads with --public-dir. */
const FOOTAGE_DIR = join(process.cwd(), "video/public");

const TYPES = new Map([
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".json", "application/json"],
]);

/** Serves a footage file, with byte ranges so audio can seek. Footage is a few megabytes, so it is read whole. */
export async function serveFootage(request: Request, name: string): Promise<Response> {
  const path = join(FOOTAGE_DIR, name);
  const inside = relative(FOOTAGE_DIR, path);

  if (inside === "" || inside.startsWith("..")) return new Response("Not found.", { status: 404 });

  const file = await readFile(path).catch(() => undefined);

  if (file === undefined)
    return new Response(
      `No footage at video/public/${name}. Generate it first; it stays out of Git.`,
      {
        status: 404,
      },
    );

  const headers = {
    "content-type": TYPES.get(extname(path)) ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "no-cache",
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");

  if (range === null)
    return new Response(file, { headers: { ...headers, "content-length": String(file.length) } });

  const start = range[1] === "" ? Math.max(0, file.length - Number(range[2])) : Number(range[1]);
  const end =
    range[1] !== "" && range[2] !== ""
      ? Math.min(Number(range[2]), file.length - 1)
      : file.length - 1;

  if (start > end || start >= file.length)
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${file.length}` },
    });

  return new Response(file.subarray(start, end + 1), {
    status: 206,
    headers: {
      ...headers,
      "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${file.length}`,
    },
  });
}
