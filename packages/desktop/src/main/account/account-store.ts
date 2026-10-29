import { readFile, rm } from "node:fs/promises";
import { serial } from "@nyte-ai/schema/serial";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { writePrivateFile } from "@nyte-ai/connect/private-file";

const savedSignIn = Compile(
  Type.Object(
    {
      sealed: Type.String({ minLength: 1, maxLength: 32_768 }),
      label: Type.String({ minLength: 1, maxLength: 320 }),
    },
    { additionalProperties: false },
  ),
);

export interface SecretSealer {
  seal(plain: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

export class AccountStore {
  private readonly path: string;
  private readonly sealer: SecretSealer;
  private readonly writes = serial();

  constructor(options: { readonly path: string; readonly sealer: SecretSealer }) {
    this.path = options.path;
    this.sealer = options.sealer;
  }

  async load(): Promise<ReturnType<typeof savedSignIn.Parse> | undefined> {
    try {
      return savedSignIn.Parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      return undefined;
    }
  }

  open(sealed: string): Promise<string> {
    return this.sealer.open(sealed);
  }

  save(signIn: { readonly token: string; readonly label: string } | undefined): Promise<void> {
    return this.writes.run(async () => {
      if (signIn === undefined) return rm(this.path, { force: true });
      const sealed = await this.sealer.seal(signIn.token);

      return writePrivateFile({
        path: this.path,
        text: `${JSON.stringify({ sealed, label: signIn.label })}\n`,
      });
    });
  }
}
