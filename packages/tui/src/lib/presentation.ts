import { fileURLToPath } from "node:url";
import type { UserContent } from "@nyte-ai/sdk";
import { extractSkillInvocations } from "./slash.ts";

export interface PresentedFile {
  readonly path: string;
  readonly text?: string;
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

const FILE_ATTACHMENT_PATTERN = /<file src="(file:\/\/[^"\n]+)">\n([\s\S]*?)\n<\/file>/gu;

const SHELL_BLOCK_PATTERN = /<shell command="([^"\n]*)" exit="(\d+)">\n([\s\S]*?)\n<\/shell>/gu;

const FILE_MENTION_PATTERN = /@file:\/\/\S+/gu;

function pathOf(url: string): string | undefined {
  try {
    return fileURLToPath(url);
  } catch {
    return undefined;
  }
}

function commandFromAttribute(command: string): string {
  return command
    .replaceAll("&#10;", "\n")
    .replaceAll("&#13;", "\r")
    .replaceAll("&lt;", "<")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

export function userPresentation(content: UserContent): UserPresentation {
  let text =
    typeof content === "string"
      ? content
      : content.flatMap((part) => (part.kind === "text" ? [part.text] : [])).join("");

  const skills: PresentedSkill[] = [];

  for (const invocation of extractSkillInvocations(text)) {
    skills.push({ name: invocation.name, path: invocation.path });
    text = text.replace(invocation.source, "");
  }

  const files: PresentedFile[] = [];

  for (const match of text.matchAll(FILE_ATTACHMENT_PATTERN)) {
    const [source, url, body] = match;
    const path = url === undefined ? undefined : pathOf(url);

    if (path === undefined || body === undefined) continue;
    files.push({ path, text: body });
    text = text.replace(source, "");
  }

  for (const match of text.matchAll(FILE_MENTION_PATTERN)) {
    const path = pathOf(match[0].slice(1));

    if (path === undefined) continue;
    files.push({ path });
    text = text.replace(match[0], "");
  }

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

  const images =
    typeof content === "string"
      ? []
      : content.flatMap((part) =>
          part.kind === "file" && part.mime.startsWith("image/") ? [part] : [],
        );

  if (typeof content !== "string")
    for (const part of content) if (part.kind === "reference") files.push({ path: part.path });

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
