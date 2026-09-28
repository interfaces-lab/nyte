/**
 * The user's side of a turn, after shadcn's Message aligned to the end: one
 * filled box across the measure holding the prompt's text and a row of tags
 * for what it carried. It knows nothing about scrolling.
 */
import {
  BoxRenderable,
  fg,
  ImageRenderable,
  pathToFiletype,
  RenderableEvents,
  StyledText,
} from "@opentui/core";
import type { Renderable, TextRenderable } from "@opentui/core";
import type { ImageContent, UserMessage } from "@nyte-ai/schema";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  extractFileAttachments,
  extractFileMentions,
  extractShellBlocks,
  PASTE_COLLAPSE_LINES,
  pasteLineCount,
} from "./composer.ts";
import type { ShellRun } from "./composer.ts";
import { SPACING } from "./constants.ts";
import { extractSkillInvocations } from "./slash.ts";
import { repaints, TranscriptCodeRenderable, TranscriptTextRenderable } from "./surface.ts";
import type { Transcript } from "./surface.ts";

interface PresentedFile {
  readonly path: string;
  readonly text?: string;
}

interface PresentedSkill {
  readonly name: string;
  readonly path: string;
}

interface UserPresentation {
  readonly text: string;
  readonly files: readonly PresentedFile[];
  readonly skills: readonly PresentedSkill[];
  readonly shells: readonly ShellRun[];
  readonly images: readonly ImageContent[];
}

function userPresentation(content: UserMessage["content"]): UserPresentation {
  let text = Array.isArray(content)
    ? content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
    : content;

  // Instructions the prompt pulled in are the skill, not the prompt; an
  // attached body is the file, not the prompt. Both fold back to their tag.
  const skills: PresentedSkill[] = [];

  for (const invocation of extractSkillInvocations(text)) {
    skills.push({ name: invocation.name, path: invocation.path });
    text = text.replace(invocation.source, "");
  }

  const files: PresentedFile[] = [];

  for (const attachment of extractFileAttachments(text)) {
    files.push({ path: attachment.path, text: attachment.text });
    text = text.replace(attachment.source, "");
  }

  for (const mention of extractFileMentions(text)) {
    files.push({ path: mention.path });
    text = text.replace(mention.source, "");
  }

  const shells: ShellRun[] = [];

  for (const block of extractShellBlocks(text)) {
    shells.push({ command: block.command, output: block.output, exitCode: block.exitCode });
    text = text.replace(block.source, "");
  }

  const images = Array.isArray(content)
    ? content.flatMap((part) => (part.type === "image" ? [part] : []))
    : [];

  if (images.length > 0) text = text.replace(/\[Image \d+\]/g, "");

  return {
    text: text
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .trim(),
    files,
    skills,
    shells,
    images,
  };
}

const PASTE_PREVIEW_LINES = 3;

/** A clickable tag that folds or opens what a user turn carried. */
function collapsedTag(
  transcript: Transcript,
  parent: BoxRenderable,
  options: {
    readonly label: () => string;
    readonly url?: string;
    readonly marginTop?: number;
    readonly onToggle: () => void;
  },
): TextRenderable {
  const { renderer, theme } = transcript;
  let hovered = false;

  const tag = new TranscriptTextRenderable(renderer, {
    id: transcript.nextId("tag"),
    content: "",
    fg: theme.pasteForeground,
    bg: theme.pasteBackground,
    wrapMode: "none",
    marginTop: options.marginTop ?? 0,
  });

  const paint = (): void => {
    tag.content = new StyledText([fg(theme.pasteForeground)(options.label())]);
    tag.bg = hovered ? theme.hover : theme.pasteBackground;
  };

  tag.onMouseOver = () => {
    hovered = true;
    paint();
  };

  tag.onMouseOut = () => {
    hovered = false;
    paint();
  };

  tag.onMouseUp = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const selected = renderer.getSelection()?.getSelectedText() ?? "";

    if (selected !== "") return;
    options.onToggle();
    paint();
  };

  repaints.set(tag, () => {
    tag.fg = theme.pasteForeground;
    paint();
  });
  paint();
  parent.add(tag);

  return tag;
}

function addUserText(transcript: Transcript, block: BoxRenderable, text: string): void {
  const lines = text.split("\n");
  const folded = lines.length > PASTE_COLLAPSE_LINES;
  const preview = lines.slice(0, PASTE_PREVIEW_LINES).join("\n");
  let expanded = transcript.disclosures?.get(`user:${text}`) ?? false;

  const body = new TranscriptTextRenderable(transcript.renderer, {
    id: transcript.nextId("user-text"),
    content: folded && !expanded ? preview : text,
    fg: transcript.theme.foreground,
    wrapMode: "word",
    selectionBg: transcript.theme.selectionBackground,
    selectionFg: transcript.theme.selectionForeground,
  });

  repaints.set(body, () => {
    body.fg = transcript.theme.foreground;
    body.selectionBg = transcript.theme.selectionBackground;
    body.selectionFg = transcript.theme.selectionForeground;
  });
  block.add(body);

  if (!folded) return;
  const hidden = lines.length - PASTE_PREVIEW_LINES;
  collapsedTag(transcript, block, {
    marginTop: 1,
    label: () => (expanded ? " fewer lines " : ` +${String(hidden)} lines `),
    onToggle: () => {
      expanded = !expanded;
      transcript.disclosures?.set(`user:${text}`, expanded);
      body.content = expanded ? text : preview;
    },
  });
}

function addFileTag(
  transcript: Transcript,
  block: BoxRenderable,
  tags: BoxRenderable,
  file: PresentedFile,
): void {
  const { path, text } = file;

  if (text === undefined) {
    collapsedTag(transcript, tags, {
      url: pathToFileURL(path).href,
      label: () => ` File ${basename(path)} `,
      onToggle: () => transcript.openPath(path),
    });

    return;
  }

  let open = transcript.disclosures?.get(`file:${path}`) ?? false;

  const body = new TranscriptCodeRenderable(transcript.renderer, {
    id: transcript.nextId("file-body"),
    content: text,
    filetype: pathToFiletype(path) ?? undefined,
    syntaxStyle: transcript.syntaxStyle,
    fg: transcript.theme.foreground,
    visible: open,
    marginTop: 1,
    selectionBg: transcript.theme.selectionBackground,
    selectionFg: transcript.theme.selectionForeground,
  });

  repaints.set(body, () => {
    body.syntaxStyle = transcript.syntaxStyle;
    body.fg = transcript.theme.foreground;
    body.selectionBg = transcript.theme.selectionBackground;
    body.selectionFg = transcript.theme.selectionForeground;
  });
  collapsedTag(transcript, tags, {
    url: pathToFileURL(path).href,
    label: () => ` File ${basename(path)}${open ? "" : ` +${String(pasteLineCount(text))} lines`} `,
    onToggle: () => {
      open = !open;
      transcript.disclosures?.set(`file:${path}`, open);
      body.visible = open;
    },
  });
  block.add(body);
}

/** A `!command` the prompt carried: its output folds behind the command, like an attached file. */
function addShellTag(
  transcript: Transcript,
  block: BoxRenderable,
  tags: BoxRenderable,
  run: ShellRun,
): void {
  const key = `shell:${run.command}:${run.output}`;
  let open = transcript.disclosures?.get(key) ?? false;

  const body = new TranscriptCodeRenderable(transcript.renderer, {
    id: transcript.nextId("shell-body"),
    content: run.output,
    syntaxStyle: transcript.syntaxStyle,
    fg: transcript.theme.foreground,
    visible: open,
    marginTop: 1,
    selectionBg: transcript.theme.selectionBackground,
    selectionFg: transcript.theme.selectionForeground,
  });

  repaints.set(body, () => {
    body.syntaxStyle = transcript.syntaxStyle;
    body.fg = transcript.theme.foreground;
    body.selectionBg = transcript.theme.selectionBackground;
    body.selectionFg = transcript.theme.selectionForeground;
  });
  collapsedTag(transcript, tags, {
    label: () =>
      ` Shell ${run.command}${run.exitCode === 0 ? "" : ` exit ${String(run.exitCode)}`}${open ? "" : ` +${String(pasteLineCount(run.output))} lines`} `,
    onToggle: () => {
      open = !open;
      transcript.disclosures?.set(key, open);
      body.visible = open;
    },
  });
  block.add(body);
}

/** The request block of a turn; a pending message draws the same block ahead of its turn. */
export function appendMessage(
  transcript: Transcript,
  props: { readonly align: "end"; readonly content: UserMessage["content"] },
  parent: Renderable,
  before?: Renderable,
): BoxRenderable {
  const presentation = userPresentation(props.content);

  const block = new BoxRenderable(transcript.renderer, {
    id: transcript.nextId("user"),
    flexDirection: "column",
    backgroundColor: transcript.theme.userBackground,
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 3,
    paddingRight: SPACING.insetRight,
    marginTop: 0,
    marginLeft: 1,
    marginRight: 1,
    width: transcript.userBlockWidth(),
  });

  if (before === undefined) parent.add(block);
  else parent.insertBefore(block, before);

  repaints.set(block, () => {
    block.backgroundColor = transcript.theme.userBackground;
  });
  transcript.userBlocks.add(block);
  block.once(RenderableEvents.DESTROYED, () => transcript.userBlocks.delete(block));

  if (presentation.text !== "") addUserText(transcript, block, presentation.text);

  const tags = new BoxRenderable(transcript.renderer, {
    id: transcript.nextId("user-attachments"),
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 1,
    visible:
      presentation.files.length +
        presentation.skills.length +
        presentation.shells.length +
        presentation.images.length >
      0,
    marginTop: presentation.text === "" ? 0 : 1,
  });

  block.add(tags);

  for (const skill of presentation.skills) {
    collapsedTag(transcript, tags, {
      url: pathToFileURL(skill.path).href,
      label: () => ` Skill ${skill.name} `,
      onToggle: () => transcript.openPath(skill.path),
    });
  }

  for (const file of presentation.files) addFileTag(transcript, block, tags, file);

  for (const run of presentation.shells) addShellTag(transcript, block, tags, run);

  for (const [index, image] of presentation.images.entries()) {
    const preview = new ImageRenderable(transcript.renderer, {
      id: transcript.nextId("user-image"),
      source: Buffer.from(image.data, "base64"),
      width: "100%",
      height: 12,
      fit: "fit",
      visible: transcript.disclosures?.get(`image:${String(index)}`) ?? false,
    });

    collapsedTag(transcript, tags, {
      label: () => ` Image ${String(index + 1)} (${image.mimeType}) `,
      onToggle: () => {
        preview.visible = !preview.visible;
        transcript.disclosures?.set(`image:${String(index)}`, preview.visible);
      },
    });
    block.add(preview);
  }

  return block;
}
