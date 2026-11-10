import { useEffect, useState } from "react";
import { compile, ToolPartStateType, withJson } from "@nyte-ai/schema";
import type { PartId, SessionId, ToolPartState } from "@nyte-ai/sdk";
import { useHost } from "../connection/host-context.tsx";

const TOOL_STATE = compile(withJson(ToolPartStateType));

/**
 * A tool's state, read whole from its part while `open` when its row carries a cut view.
 * The row's state shows until the part arrives.
 */
export function useWholeToolState(
  session: SessionId,
  tool:
    | { readonly part: PartId; readonly state: ToolPartState; readonly elided?: true }
    | undefined,
  open: boolean,
): ToolPartState | undefined {
  const live = useHost().live;
  const [whole, setWhole] = useState<ToolPartState>();
  const reads = open && tool?.elided === true;
  const part = tool?.part;

  // oxlint-disable-next-line nyte-code/no-direct-effect -- holds the part's live store open while the row is open
  useEffect(() => {
    if (!reads || part === undefined) return;
    const store = live.part(session, part);

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
  }, [reads, live, session, part]);

  return reads && whole?.call === tool?.state.call ? whole : tool?.state;
}
