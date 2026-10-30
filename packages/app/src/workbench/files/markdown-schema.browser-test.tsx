import { Editor } from "@tiptap/core";
import { parseMarkdown } from "./markdown-parse.ts";
import { markdownExtensions } from "./markdown-schema.ts";
import { markdownOrigin, serializeMarkdown } from "./markdown-serialize.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function markdownEditor(source: string) {
  const parsed = parseMarkdown(source);
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({ element, extensions: markdownExtensions, content: parsed.content });
  const origin = markdownOrigin(editor.state.doc, parsed.layout);

  return { editor, save: () => serializeMarkdown(editor.state.doc, origin) };
}

/** Select All starts at the document itself, with no list item around it to split. */
function selectAllThenEnter(): void {
  const source = "- [ ] one\n- [x] two\n\nAfter.\n";
  const markdown = markdownEditor(source);
  markdown.editor.commands.selectAll();
  markdown.editor.commands.keyboardShortcut("Enter");
  check(
    markdown.save() === source,
    `Enter over Select All left ${JSON.stringify(markdown.save())}`,
  );
  markdown.editor.destroy();
}

export async function run(): Promise<string> {
  selectAllThenEnter();

  return "passed";
}
