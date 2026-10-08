import type unplugin from "@stylexjs/unplugin";

type VitePlugin = ReturnType<typeof unplugin.vite>;

/** `@stylexjs/unplugin` with component rules ordered below the app's and no runtime injection. */
export declare const stylex: {
  readonly vite: (options?: Parameters<typeof unplugin.vite>[0]) => VitePlugin[];
  readonly rollup: typeof unplugin.rollup;
};
