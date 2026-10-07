/**
 * The failures the Connect lifecycle reports to its embedding, each a fixed
 * wire error: a desktop maps it onto IPC, a headless host onto its own output.
 * Only fixed messages belong here; never request or broker text.
 */
import type { WireError } from "@nyte-ai/protocol";

export class ConnectError extends Error {
  readonly error: WireError;

  constructor(error: WireError) {
    super(error.message);
    this.name = "ConnectError";
    this.error = error;
  }
}
