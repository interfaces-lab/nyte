export interface PaneKind<Fields> {
  readonly identity: (fields: Fields) => string | undefined;
  readonly restore: (stored: unknown) => Fields | undefined;
  readonly persist: (fields: Fields) => unknown;
}
