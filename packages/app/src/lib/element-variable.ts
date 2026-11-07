export interface ElementVariable {
  readonly set: (value: string) => void;
  readonly attach: (element: HTMLElement | null) => (() => void) | undefined;
}

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
