export function binaryDefines(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return {
    "process.env.OPENTUI_LIBC": JSON.stringify(env["OPENTUI_LIBC"] ?? "glibc"),
    NYTE_BUILT_CONNECT_ORIGIN: JSON.stringify(env["NYTE_CONNECT_ORIGIN"] ?? ""),
  };
}
