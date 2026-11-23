import { findLanguage, LANGUAGES } from "@nyte-ai/schema";
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
import { languageFor } from "../data/language.ts";
import { useWatchSelect } from "../data/watch-store.ts";
import { languageStatusWatch } from "../data/watches.ts";
import { trustWorkspace, useHomeWorkspace } from "../data/workspaces.ts";
import { formatBytes } from "../lib/format.ts";
import { servesFile } from "./declaration.ts";

const WAITING = ["untrusted", "available", "installing"] as const;

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

export function LanguageBar(input: {
  readonly path: string;
  readonly folder: { readonly id: WorkspaceId; readonly path: string } | undefined;
  readonly onTrusted: () => void;
}) {
  const name = findLanguage(input.path)?.name;
  const home = useHomeWorkspace();
  const folder = input.folder;

  const waiting = useWatchSelect(
    folder === undefined || name === undefined ? undefined : languageStatusWatch(folder.id),
    (state) =>
      WAITING.flatMap(
        (kind) =>
          state.value?.find(
            (view) =>
              view.state.kind === kind &&
              folder !== undefined &&
              servesFile(view, input.path, folder.path),
          ) ?? [],
      ).at(0),
  );

  const trust = useMutation({
    mutationFn: (workspace: WorkspaceId) => trustWorkspace(workspace),
    onSuccess: input.onTrusted,
    onError: (cause) =>
      toast.add({
        type: "error",
        title: "Couldn't trust this folder",
        description: errorMessage(cause),
      }),
  });

  const install = useMutation({
    mutationFn: async (server: { readonly server: string; readonly root: string }) => {
      if (folder !== undefined) await (await languageFor(folder.id)).install(server);
    },
    onError: (cause) =>
      toast.add({
        type: "error",
        title: "Couldn't start the download",
        description: errorMessage(cause),
      }),
  });

  if (waiting === undefined || folder === undefined || name === undefined) return null;
  const language = LANGUAGES[name].label;
  const state = waiting.state;

  if (state.kind === "installing") {
    return (
      <div role="status" {...props(text.sm, styles.bar, hairline.blockEnd)}>
        <span {...props(styles.message)}>
          Downloading {language} code intelligence
          {state.percent === null ? "." : `: ${String(Math.round(state.percent))}%`}
        </span>
      </div>
    );
  }

  if (state.kind === "available") {
    return (
      <div role="status" {...props(text.sm, styles.bar, hairline.blockEnd)}>
        <span {...props(styles.message)}>
          {language} code intelligence needs a{" "}
          {state.bytes === null ? "download." : `${formatBytes(state.bytes)} download.`}
        </span>
        <Button
          size="2xs"
          loading={install.isPending}
          onClick={() => install.mutate({ server: waiting.server, root: waiting.root })}
        >
          Download
        </Button>
      </div>
    );
  }

  if (folder.id === home) {
    return (
      <div role="status" {...props(text.sm, styles.bar, hairline.blockEnd)}>
        <span {...props(styles.message)}>
          Language servers don't run in your home folder. Open a project folder to turn on{" "}
          {language} code intelligence.
        </span>
      </div>
    );
  }

  return (
    <div role="status" {...props(text.sm, styles.bar, hairline.blockEnd)}>
      <span {...props(styles.message)}>
        Trust this folder to turn on {language} code intelligence. Its language servers run code
        from the folder.
      </span>
      <Button size="2xs" loading={trust.isPending} onClick={() => trust.mutate(folder.id)}>
        Trust Folder
      </Button>
    </div>
  );
}
