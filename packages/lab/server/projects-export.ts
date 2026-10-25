import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DIRECTORY =
  process.env["NYTE_PROJECTS_EXPORT"] ?? join(process.cwd(), "research_notes/projects/export");

const FILES = new Set(["evidence.json", "checks.json"]);

export async function serveProjectsExport(name: string): Promise<Response> {
  if (!FILES.has(name)) return new Response("Not found.", { status: 404 });

  const file = await readFile(join(DIRECTORY, name)).catch(() => undefined);

  if (file === undefined)
    return new Response(
      `No ${name} in ${DIRECTORY}. Run node packages/lab/src/projects/export.ts, then node packages/lab/src/projects/checks.ts.`,
      { status: 404 },
    );

  return new Response(file, {
    headers: { "content-type": "application/json", "cache-control": "no-cache" },
  });
}
