import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";
import { allDocs, getDoc } from "~/lib/docs";
import { appName } from "~/lib/shared";

export async function GET(_req: Request, { params }: RouteContext<"/og/docs/[...slug]">) {
  const { slug } = await params;
  const page = slug.at(-1) === "image.png" ? getDoc(slug.slice(0, -1)) : undefined;
  if (!page) notFound();

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
}

export function generateStaticParams() {
  return allDocs().map((page) => ({ slug: [...page.slugs, "image.png"] }));
}
