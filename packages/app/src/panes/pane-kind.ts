export interface PaneKind<Fields> {
  readonly identity: (fields: Fields) => string | undefined;
  readonly replaceable: (fields: Fields) => boolean;
  readonly mount: "while-active" | "while-open";
  readonly restore: (stored: unknown) => Fields | undefined;
  readonly persist: (fields: Fields) => unknown;
}
