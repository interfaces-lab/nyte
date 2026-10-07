/**
 * The Nyte sign-in a release build keeps across restarts, in a 0600 file:
 * Clerk's client token sealed by the OS keychain, beside the address Settings
 * shows. Loading reads only the file. The keychain is asked to open the token
 * when Clerk first needs it and to seal a new one; forgetting asks nothing.
 */
import { readFile, rm } from "node:fs/promises";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { writePrivateFile } from "@nyte-ai/connect/host";

/**
 * Encrypts secrets with a key the OS holds for this app. Each call may reach the OS keychain,
 * which on macOS can ask the user, so callers ask only when they need a key.
 */
export interface SecretCipher {
  /** False when the OS would store the key in plain text, or has none. */
  available(): Promise<boolean>;
  seal(plain: string): Promise<string>;
  /** Rejects when the sealed text is not this app's. */
  open(sealed: string): Promise<string>;
}

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
  private readonly cipher: SecretCipher;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(options: { readonly path: string; readonly cipher: SecretCipher }) {
    this.path = options.path;
    this.cipher = options.cipher;
  }

  /** The saved sign-in, its token still sealed; undefined when there is none to restore. */
  async load(): Promise<ReturnType<typeof savedSignIn.Parse> | undefined> {
    try {
      return savedSignIn.Parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      return undefined;
    }
  }

  /** The client token, or undefined when the keychain refuses or did not seal it. */
  async open(sealed: string): Promise<string | undefined> {
    try {
      return (await this.cipher.available()) ? await this.cipher.open(sealed) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Keep this sign-in, or forget the saved one. A token the keychain will not
   * seal is never written, and the older one goes. Saves run one at a time.
   */
  save(signIn: { readonly token: string; readonly label: string } | undefined): Promise<void> {
    const run = this.writes.then(async () => {
      const sealed = signIn === undefined ? undefined : await this.seal(signIn.token);

      if (signIn === undefined || sealed === undefined) return rm(this.path, { force: true });

      return writePrivateFile({
        path: this.path,
        text: `${JSON.stringify({ sealed, label: signIn.label })}\n`,
      });
    });

    this.writes = run.catch(() => undefined);

    return run;
  }

  private async seal(token: string): Promise<string | undefined> {
    try {
      return (await this.cipher.available()) ? await this.cipher.seal(token) : undefined;
    } catch {
      return undefined;
    }
  }
}
