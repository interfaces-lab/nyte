import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

function subscribeAttention(notice: () => void): () => void {
  window.addEventListener("focus", notice);
  window.addEventListener("blur", notice);
  document.addEventListener("visibilitychange", notice);

  return () => {
    window.removeEventListener("focus", notice);
    window.removeEventListener("blur", notice);
    document.removeEventListener("visibilitychange", notice);
  };
}

function readActive(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/** What `select` makes of whether the window is visible and focused, so what it shows is being looked at; a change that selects the same value doesn't render. */
export function useWindowActive<S>(select: (active: boolean) => S): S {
  return useSyncExternalStoreWithSelector(subscribeAttention, readActive, readActive, select);
}
