import type { SessionInfo } from "@nyte-ai/protocol";

export type SessionMark = "waiting" | "retry" | "working" | "failed" | "idle";

/** Summarize execution across a session's heads, in the SDK's head order. */
export function sessionMark(session: Pick<SessionInfo, "heads">): SessionMark {
  let failed = false;
  for (const head of session.heads) {
    const kind = head.run?.phase.kind;
    switch (kind) {
      case "waiting":
        return "waiting";
      case "retry":
        return "retry";
      case "respond":
      case "tools":
        return "working";
      case "failed":
        failed = true;
        break;
      case "done":
      case "aborted":
      case undefined:
        break;
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  }
  return failed ? "failed" : "idle";
}
