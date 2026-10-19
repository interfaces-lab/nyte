import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Repo } from "./git.ts";
import { findModel, type ReviewHost } from "./host.ts";
import { DIRECTOR_AGENT } from "./reviewer.ts";

const StudioStartSchema = Type.Object({ prompt: Type.String({ minLength: 1 }) });

const PREFERRED = "anthropic/claude-opus-5-5";

/** The studio's director: the model it uses and the session that edits the film. */
export function studioRoutes(
  core: () => Promise<{ readonly host: ReviewHost; readonly repo: Repo }>,
) {
  const directorModel = async () => {
    const { host } = await core();
    const requested = process.env["NYTE_LAB_STUDIO_MODEL"];

    if (requested !== undefined && requested !== "") return findModel(host.sdk, requested);

    return findModel(host.sdk, PREFERRED).catch(() => findModel(host.sdk));
  };

  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;

    if (request.method === "GET" && path === "/model") {
      const model = await directorModel();

      return Response.json({ model: `${model.provider}/${model.id}` });
    }

    if (request.method === "POST" && path === "/session") {
      const input: unknown = await request.json();

      if (!Value.Check(StudioStartSchema, input))
        return Response.json({ error: "Provide the first message as prompt." }, { status: 400 });

      const { host, repo } = await core();
      const model = await directorModel();
      const workspace = await host.sdk.workspaces.add({ kind: "local", path: repo.root });

      if (workspace.kind !== "added" && workspace.kind !== "exists")
        return Response.json(
          { error: `The repository is unavailable: ${workspace.kind}` },
          { status: 503 },
        );

      const { session } = await host.sdk.sessions.start({
        name: `studio ${Date.now()}`,
        workspace: workspace.workspace,
        configuration: { model, agent: DIRECTOR_AGENT },
        content: input.prompt,
      });

      return Response.json({ sessionId: session.id, model: `${model.provider}/${model.id}` });
    }

    return Response.json({ error: "Studio route not found." }, { status: 404 });
  };
}
