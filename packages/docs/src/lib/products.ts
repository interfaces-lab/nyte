export interface Product {
  title: string;
  description: string;
  href: string;
  soon?: true;
}

/* Every host the kernel ships in. Each description is a claim backed by README.md. */
export const products: readonly [Product, ...Product[]] = [
  {
    title: "Core",
    description: "Sessions built like git.",
    href: "/docs/kernel/architecture",
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
