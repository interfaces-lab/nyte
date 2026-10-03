const HEADING = /^(?:\*\*(.+?)\*\*|#{1,6}\s+(.+))$/u;

function headingOf(line: string): string | undefined {
  const match = HEADING.exec(line);

  return (match?.[1] ?? match?.[2])?.trim();
}

/**
 * Reasoning summaries open with a bold heading. The last heading titles the
 * row; a lone heading leaves the body, and a heading with no body folds the
 * row to its title.
 */
export function reasoningHeading(text: string) {
  let title: string | undefined;
  let headings = 0;
  let hasBody = false;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    if (trimmed === "") continue;
    const heading = headingOf(trimmed);

    if (heading === undefined || heading === "") {
      hasBody = true;
      continue;
    }

    title = heading;
    headings += 1;
  }

  if (!hasBody) return { title, body: "" };

  if (headings !== 1) return { title, body: text };
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");

  return {
    title,
    body:
      headingOf(lines[first]?.trim() ?? "") === undefined
        ? text
        : lines
            .slice(first + 1)
            .join("\n")
            .trimStart(),
  };
}
