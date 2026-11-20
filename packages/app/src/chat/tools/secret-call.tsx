import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { readSecret, secret, secretParameters } from "@nyte-ai/plugin/secret/schema";
import type { SecretPhase } from "@nyte-ai/plugin/secret/schema";
import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { Icon } from "@nyte-ai/ui/icon";
import { chatStore } from "../../data/chat-store.ts";
import { useWatchSelect } from "../../data/watch-store.ts";
import { useTranscriptScope } from "../transcript/transcript.tsx";
import { ToolVerb, toolCardStyles } from "./tool-card.tsx";
import { ToolOutcome } from "./tool-line.tsx";
import { toolFacts } from "./tool-facts.ts";

export function SecretCallView({ message }: { readonly message: ToolMessage }): ReactElement {
  const sessionId = useTranscriptScope()?.sessionId;
  const call = message.state.call;
  const facts = toolFacts(message, message.state, undefined, "secret");

  const part = useWatchSelect(sessionId === undefined ? undefined : chatStore(sessionId), (state) =>
    (state.value?.parts ?? []).find(
      (candidate) => candidate.partKind === secret.kind && readSecret(candidate)?.call === call,
    ),
  );

  const phase = part === undefined ? undefined : readSecret(part)?.phase;
  const args = secretParameters["~standard"].validate(message.state.args);
  const asked = args instanceof Promise || args.issues !== undefined ? undefined : args.value;

  return (
    <div {...props(toolCardStyles.line)}>
      <span aria-hidden="true" {...props(toolCardStyles.glyph)}>
        <Icon name="key" size="sm" />
      </span>
      <ToolVerb running={facts.running}>{secretVerb(phase)}</ToolVerb>
      <span {...props(toolCardStyles.subject)}>{asked?.label ?? asked?.name ?? ""}</span>
      {phase?.kind === "saved" && <span {...props(toolCardStyles.muted)}>{asked?.name}</span>}
      {phase?.kind === "skipped" ? (
        <span {...props(toolCardStyles.muted)}>· Dismissed</span>
      ) : (
        <ToolOutcome status={facts.status} />
      )}
    </div>
  );
}

function secretVerb(phase: SecretPhase | undefined): string {
  switch (phase?.kind) {
    case undefined:
    case "asking":
    case "open":
      return "Waiting for";
    case "saved":
      return "Got";
    case "skipped":
      return "Asked for";
    default: {
      const _exhaustive: never = phase;

      return _exhaustive;
    }
  }
}
