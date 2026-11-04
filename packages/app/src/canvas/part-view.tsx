import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { isJson } from "@nyte-ai/schema";
import type { HostView, SessionId } from "@nyte-ai/sdk";
import type { PartMessage } from "@nyte-ai/plugin/client/presentation";
import { RawPartView } from "../chat/transcript/raw-part.tsx";
import { connection } from "../data/connection.ts";
import { CanvasFrame } from "./canvas-frame.tsx";
import { readCode } from "./canvas-panel.tsx";

export function PartView({
  sessionId,
  message,
  view,
}: {
  readonly sessionId: SessionId;
  readonly message: PartMessage;
  readonly view: HostView["views"][number];
}): ReactElement | null {
  const code = useQuery({
    queryKey: ["part-view", view.blob],
    queryFn: () => readCode(view.blob),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const state = message.state;

  if (code.isError || !isJson(state)) return <RawPartView message={message} />;

  if (code.data === undefined) return null;

  return (
    <CanvasFrame
      state={{
        runtime: view.runtime,
        code: code.data,
        title: message.partKind,
        height: null,
        error: null,
      }}
      part={{
        state,
        async act(action, input) {
          const outcome = await connection()
            .session(sessionId)
            .part(message.part)
            .act(action, input);

          return isJson(outcome)
            ? outcome
            : { kind: "failed", message: "The part answered with something a view can't read." };
        },
      }}
    />
  );
}
