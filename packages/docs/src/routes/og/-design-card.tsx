// oxlint-disable-next-line import/default -- Vite's ?inline query makes the file a data URL.
import pixelFace from "~/fonts/GeistPixel-Square.woff2?inline";
// oxlint-disable-next-line import/default -- Vite's ?inline query makes the file a data URL.
import monoFace from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?inline";
import type { ReactNode } from "react";
import { moonCells } from "~/components/design-site/mark";
import { findEntry } from "~/lib/design-catalog";
import type { DocPage } from "~/lib/docs";
import { designName } from "~/lib/shared";

export const cardSize = { width: 1200, height: 630 };

const ink = {
  paper: "#fbfbfa",
  line: "#e5e4e1",
  tick: "#9f9d99",
  text: "#1c1c1b",
  muted: "#6b6a67",
  faint: "#a3a19d",
  accent: "#2222dd",
  dot: "#d9d8d4",
};

const pixel = "Geist Pixel Square";

const mono = "Geist Mono";

function fontBytes(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

export function cardFonts() {
  return [
    { name: pixel, data: fontBytes(pixelFace), weight: 500 },
    { name: mono, data: fontBytes(monoFace) },
  ];
}

const frame = { left: 56, right: 1144 };

function Sheet({ ticks, children }: { ticks: readonly number[]; children: ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: ink.paper,
        color: ink.text,
        fontFamily: "Geist",
      }}
    >
      {[frame.left, frame.right].map((x) => (
        <div
          key={`line-${x}`}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: x,
            width: 1,
            background: ink.line,
          }}
        />
      ))}
      {[frame.left, ...ticks, frame.right].map((x) => (
        <div
          key={`tick-${x}`}
          style={{
            position: "absolute",
            top: 20,
            left: x,
            width: 1,
            height: 10,
            background: ink.tick,
          }}
        />
      ))}
      {children}
    </div>
  );
}

function Moon({ size }: { size: number }) {
  const cell = size / 12;

  return (
    <div style={{ position: "relative", display: "flex", width: size, height: size }}>
      {moonCells.map((moonCell) => (
        <div
          key={`${moonCell.x}-${moonCell.y}`}
          style={{
            position: "absolute",
            left: moonCell.x * cell,
            top: moonCell.y * cell,
            width: cell,
            height: cell,
            background: ink.accent,
            opacity: moonCell.lit ? 1 : 0.24,
          }}
        />
      ))}
    </div>
  );
}

function Masthead({ trail }: { trail: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 64,
        left: 88,
        right: 88,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Moon size={24} />
        <div style={{ fontFamily: pixel, fontSize: 26, lineHeight: 1 }}>{designName}</div>
      </div>
      <div style={{ fontFamily: mono, fontSize: 18, color: ink.faint }}>{trail}</div>
    </div>
  );
}

const specimens: readonly { slug: string; draw: () => ReactNode }[] = [
  {
    slug: "button",
    draw: () => (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 34,
          padding: "0 16px",
          borderRadius: 8,
          background: ink.text,
          color: ink.paper,
          fontSize: 17,
          fontWeight: 500,
        }}
      >
        Commit
      </div>
    ),
  },
  {
    slug: "switch",
    draw: () => (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          width: 46,
          height: 26,
          padding: 3,
          borderRadius: 13,
          background: ink.accent,
        }}
      >
        <div style={{ width: 20, height: 20, borderRadius: 10, background: "#ffffff" }} />
      </div>
    ),
  },
  {
    slug: "slider",
    draw: () => (
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          width: 120,
          height: 20,
        }}
      >
        <div style={{ width: 120, height: 4, borderRadius: 2, background: ink.line }} />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 8,
            width: 72,
            height: 4,
            borderRadius: 2,
            background: ink.accent,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 64,
            top: 1,
            width: 18,
            height: 18,
            borderRadius: 9,
            background: "#ffffff",
            border: `1px solid ${ink.line}`,
            boxShadow: "0 1px 3px rgb(0 0 0 / 0.16)",
          }}
        />
      </div>
    ),
  },
  {
    slug: "checkbox",
    draw: () => (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[true, false].map((checked) => (
          <div key={String(checked)} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 5,
                background: checked ? ink.accent : ink.paper,
                border: checked ? "none" : `1.5px solid ${ink.tick}`,
              }}
            />
            <div
              style={{ width: checked ? 72 : 52, height: 6, borderRadius: 3, background: ink.line }}
            />
          </div>
        ))}
      </div>
    ),
  },
  {
    slug: "kbd",
    draw: () => (
      <div style={{ display: "flex", gap: 6 }}>
        {["Shift", "K"].map((key) => (
          <div
            key={key}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 32,
              height: 32,
              padding: "0 9px",
              borderRadius: 7,
              border: `1px solid ${ink.line}`,
              background: "#ffffff",
              boxShadow: `0 2px 0 ${ink.line}`,
              fontFamily: mono,
              fontSize: 15,
              color: ink.muted,
            }}
          >
            {key}
          </div>
        ))}
      </div>
    ),
  },
  {
    slug: "avatar",
    draw: () => (
      <div style={{ display: "flex" }}>
        {[
          ["NY", "#fde7d4", "#b4541a"],
          ["DS", "#dfe5ff", "#2b3fd1"],
          ["UI", "#ece4fb", "#6d3fc0"],
        ].map(([initials, fill, color], index) => (
          <div
            key={initials}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              marginLeft: index === 0 ? 0 : -8,
              borderRadius: 20,
              border: `2px solid ${ink.paper}`,
              background: fill,
              color,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {initials}
          </div>
        ))}
      </div>
    ),
  },
];

export function LandingCard({ page }: { page: DocPage }) {
  const strip = { left: 88, width: 1024, top: 392, height: 182 };
  const cell = strip.width / specimens.length;

  return (
    <Sheet ticks={specimens.map((_specimen, index) => strip.left + index * cell)}>
      <Masthead trail="design.nyte.sh" />
      <div
        style={{
          position: "absolute",
          top: 132,
          left: 88,
          right: 88,
          display: "flex",
          flexDirection: "column",
          gap: 22,
        }}
      >
        <div
          style={{ fontFamily: pixel, fontSize: 128, lineHeight: 0.9, letterSpacing: "-0.02em" }}
        >
          {designName}
        </div>
        <div style={{ fontSize: 30, lineHeight: 1.25, color: ink.muted, letterSpacing: "-0.02em" }}>
          {page.description}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: strip.top,
          left: strip.left,
          width: strip.width,
          height: strip.height,
          display: "flex",
          borderTop: `1px solid ${ink.line}`,
          borderLeft: `1px solid ${ink.line}`,
        }}
      >
        {specimens.map((specimen) => {
          const entry = findEntry(`/design/${specimen.slug}`);

          return (
            <div
              key={specimen.slug}
              style={{
                display: "flex",
                flexDirection: "column",
                width: cell,
                height: strip.height,
                borderRight: `1px solid ${ink.line}`,
                borderBottom: `1px solid ${ink.line}`,
              }}
            >
              <div
                style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}
              >
                {specimen.draw()}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "0 14px 12px",
                  fontFamily: mono,
                  fontSize: 13,
                  color: ink.faint,
                }}
              >
                <span style={{ color: ink.muted }}>{entry?.page.title}</span>
                <span>{entry?.number}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

export function PageCard({ page }: { page: DocPage }) {
  const entry = findEntry(page.url);

  const slug = page.slugs.at(-1) ?? "";

  const reference =
    page.section === "Components" && entry ? `@nyte-ai/ui/${slug}` : `design.nyte.sh/${slug}`;

  const cell = { left: 88, top: 136, size: 416 };

  return (
    <Sheet ticks={[cell.left, cell.left + cell.size]}>
      <Masthead
        trail={entry ? `${page.section} · ${entry.number} / ${entry.total}` : (page.section ?? "")}
      />
      <div
        style={{
          position: "absolute",
          top: cell.top,
          left: cell.left,
          width: cell.size,
          height: cell.size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `1px solid ${ink.line}`,
          backgroundImage: `radial-gradient(circle at 1px 1px, ${ink.dot} 1.2px, transparent 0)`,
          backgroundSize: "20px 20px",
          backgroundPosition: "10px 10px",
        }}
      >
        {entry ? (
          <div style={{ fontFamily: pixel, fontSize: 210, lineHeight: 1, color: ink.accent }}>
            {entry.number}
          </div>
        ) : (
          <Moon size={160} />
        )}
      </div>
      <div
        style={{
          position: "absolute",
          top: cell.top,
          left: cell.left + cell.size + 48,
          right: 88,
          height: cell.size,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: page.title.length > 16 ? 64 : 88,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: "-0.045em",
            }}
          >
            {page.title}
          </div>
          {page.description ? (
            <div
              style={{ fontSize: 28, lineHeight: 1.3, color: ink.muted, letterSpacing: "-0.015em" }}
            >
              {page.description}
            </div>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            paddingTop: 18,
            borderTop: `1px solid ${ink.line}`,
            fontFamily: mono,
            fontSize: 20,
            color: ink.muted,
          }}
        >
          {reference}
        </div>
      </div>
    </Sheet>
  );
}
