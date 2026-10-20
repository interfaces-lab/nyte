import type { Recovery } from "@nyte-ai/plugin/client/presentation";
import type { SessionId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { toast } from "@nyte-ai/ui/toast";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactElement } from "react";
import { errorMessage } from "../errors.ts";
import { connected } from "../sdk.tsx";
import { showsSettingsSection } from "../settings/index.ts";
import { SessionModelChip } from "./composer-model-chip.tsx";
import { compactSession } from "./composer-send.ts";
import { useTranscriptScope } from "./transcript.tsx";

export function RecoveryAction({ recovery }: { readonly recovery: Recovery }): ReactElement | null {
  const sessionId = useTranscriptScope()?.sessionId;

  if (sessionId === undefined) return null;

  switch (recovery) {
    case "compact":
      return <CompactButton sessionId={sessionId} />;
    case "sign-in":
      return showsSettingsSection("providers") ? <SignInButton /> : null;
    case "switch-model":
      return <SessionModelChip sessionId={sessionId} />;
    default: {
      const _exhaustive: never = recovery;

      return _exhaustive;
    }
  }
}

function CompactButton({ sessionId }: { readonly sessionId: SessionId }): ReactElement {
  const [compacting, setCompacting] = useState(false);

  const compact = async (): Promise<void> => {
    setCompacting(true);

    try {
      const outcome = await compactSession((await connected()).session(sessionId), "");

      if (outcome.kind === "refused") toast.add({ type: "error", title: outcome.message });
      else if (outcome.note !== undefined) toast.add({ type: "info", title: outcome.note });
    } catch (cause: unknown) {
      toast.add({
        type: "error",
        title: "Couldn't compact the chat",
        description: errorMessage(cause),
      });
    }

    setCompacting(false);
  };

  return (
    <Button variant="text" loading={compacting} onClick={() => void compact()}>
      Compact Chat
    </Button>
  );
}

function SignInButton(): ReactElement {
  const navigate = useNavigate();

  return (
    <Button
      variant="text"
      onClick={() => void navigate({ to: "/settings/$section", params: { section: "providers" } })}
    >
      Sign In Again
    </Button>
  );
}
