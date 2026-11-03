import type { ServerHost } from "@nyte-ai/core/server";

export type Listeners = {
  addresses(): readonly string[];
  add(address: string): () => void;
  observe(listener: () => void): () => void;
};

const shared = new WeakMap<ServerHost, Listeners>();

export function sharedListeners(server: ServerHost): Listeners {
  const known = shared.get(server);

  if (known !== undefined) return known;
  const addresses = new Set<string>();
  const observers = new Set<() => void>();

  const changed = (): void => {
    for (const observer of observers) observer();
  };

  const created: Listeners = {
    addresses: () => [...addresses],
    add(address) {
      addresses.add(address);
      changed();

      return () => {
        if (addresses.delete(address)) changed();
      };
    },
    observe(listener) {
      observers.add(listener);

      return () => {
        observers.delete(listener);
      };
    },
  };

  shared.set(server, created);

  return created;
}
