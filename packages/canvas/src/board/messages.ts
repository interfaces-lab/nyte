import { useRef } from "react";
import type { Command } from "./bridge.ts";
import { EVERY_FRAME, SELECTION } from "./camera.ts";
import type { BoardCamera } from "./camera.ts";
import type { Gestures } from "./gestures.ts";
import type { PageFrames } from "./page-frames.ts";

export function useCommands(input: {
  readonly camera: BoardCamera;
  readonly gestures: Gestures;
  readonly pages: PageFrames;
  readonly focus: () => void;
}): (message: Command) => void {
  const opening = useRef(true);
  const camera = input.camera;

  return (message) => {
    switch (message.kind) {
      case "camera":
        if (message.to === "actual") camera.actual();
        else camera.showAll(message.to === "fit" ? EVERY_FRAME : SELECTION, true, false);

        return;
      case "reveal":
        camera.showAll(`${EVERY_FRAME}[data-sheet="${CSS.escape(message.path)}"]`, true, false);

        return;
      case "applied":
      case "refused":
        input.gestures.answer(message);

        return;
      case "lights": {
        const always = opening.current;

        opening.current = false;

        if (message.follow === null) return;
        const selector = message.follow === "you" ? SELECTION : '[data-glow="on"]';

        requestAnimationFrame(() => requestAnimationFrame(() => camera.follow(selector, always)));

        return;
      }

      case "leave":
        input.pages.leave();
        input.focus();

        return;
      case "wheel":
        camera.wheel(message);

        return;
      case "enter":
        input.pages.enterLive(message.key);
    }
  };
}
