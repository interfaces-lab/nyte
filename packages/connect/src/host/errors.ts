import { SdkError } from "@nyte-ai/core";

/**
 * A failure the Connect lifecycle reports to its embedding, as an `SdkError`
 * with a fixed message: a desktop maps it onto IPC, a headless host onto its
 * own output. Only fixed messages belong here; never request or broker text.
 */
export class ConnectError extends SdkError {}
