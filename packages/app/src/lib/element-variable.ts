export interface ElementVariable {
  readonly set: (value: string) => void;
  /** A ref callback: the element carries the variable's current value while it is mounted. */
  readonly attach: (element: HTMLElement | null) => (() => void) | undefined;
}

/**
 * A CSS variable written onto each element that reads it instead of onto the root. Register it
 * with `inherits: false` in the global stylesheet: a write on the root restyles every element in
 * the window, which a drag that writes on each pointer move can't afford.
 */
export function elementVariable(name: `--${string}`, initial: string): ElementVariable {
  const readers = new Set<HTMLElement>();
  let value = initial;

  return {
    set(next) {
      value = next;

      for (const reader of readers) reader.style.setProperty(name, value);
    },
    attach(element) {
      if (element === null) return undefined;
      readers.add(element);
      element.style.setProperty(name, value);

      return () => {
        readers.delete(element);
      };
    },
  };
}
