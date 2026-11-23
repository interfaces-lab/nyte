import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { sidePanelWidth } from "../workbench/side-panel.tsx";

const EDITOR_MIN_WIDTH = 700;

/** Whether the editor's explorer shows, and the body it measures to decide. */
export interface ExplorerVisibility {
  readonly bodyRef: RefObject<HTMLDivElement | null>;
  readonly explorerShown: boolean;
  readonly showSidebar: () => void;
  readonly toggleSidebar: () => void;
}

/** Decides whether the explorer shows beside the editor, and opens it when the file store asks for a reveal. */
export function useExplorerVisibility({
  shown,
  revealRevision,
  sidebarVisible,
  explorerDocked,
  onToggleSidebar,
}: {
  readonly shown: boolean;
  readonly revealRevision: number;
  readonly sidebarVisible: boolean;
  readonly explorerDocked: boolean;
  readonly onToggleSidebar: () => void;
}): ExplorerVisibility {
  const bodyRef = useRef<HTMLDivElement>(null);
  const cramped = useCramped(bodyRef);
  const [choice, setChoice] = useState({ shown: false, revision: revealRevision });
  const insisted = choice.shown || choice.revision !== revealRevision;
  const explorerShown = sidebarVisible && (explorerDocked || !cramped || insisted);

  const showSidebar = (): void => {
    if (cramped) setChoice({ shown: true, revision: revealRevision });

    if (!sidebarVisible) onToggleSidebar();
  };

  const toggleSidebar = (): void => {
    if (!explorerShown) {
      showSidebar();

      return;
    }

    setChoice({ shown: false, revision: revealRevision });
    onToggleSidebar();
  };

  const revealed = useRef(0);
  // oxlint-disable-next-line nyte-code/no-direct-effect -- consumes an explicit Explorer reveal request from the file store
  useEffect(() => {
    if (!shown || revealRevision === revealed.current) return;
    revealed.current = revealRevision;

    if (!sidebarVisible) onToggleSidebar();
  }, [shown, revealRevision, sidebarVisible, onToggleSidebar]);

  return { bodyRef, explorerShown, showSidebar, toggleSidebar };
}

function useCramped(body: RefObject<HTMLElement | null>): boolean {
  const [cramped, setCramped] = useState(false);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- measures the editor body before paint and observes its width and the side panel's
  useLayoutEffect(() => {
    const node = body.current;

    if (node === null) return;

    const measure = (): void => {
      if (node.clientWidth > 0) {
        setCramped(node.clientWidth - sidePanelWidth.get() < EDITOR_MIN_WIDTH);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const leave = sidePanelWidth.subscribe(measure);

    return () => {
      observer.disconnect();
      leave();
    };
  }, [body]);

  return cramped;
}
