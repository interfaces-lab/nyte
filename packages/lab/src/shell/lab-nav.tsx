import { create, props } from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import type { router } from "../router";

const PAGES = [
  ["/requests", "Requests"],
  ["/review", "Review"],
  ["/projects", "Projects"],
  ["/canvas", "Canvas"],
  ["/changes", "Changes"],
  ["/chat-rail", "Chat rail"],
  ["/sdk", "SDK"],
  ["/settings", "Settings"],
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
    color: {
      default: "rgb(255 255 255 / 0.6)",
      ":hover": "rgb(255 255 255)",
      "[data-status='active']": "rgb(255 255 255)",
    },
    backgroundColor: {
      default: "transparent",
      "[data-status='active']": "rgb(255 255 255 / 0.12)",
    },
    textDecoration: "none",
  },
});

export function LabNav() {
  return (
    <nav aria-label="Lab pages" {...props(styles.nav)}>
      {PAGES.map(([path, label]) => (
        <Link<typeof router, string, Path>
          key={path}
          to={path}
          activeOptions={{ exact: true, includeSearch: false }}
          {...props(styles.link)}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
