import type { UserContent } from "@nyte-ai/schema";

export function extractUserText(content: UserContent): string {
  if (typeof content === "string") return content;

  return content.flatMap((item) => (item.kind === "text" ? [item.text] : [])).join(" ");
}

export function byCodePoint(left: string, right: string): number {
  for (let index = 0; index < left.length && index < right.length;) {
    const point = left.codePointAt(index) ?? 0;
    const difference = point - (right.codePointAt(index) ?? 0);

    if (difference !== 0) return difference;
    index += point > 0xffff ? 2 : 1;
  }

  return left.length - right.length;
}
