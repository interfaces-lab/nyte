import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,

  // Memoises components and hooks at build time so marketing pages stop
  // re-rendering on unrelated state changes without hand-written useMemo.
  reactCompiler: true,

  // Everything dynamic must sit behind an explicit `use cache` or a Suspense
  // boundary. On a docs site that is nearly the whole tree, so pages are
  // prerendered and served from cache rather than re-rendered per request.
  cacheComponents: true,

  async redirects() {
    return [
      { source: "/cloud", destination: "/docs/components/introduction", permanent: true },
      { source: "/cloud/:path*", destination: "/docs/components/:path*", permanent: true },
      { source: "/kernel", destination: "/docs/kernel/architecture", permanent: true },
      { source: "/kernel/:path*", destination: "/docs/kernel/:path*", permanent: true },
      { source: "/docs/composition", destination: "/docs/build/composition", permanent: true },
      { source: "/docs/sdk", destination: "/docs/build/sdk", permanent: true },
      { source: "/docs/desktop", destination: "/docs/build/desktop", permanent: true },
    ];
  },

  experimental: {
    // Barrel-file tree-shaking keeps Lucide out of the shared chunk.
    optimizePackageImports: ["lucide-react"],
  },
};

export default withMDX(config);
