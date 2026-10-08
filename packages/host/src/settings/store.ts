/**
 * The desktop's view of settings.json: a synchronous snapshot for main-process
 * readers, and writes that keep what they don't own. Hand edits and terminal UI
 * writes are picked up on the next `read()` or `set()`.
 */
import {
  readSettingsFile,
  readSettingsFileSync,
  settingsPath,
  updateSettingsFile,
} from "./file.ts";
import {
  applyHostSettingsPatch,
  decodeHostSettings,
  type HostSettings,
  type HostSettingsPatch,
} from "./schema.ts";

type Listener = (next: HostSettings, previous: HostSettings) => void;

function same(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length && left.every((item, index) => Object.is(item, right[index]))
    );

  return Object.is(left, right);
}

function changed(next: HostSettings, previous: HostSettings): boolean {
  const keys: readonly (keyof HostSettings)[] = Object.keys(next).filter(
    (key): key is keyof HostSettings => Object.hasOwn(previous, key),
  );

  return keys.some((key) => !same(next[key], previous[key]));
}

export class HostSettingsStore {
  readonly #path: string;
  readonly #listeners = new Set<Listener>();
  #current: HostSettings;

  constructor(path: string = settingsPath()) {
    this.#path = path;
    this.#current = decodeHostSettings(readSettingsFileSync(path));
  }

  /** An arrow, so it can be handed over as a getter. */
  readonly current = (): HostSettings => this.#current;

  /** Re-reads the file, so an edit by hand or by the terminal UI shows up. */
  async read(): Promise<HostSettings> {
    return this.#accept(decodeHostSettings(await readSettingsFile(this.#path)));
  }

  /** Changes the given keys and answers with every setting as it now stands. */
  async set(patch: HostSettingsPatch): Promise<HostSettings> {
    const file = await updateSettingsFile(this.#path, (current) =>
      applyHostSettingsPatch(current, patch),
    );

    return this.#accept(decodeHostSettings(file));
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  }

  #accept(next: HostSettings): HostSettings {
    const previous = this.#current;

    if (!changed(next, previous)) return previous;
    this.#current = next;

    for (const listener of this.#listeners) listener(next, previous);

    return next;
  }
}
