/**
 * Compile-time constants the binary carries. Each key is the exact source
 * expression the bundler replaces, so the modules that read them must spell
 * it the same way.
 */
export function binaryDefines(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return {
    // `@opentui/core` selects its native module by reading OPENTUI_LIBC, and pnpm
    // installs only the host's libc variant. Left dynamic, the bundler has to
    // resolve both branches and fails on the absent one; pinning the value lets
    // dead code elimination drop the branch this binary cannot use. Set
    // OPENTUI_LIBC=musl in the environment to compile against musl instead.
    "process.env.OPENTUI_LIBC": JSON.stringify(env["OPENTUI_LIBC"] ?? "glibc"),
    // The Nyte Connect broker this binary links through, baked in at build time; the
    // running process's NYTE_CONNECT_ORIGIN still takes precedence. A bare identifier,
    // because `process` is an import binding in the sources and would not be replaced.
    NYTE_BUILT_CONNECT_ORIGIN: JSON.stringify(env["NYTE_CONNECT_ORIGIN"] ?? ""),
  };
}
