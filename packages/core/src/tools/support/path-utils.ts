import type { EnvOps, ExecutionEnv } from "../../kernel/loop/env.ts";

const UNICODE_SPACES = /[  -   　]/g;

const NARROW_NO_BREAK_SPACE = " ";

function tryMacOSScreenshotPath(filePath: string): string {
  return filePath.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function tryNFDVariant(filePath: string): string {
  // macOS stores filenames in NFD (decomposed) form, try converting user input to NFD
  return filePath.normalize("NFD");
}

function tryCurlyQuoteVariant(filePath: string): string {
  // macOS uses U+2019 (right single quotation mark) in screenshot names like "Capture d'écran"
  // Users typically type U+0027 (straight apostrophe)
  return filePath.replace(/'/g, "’");
}

/** Resolve a tool path in `env` after normalizing unicode spaces and dropping a leading `@`. */
export function resolveToCwd(filePath: string, env: Pick<EnvOps, "resolve">): string {
  return env.resolve(filePath.replace(UNICODE_SPACES, " ").replace(/^@/, ""));
}

export async function resolveReadPathAsync(env: ExecutionEnv, filePath: string): Promise<string> {
  const resolved = resolveToCwd(filePath, env);
  const exists = async (path: string): Promise<boolean> => (await env.stat(path)) !== undefined;

  if (await exists(resolved)) {
    return resolved;
  }

  // Try macOS AM/PM variant (narrow no-break space before AM/PM)
  const amPmVariant = tryMacOSScreenshotPath(resolved);

  if (amPmVariant !== resolved && (await exists(amPmVariant))) {
    return amPmVariant;
  }

  // Try NFD variant (macOS stores filenames in NFD form)
  const nfdVariant = tryNFDVariant(resolved);

  if (nfdVariant !== resolved && (await exists(nfdVariant))) {
    return nfdVariant;
  }

  // Try curly quote variant (macOS uses U+2019 in screenshot names)
  const curlyVariant = tryCurlyQuoteVariant(resolved);

  if (curlyVariant !== resolved && (await exists(curlyVariant))) {
    return curlyVariant;
  }

  // Try combined NFD + curly quote (for French macOS screenshots like "Capture d'écran")
  const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);

  if (nfdCurlyVariant !== resolved && (await exists(nfdCurlyVariant))) {
    return nfdCurlyVariant;
  }

  return resolved;
}
