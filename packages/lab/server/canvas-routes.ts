import { resolveModel } from "@nyte-ai/host";
import { Value } from "typebox/value";
import { CanvasInputSchema } from "../src/canvas/wire.ts";
import { buildRuntime, compileCanvas } from "./canvas.ts";
import { readCanvas, storeCanvas } from "./canvas-store.ts";
import type { ReviewHost } from "./host.ts";

export function canvasRoutes(core: () => Promise<{ readonly host: ReviewHost }>) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;

    try {
      if (request.method === "GET" && path === "/runtime.js")
        return new Response(await buildRuntime(), {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "no-cache",
            "x-content-type-options": "nosniff",
          },
        });

      if (request.method === "POST" && path === "/compile") {
        const input: unknown = await request.json();

        if (!Value.Check(CanvasInputSchema, input))
          return Response.json(
            { error: "Provide title and source, a TSX module under 100,000 characters." },
            { status: 400 },
          );

        return Response.json(
          await storeCanvas({
            title: input.title,
            code: await compileCanvas(input.source),
            runtime: 1,
          }),
        );
      }

      if (request.method === "POST" && path === "/session") {
        const { host } = await core();

        const model = await resolveModel(
          host.models,
          process.env["NYTE_LAB_CANVAS_MODEL"] || "openai-codex/gpt-6-luna",
        );

        const session = await host.sdk.sessions.create({ name: `canvas ${Date.now()}` });

        const outcome = await host.sdk.sessions.configure({
          sessionId: session.sessionId,
          model: { provider: model.provider, id: model.id },
        });

        if (outcome.kind !== "queued")
          throw new Error(
            `Canvas model ${model.provider}/${model.id} is unavailable: ${outcome.kind}`,
          );

        return Response.json({
          sessionId: session.sessionId,
          model: `${model.provider}/${model.id}`,
        });
      }

      if (request.method === "GET" && /^\/[a-f0-9]{64}$/.test(path)) {
        const snapshot = await readCanvas(path.slice(1));

        return snapshot === undefined
          ? Response.json({ error: "Canvas not found." }, { status: 404 })
          : Response.json(snapshot);
      }

      return Response.json({ error: "Canvas route not found." }, { status: 404 });
    } catch (cause) {
      return Response.json(
        { error: cause instanceof Error ? cause.message : String(cause) },
        { status: path === "/session" ? 503 : 400 },
      );
    }
  };
}
