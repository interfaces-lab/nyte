import type { WorkspaceId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { toast } from "@nyte-ai/ui/toast";
import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { errorMessage } from "../contract/errors.ts";
import { useWatchSelect } from "../data/watch-store.ts";
import { languageStatusWatch } from "../data/watches.ts";
import { trustWorkspace, useHomeWorkspace } from "../data/workspaces.ts";
import { workspaceFile } from "../workbench/paths.ts";
import { languageFamily } from "./language-documents.ts";

const LANGUAGES = { go: "Go", typescript: "TypeScript and JavaScript" } as const;

const styles = create({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    flexShrink: 0,
    paddingBlock: space.s1,
    paddingInline: space.s2_5,
    color: role.contentSecondary,
  },
  message: { flex: 1, minWidth: 0, textWrap: "pretty" },
});

export function TrustBar(input: {
  readonly path: string;
  readonly folder: { readonly id: WorkspaceId; readonly path: string } | undefined;
  readonly onTrusted: () => void;
}) {
  const family = languageFamily(input.path);
  const home = useHomeWorkspace();

  const relative =
    input.folder === undefined
      ? undefined
      : workspaceFile(input.path, [input.folder.path])?.relative;

  const untrusted = useWatchSelect(
    input.folder === undefined || family === undefined
      ? undefined
      : languageStatusWatch(input.folder.id),
    (state) =>
      state.value
        ?.filter(
          (view) =>
            view.language === family &&
            relative !== undefined &&
            (view.root === "" || relative.startsWith(`${view.root}/`)),
        )
        .toSorted((left, right) => right.root.length - left.root.length)[0]?.state.kind ===
      "untrusted",
  );

  const trust = useMutation({
    mutationFn: trustWorkspace,
    onSuccess: input.onTrusted,
    onError: (cause) =>
      toast.add({
        type: "error",
        title: "Couldn't trust this folder",
        description: errorMessage(cause),
      }),
  });

  const folder = input.folder;

  if (!untrusted || folder === undefined || family === undefined) return null;
  const language = LANGUAGES[family];

  if (folder.id === home)
    return (
      <div role="status" {...props(text.sm, styles.bar, hairline.blockEnd)}>
        <span {...props(styles.message)}>
          Language servers don't run in your home folder. Open a project folder to turn on{" "}
          {language} code intelligence.
        </span>
      </div>
    );

  return (
    <div role="status" {...props(text.sm, styles.bar, hairline.blockEnd)}>
      <span {...props(styles.message)}>
        Trust this folder to turn on {language} code intelligence. Its language server runs code
        from the folder.
      </span>
      <Button size="2xs" loading={trust.isPending} onClick={() => trust.mutate(folder.id)}>
        Trust Folder
      </Button>
    </div>
  );
}
