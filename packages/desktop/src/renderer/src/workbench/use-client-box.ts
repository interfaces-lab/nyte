import { useLayoutEffect, useState } from "react";

/** Container size only — not text. Pretext owns label and patch heights. */
export function useClientBox(): [(node: HTMLElement | null) => void, number, number] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (node === null) return;
    const sync = (): void => {
      setWidth(node.clientWidth);
      setHeight(node.clientHeight);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width, height];
}
