import { create, props } from "@stylexjs/stylex";

const PAGES = [
  ["/", "Tokens"],
  ["/core", "Core"],
  ["/moon", "Moon"],
  ["/environments", "Environments"],
] as const;

type Path = (typeof PAGES)[number][0];

/* Painted from literals: each page loads a different palette, and this sits on all of them. */
const styles = create({
  nav: {
    position: "fixed",
    insetBlockEnd: 12,
    insetInlineStart: 12,
    zIndex: 2147483647,
    display: "flex",
    gap: 2,
    padding: 3,
    borderRadius: 10,
    backgroundColor: "rgb(20 20 20 / 0.86)",
    backdropFilter: "blur(12px)",
    boxShadow: "0 0 0 1px rgb(255 255 255 / 0.08), 0 4px 16px rgb(0 0 0 / 0.3)",
    fontFamily: "'Inter Variable', Inter, system-ui, sans-serif",
    fontSize: 12,
    lineHeight: "16px",
  },
  link: {
    paddingBlock: 5,
    paddingInline: 10,
    borderRadius: 7,
    color: { default: "rgb(255 255 255 / 0.6)", ":hover": "rgb(255 255 255)" },
    textDecoration: "none",
  },
  current: { color: "rgb(255 255 255)", backgroundColor: "rgb(255 255 255 / 0.12)" },
});

export function LabNav({ current }: { readonly current: Path }) {
  return (
    <nav aria-label="Lab pages" {...props(styles.nav)}>
      {PAGES.map(([path, label]) => (
        <a
          key={path}
          href={path}
          aria-current={path === current ? "page" : undefined}
          {...props(styles.link, path === current && styles.current)}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
