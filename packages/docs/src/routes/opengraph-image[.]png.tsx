import { createFileRoute } from "@tanstack/react-router";
import { googleFonts } from "takumi-js/helpers";
import { ImageResponse } from "takumi-js/response";
import { MOON } from "~/components/landing/hero-5/ascii-moon";
import { appName } from "~/lib/shared";

const size = { width: 1200, height: 630 };

let fonts: ReturnType<typeof googleFonts> | undefined;

/** The site's social card. Geist Mono is fetched once per server instance. */
export const Route = createFileRoute("/opengraph-image.png")({
  server: {
    handlers: {
      GET: async () => {
        fonts ??= googleFonts([{ name: "Geist Mono", weight: [400, 500] }]);

        return new ImageResponse(
          <div
            style={{
              display: "flex",
              width: "100%",
              height: "100%",
              padding: 72,
              justifyContent: "space-between",
              alignItems: "center",
              background: "linear-gradient(160deg, #1a1ac4 0%, #2222dd 55%, #3341ea 100%)",
              color: "#fff",
              fontFamily: "Geist Mono",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                height: "100%",
                maxWidth: 600,
              }}
            >
              <div style={{ fontSize: 30, fontWeight: 500 }}>{appName}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    fontSize: 76,
                    fontWeight: 500,
                    lineHeight: 1.02,
                    letterSpacing: "-0.03em",
                  }}
                >
                  <span>Many agents ship code.</span>
                  <span>This one is mine.</span>
                </div>
                <div style={{ fontSize: 26, color: "rgb(255 255 255 / 0.72)" }}>
                  Built like git. Runs on your laptop and at the edge.
                </div>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flexShrink: 0,
                fontSize: 19,
                lineHeight: 1.25,
              }}
            >
              {MOON.map((row, index) => (
                <div key={index} style={{ display: "flex", whiteSpace: "pre" }}>
                  {row}
                </div>
              ))}
            </div>
          </div>,
          { ...size, fonts: await fonts },
        );
      },
    },
  },
});
