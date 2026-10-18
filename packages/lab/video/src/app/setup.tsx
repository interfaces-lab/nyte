import "../../../src/shell/host-stub";
import "@fontsource-variable/inter/opsz.css";
import "@nyte-ai/app/theme/global.css";
import "@nyte-ai/app/conversation/code.deferred.tsx";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import { queryClient } from "@nyte-ai/app/queries.ts";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { StylexSheet } from "./sheet";

applyDisplayMode("dark");

/**
 * The app's CSS animations (spinners, shimmers) run on the page clock, which a
 * render does not share. Pausing them and seeking with a negative delay ties
 * every one inside the film to its frame, and leaves a page around it alone.
 */
function AnimationClock() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;

  return (
    <style>{`[data-film-clock] *, [data-film-clock] *::before, [data-film-clock] *::after { animation-play-state: paused !important; animation-delay: -${seconds.toFixed(4)}s !important; }`}</style>
  );
}

/** Everything the app's components expect around them. */
export function App({ children }: { readonly children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <StylexSheet />
        <AnimationClock />
        <div data-film-clock="" style={{ display: "contents" }}>
          {children}
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
