/** What the layout and the window's storage ask of one kind of pane tab. Its view lives in the view table. */
export interface PaneKind<Fields> {
  /** Opening fields whose identity matches an open tab shows that tab instead. */
  readonly identity: (fields: Fields) => string | undefined;
  /** A replaceable tab gives way to the next tab of its kind opened in its pane. */
  readonly replaceable: (fields: Fields) => boolean;
  readonly mount: "while-active" | "while-open";
  /** This kind's boundary parse of what `persist` wrote. */
  readonly restore: (stored: unknown) => Fields | undefined;
  /** `undefined` leaves the tab out of storage. */
  readonly persist: (fields: Fields) => unknown;
}
