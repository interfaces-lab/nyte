import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nyteHome } from "@nyte-ai/host";

/** 256 bits, URL-safe so it pastes anywhere a bearer can go. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Kept across runs so a browser's saved connection keeps working. */
export async function loadOrCreateToken(): Promise<string> {
  const directory = join(nyteHome(), "serve");
  const path = join(directory, "token");
  const saved = await readFile(path, "utf8").then(
    (text) => text.trim(),
    () => "",
  );

  if (saved !== "") return saved;
  const token = randomToken();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path, `${token}\n`, { mode: 0o600 });

  return token;
}
