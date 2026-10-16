import { createFileRoute } from "@tanstack/react-router";
import { ImageResponse } from "takumi-js/response";
import { findPage } from "~/lib/docs";
import { appName } from "~/lib/shared";

/* `/og/docs/build/composition/image.png` is the social card for that page. */
export const Route = createFileRoute("/og/$")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const splat = params._splat ?? "";
        const page = splat.endsWith("/image.png")
          ? findPage(`/${splat.slice(0, -"/image.png".length)}`)
          : undefined;
        if (!page) return new Response("Not found", { status: 404 });

        return new ImageResponse(
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              width: "100%",
              height: "100%",
              padding: 80,
              background: "#0e0e10",
              color: "#f5f5f4",
            }}
          >
            <div style={{ fontSize: 32, color: "#a1a1aa" }}>{appName}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div style={{ fontSize: 72, letterSpacing: "-0.03em" }}>{page.title}</div>
              {page.description ? (
                <div style={{ fontSize: 32, color: "#a1a1aa" }}>{page.description}</div>
              ) : null}
            </div>
          </div>,
          { width: 1200, height: 630 },
        );
      },
    },
  },
});
