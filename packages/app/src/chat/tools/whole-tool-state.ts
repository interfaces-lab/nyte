import type { ToolMessage } from "@nyte-ai/plugin/client/presentation";
import { compile, ToolPartStateType, withJson } from "@nyte-ai/schema";
import type { ToolPartState } from "@nyte-ai/schema";
import { useEffect, useState } from "react";
import { currentLive } from "../../data/connection.ts";
import { useTranscriptScope } from "../transcript/transcript.tsx";

const TOOL_STATE = compile(withJson(ToolPartStateType));

/**
 * A tool row's state, read whole from its part while `open` when the row carries a cut view.
 * The row's state shows until the part arrives.
 */
export function useWholeToolState(message: ToolMessage, open: boolean): ToolPartState {
  const session = useTranscriptScope()?.sessionId;
  const [whole, setWhole] = useState<ToolPartState>();
  const reads = open && message.elided === true;
  const part = message.part;

  // oxlint-disable-next-line nyte-code/no-direct-effect -- holds the part's live store open while the row is open
  useEffect(() => {
    if (!reads || session === undefined) return;
    const store = currentLive()?.part(session, part);

    if (store === undefined) return;

    const show = (): void => {
      const state = store.snapshot()?.part?.state;

      if (TOOL_STATE.Check(state)) setWhole(state);
    };

    const stop = store.subscribe(show);
    show();

    return () => {
      stop();
      store.close();
    };
  }, [reads, session, part]);

  return reads && whole?.call === message.state.call ? whole : message.state;
}
