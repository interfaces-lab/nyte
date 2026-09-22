/**
 * Shapes any client renders without knowing who produced them. A plugin
 * fills them, core carries them, and a terminal, a browser, or a phone draws
 * them. Nothing here is a call into a client: each is data on a ref or an
 * event, so a client that arrives later still sees it.
 */

/** One thing a participant can pick. */
export interface Choice {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

/**
 * A pick from a list, with an optional way to answer in the participant's
 * own words. Answered with a `SelectionReply`.
 */
export interface Selection {
  readonly title: string;
  readonly choices: readonly [Choice, ...Choice[]];
  /** Any number of choices may be picked. Absent, exactly one. */
  readonly multiple?: true;
  /** Placeholder for an answer of the participant's own. Absent, only choices are accepted. */
  readonly other?: string;
}

/**
 * What a client sends back for a `Selection`: the picked choice ids (one,
 * several under `multiple`, or none when only `other` was used) and the
 * participant's own words where the selection allowed them. Ids and text are
 * separate fields, so typed text that looks like an id is still text.
 */
export interface SelectionReply {
  readonly choices: readonly string[];
  readonly other?: string;
}

/** Whether a parsed reply obeys this selection's choice and own-answer rules. */
export function acceptsSelectionReply(selection: Selection, reply: SelectionReply): boolean {
  const selected = new Set(reply.choices);

  if (selected.size !== reply.choices.length) return false;

  if (reply.choices.some((id) => !selection.choices.some((choice) => choice.id === id))) {
    return false;
  }

  const other = reply.other?.trim();

  if (reply.other !== undefined && (selection.other === undefined || other === "")) return false;

  if (selection.multiple !== true) {
    return reply.choices.length + (other === undefined ? 0 : 1) === 1;
  }

  return reply.choices.length > 0 || other !== undefined;
}
