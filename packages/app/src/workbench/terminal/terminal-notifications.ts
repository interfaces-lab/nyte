export interface OscNotice {
  /** Undefined when the program gave none, as OSC 9 never does. */
  readonly title: string | undefined;
  readonly body: string;
}

const NOTIFY = "777;notify;";

/** The notification in an OSC body: OSC 9 (`9 ; message`) or OSC 777 (`777 ; notify ; title ; body`). */
export function readNotice(sequence: string): OscNotice | undefined {
  if (sequence.startsWith("9;")) {
    const body = sequence.slice(2).trim();

    return body === "" || /^\d+(;|$)/u.test(body) ? undefined : { title: undefined, body };
  }

  if (!sequence.startsWith(NOTIFY)) return undefined;
  const fields = sequence.slice(NOTIFY.length).split(";");
  const title = (fields[0] ?? "").trim();
  const body = fields.slice(1).join(";").trim();

  if (title === "" && body === "") return undefined;

  return { title: title === "" ? undefined : title, body };
}
