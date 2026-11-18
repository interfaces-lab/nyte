export interface Product {
  title: string;
  description: string;
  href: string;
  soon?: true;
}

export const products: readonly [Product, ...Product[]] = [
  {
    title: "Core",
    description: "Sessions in SQLite or PostgreSQL.",
    href: "https://github.com/interfaces-lab/nyte/tree/main/packages/core",
  },
  {
    title: "Terminal",
    description: "The agent in your shell.",
    href: "/docs#terminal",
  },
  {
    title: "Desktop",
    description: "The Mac app.",
    href: "/docs#macos",
  },
  {
    title: "Server",
    description: "JSON and SSE over HTTP.",
    href: "/docs/build/composition",
  },
  {
    title: "Mobile",
    description: "A companion for a Mac host.",
    href: "/docs",
    soon: true,
  },
];
