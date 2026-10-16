import { readFile, rm } from "node:fs/promises";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { writePrivateFile } from "@nyte-ai/connect/host";
import { openSecret, sealSecret } from "@nyte-ai/host/credentials";
import type { SecretsSource } from "@nyte-ai/host";

const savedSignIn = Compile(
  Type.Object(
    {
      sealed: Type.String({ minLength: 1, maxLength: 32_768 }),
      label: Type.String({ minLength: 1, maxLength: 320 }),
    },
    { additionalProperties: false },
  ),
);

export class AccountStore {
  private readonly path: string;
  private readonly secrets: SecretsSource;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(options: { readonly path: string; readonly secrets: SecretsSource }) {
    this.path = options.path;
    this.secrets = options.secrets;
  }

  /** The saved sign-in, its token still sealed; undefined when there is none to restore. */
  async load(): Promise<ReturnType<typeof savedSignIn.Parse> | undefined> {
    try {
      return savedSignIn.Parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      return undefined;
    }
  }

  /** The token a saved sign-in sealed; rejects when the keychain cannot open it now. */
  open(sealed: string): Promise<string> {
    return openSecret(this.secrets, sealed);
  }

  /**
   * Seals and writes the sign-in, or removes the file for none. A sign-in the
   * keychain cannot seal rejects and leaves the saved one as it was.
   */
  save(signIn: { readonly token: string; readonly label: string } | undefined): Promise<void> {
    const run = this.writes.then(async () => {
      if (signIn === undefined) return rm(this.path, { force: true });
      const sealed = await sealSecret(this.secrets, signIn.token);

      return writePrivateFile({
        path: this.path,
        text: `${JSON.stringify({ sealed, label: signIn.label })}\n`,
      });
    });

    this.writes = run.catch(() => undefined);

    return run;
  }
}
