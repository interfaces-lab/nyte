import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { PartView } from "@nyte-ai/schema";
import type { PartMessage } from "@nyte-ai/plugin/client/presentation";
import { drawPart } from "../../canvas/client-plugins.tsx";
import { chatStore } from "../../data/chat-store.ts";
import { useWatchSelect } from "../../data/watch-store.ts";
import { trayStyles } from "../../theme/tray.stylex.ts";
import { Tray, trayParts, useTrayRoot } from "./tray.tsx";

const TRAY = { kind: "tray" } as const;

const styles = create({ height: (height: number) => ({ maxHeight: height }) });

/** Every part a plugin placed in the tray, newest first, drawn by its renderer or its host view. */
export function PluginTrays({
  sessionId,
  viewport,
}: {
  readonly sessionId: SessionId;
  readonly viewport: HTMLElement | null;
}): ReactElement {
  const parts = useWatchSelect(chatStore(sessionId), (state) => state.value?.parts);
  const { ref, availableHeight } = useTrayRoot(viewport);

  const trays = (parts ?? [])
    .filter((part) => part.placement.kind === TRAY.kind && part.status.kind !== "failed")
    .toReversed();

  return (
    <div ref={ref} {...props(trayParts.root)}>
      <Tray open={trays.length > 0} label="Pinned">
        <div data-nyte-scrollport {...props(trayStyles.list, styles.height(availableHeight))}>
          {trays.map((part) => (
            <div key={part.id}>{drawPart(sessionId, trayMessage(part), TRAY)}</div>
          ))}
        </div>
      </Tray>
    </div>
  );
}

function trayMessage(part: PartView): PartMessage {
  return {
    id: asId<"message">(`tray:${part.id}`),
    turn: asId<"turn">(`tray:${part.id}`),
    at: 0,
    kind: "part",
    part: part.id,
    partKind: part.partKind,
    role: "note",
    state: part.state,
    version: part.version,
    status: part.status,
  };
}
