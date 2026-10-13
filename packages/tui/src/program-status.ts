import { CliRenderEvents } from "@opentui/core";
import type { CliRenderer, NativeSession } from "@opentui/core";
import type { RunId } from "@nyte-ai/sdk";
import { CLEARED, encode, statusOf } from "./lib/program-status.ts";
import type { Activity } from "./lib/program-status.ts";

/**
 * Keeps the terminal's OSC 7501 root record equal to `read()`. Samples on every
 * frame and keypress, writes only changed reports through the renderer's native
 * session, its one writer, and clears the record when the renderer is destroyed,
 * before the session closes. A keypress after a run ends marks it seen: done
 * and error fall back to idle.
 */
export function reportProgramStatus(
  renderer: CliRenderer,
  terminal: NativeSession,
  read: () => Activity,
): void {
  const encoder = new TextEncoder();
  let written: string | undefined;
  let live: RunId | undefined;

  const sync = (): void => {
    if (renderer.isDestroyed) return;
    const activity = read();

    if (activity.execution !== undefined && activity.execution.kind !== "idle")
      live = activity.execution.run.id;
    const sequence = encode(statusOf(activity, live));

    if (sequence === written) return;
    written = sequence;
    terminal.write(encoder.encode(sequence));
  };

  const onFrame = async (): Promise<void> => {
    sync();
  };

  const onKey = (): void => {
    live = undefined;
    sync();
  };

  renderer.setFrameCallback(onFrame);
  renderer.keyInput.on("keypress", onKey);
  renderer.once(CliRenderEvents.DESTROY, () => {
    renderer.removeFrameCallback(onFrame);
    renderer.keyInput.off("keypress", onKey);

    if (!terminal.disposed) terminal.write(encoder.encode(CLEARED));
  });
}
