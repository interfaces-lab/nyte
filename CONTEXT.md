# Nyte conversations

The language used for conversations, execution, and extensions across Nyte clients and hosts.

## Language

**Session**:
A persistent conversation with its history and named branches. A session can outlive many runs.
_Avoid_: Run, process

**Head**:
A named position in a session's history that selects a conversation branch.
_Avoid_: Run, checkpoint

**Run**:
One execution on a head, potentially containing several model responses and tool calls. Ending a run does not end its session.
_Avoid_: Session, transcript turn

**Transcript turn**:
A displayed group of related user, assistant, reasoning, and tool parts. It describes conversation presentation, not an execution lifetime.
_Avoid_: Run, model response

**Agent preset**:
A named session configuration describing a role and optional model, tool, and execution limits.
_Avoid_: Subagent, running session

**Subagent**:
A child session used for delegated work. Its lifetime is separate from a caller's wait for its answer.
_Avoid_: Job, agent preset

**Job**:
A managed command execution that can continue in the background. It is not a delegated conversation.
_Avoid_: Subagent, child session

**Checkpoint**:
A compacted representation of earlier conversation context for subsequent model requests.
_Avoid_: Edit point, session snapshot, workspace restore point

**Session snapshot**:
A read of a session's selected history and visible execution state for a client.
_Avoid_: Checkpoint, workspace backup

**Plugin activation**:
The contributions and resources a host has made available to one session from its plugins.
_Avoid_: Installation, plugin generation

**Skill**:
A named set of instructions and metadata available to guide the model's work.
_Avoid_: Executable plugin, tool permission
