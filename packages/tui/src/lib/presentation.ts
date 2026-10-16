import type { UserContent } from "@nyte-ai/sdk";

export interface PresentedFile {
  readonly path: string;
}

export interface PresentedSkill {
  readonly name: string;
  readonly path: string;
}

export interface PresentedShell {
  readonly command: string;
  readonly output: string;
  readonly exitCode: number;
}

export type AttachedFile = Extract<Exclude<UserContent, string>[number], { readonly kind: "file" }>;

export interface UserPresentation {
  readonly text: string;
  readonly files: readonly PresentedFile[];
  readonly skills: readonly PresentedSkill[];
  readonly shells: readonly PresentedShell[];
  readonly images: readonly AttachedFile[];
}

const SHELL_BLOCK_PATTERN = /<shell command="([^"\n]*)" exit="(\d+)">\n([\s\S]*?)\n<\/shell>/gu;

function commandFromAttribute(command: string): string {
  return command
    .replaceAll("&#10;", "\n")
    .replaceAll("&#13;", "\r")
    .replaceAll("&lt;", "<")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

export function userPresentation(content: UserContent): UserPresentation {
  const parts = typeof content === "string" ? [{ kind: "text" as const, text: content }] : content;

  let text = parts.flatMap((part) => (part.kind === "text" ? [part.text] : [])).join("");

  const skills = parts.flatMap((part): readonly PresentedSkill[] =>
    part.kind === "skill" ? [{ name: part.name, path: part.location }] : [],
  );

  const files = parts.flatMap((part): readonly PresentedFile[] =>
    part.kind === "reference" ? [{ path: part.path }] : [],
  );

  const shells: PresentedShell[] = [];

  for (const match of text.matchAll(SHELL_BLOCK_PATTERN)) {
    const [source, command, exit, output] = match;

    if (command === undefined || exit === undefined || output === undefined) continue;
    shells.push({
      command: commandFromAttribute(command),
      output: output === "" ? "" : `${output}\n`,
      exitCode: Number(exit),
    });
    text = text.replace(source, "");
  }

  const images = parts.flatMap((part) =>
    part.kind === "file" && part.mime.startsWith("image/") ? [part] : [],
  );

  if (images.length > 0) text = text.replace(/\[Image \d+\]/gu, "");

  return {
    text: text
      .replace(/[ \t]{2,}/gu, " ")
      .replace(/\n[ \t]+/gu, "\n")
      .trim(),
    files,
    skills,
    shells,
    images,
  };
}
