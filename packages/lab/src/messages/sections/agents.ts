import {
  RUNNING,
  type Section,
  asking,
  broken,
  create,
  delegate,
  failed,
  finished,
  lone,
  ok,
} from "../build";

export const agentsSection: Section = {
  id: "agents",
  title: "Subagents",
  detail:
    "A delegate create is a card for its child session; send, read and stop on that child are lines. An await is the run's own control flow and never reaches a turn.",
  specimens: [
    lone(
      "agent-starting",
      "Starting",
      'delegate · role = "create" · no child yet · status from the call',
      create("Map translucent tints to tokens", null, RUNNING, 0),
    ),
    lone(
      "agent-done",
      "Completed",
      "create · child idle, last run completed",
      create("Review titlebar alignment", finished, ok(), 0),
    ),
    lone(
      "agent-asking",
      "Waiting for a reply",
      "create · child waiting on a part",
      create("Confirm workspace trust copy", asking, ok(), 0),
    ),
    lone(
      "agent-failed",
      "Failed",
      "create · child idle, last run failed",
      create("Audit floating surface shadows", broken, ok(), 0),
    ),
    lone(
      "agent-unstarted",
      "Never started",
      "create · no child · status from the call",
      create("Profile the transcript", null, failed("The subagent could not start."), 0),
    ),
    lone(
      "agent-send",
      "Message to an agent",
      'delegate · role = "send"',
      delegate("send", finished.id, ok(), 0, "Also check the window controls on Windows."),
    ),
    lone(
      "agent-read",
      "Read an agent",
      'delegate · role = "read"',
      delegate("read", finished.id, ok(), 0),
    ),
    lone(
      "agent-stop",
      "Stop an agent",
      'delegate · role = "stop"',
      delegate("stop", asking.id, ok(), 0),
    ),
  ],
};
