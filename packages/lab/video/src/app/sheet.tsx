import { useLayoutEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";

/**
 * Loads the StyleX sheet the Remotion bundle emits and holds rendering until it
 * applies. A Vite page, like the lab's studio, already serves its own.
 */
export function StylexSheet() {
  const [handle] = useState(() => delayRender("Loading the StyleX sheet"));

  useLayoutEffect(() => {
    const existing = document.querySelector<HTMLLinkElement>("link[data-stylex], link[href='/virtual:stylex.css']");
    if (existing) {
      continueRender(handle);
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("stylex.css", document.baseURI).href;
    link.dataset.stylex = "";
    link.onload = () => continueRender(handle);
    link.onerror = () => continueRender(handle);
    document.head.append(link);
  }, [handle]);

  return null;
}
