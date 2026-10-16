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

  open(sealed: string): Promise<string | undefined> {
    return openSecret(this.secrets, sealed).catch(() => undefined);
  }

  save(signIn: { readonly token: string; readonly label: string } | undefined): Promise<void> {
    const run = this.writes.then(async () => {
      const sealed =
        signIn === undefined
          ? undefined
          : await sealSecret(this.secrets, signIn.token).catch(() => undefined);

      if (signIn === undefined || sealed === undefined) return rm(this.path, { force: true });

      return writePrivateFile({
        path: this.path,
        text: `${JSON.stringify({ sealed, label: signIn.label })}\n`,
      });
    });

    this.writes = run.catch(() => undefined);

    return run;
  }
}
