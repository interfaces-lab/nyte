export function missing(error: unknown): null {
  const code = readErrorCode(error);

  if (code === "ENOENT" || code === "ENOTDIR") return null;

  throw error;
}

export function readErrorCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}
