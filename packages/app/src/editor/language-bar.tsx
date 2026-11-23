import { findLanguage, LANGUAGES } from "@nyte-ai/schema";
import type { WorkspaceId } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { toast } from "@nyte-ai/ui/toast";
import { create, props } from "@stylexjs/stylex";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "../contract/errors.ts";
import { languageFor } from "../data/language.ts";
import { useWatchSelect } from "../data/watch-store.ts";
import { languageStatusWatch } from "../data/watches.ts";
import { trustWorkspace, useHomeWorkspace } from "../data/workspaces.ts";
import { formatBytes } from "../lib/format.ts";
import { folderPicker } from "../panes/open-workspace.tsx";
import { servesFile } from "./declaration.ts";

const WAITING = ["untrusted", "available", "installing"] as const;

type Notice = (typeof WAITING)[number] | "home";

const styles = create({
  card: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    flexShrink: 0,
    marginBlockStart: space.s1_5,
    marginInline: space.s2,
    paddingBlock: space.s1_5,
    paddingInlineStart: space.s2_5,
    paddingInlineEnd: space.s1_5,
    borderRadius: radius.control,
    backgroundColor: role.bgMuted,
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
  const [dismissed, setDismissed] = useState<Notice>();
  const openFolder = folderPicker();

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

  const notice: Notice =
    state.kind === "installing" || state.kind === "available"
      ? state.kind
      : folder.id === home
        ? "home"
        : "untrusted";

  if (notice === dismissed) return null;

  return (
    <div role="status" {...props(text.sm, styles.card, hairline.ring)}>
      <Icon name="circle-info" size="sm" />
      {state.kind === "installing" && (
        <span {...props(styles.message)}>
          Downloading {language} code intelligence
          {state.percent === null ? "." : `: ${String(Math.round(state.percent))}%`}
        </span>
      )}
      {state.kind === "available" && (
        <>
          <span {...props(styles.message)}>
            {language} code intelligence needs a{" "}
            {state.bytes === null ? "download." : `${formatBytes(state.bytes)} download.`}
          </span>
          <Button
            size="xs"
            variant="outline"
            loading={install.isPending}
            onClick={() => install.mutate({ server: waiting.server, root: waiting.root })}
          >
            Download
          </Button>
        </>
      )}
      {notice === "home" && (
        <>
          <span {...props(styles.message)}>
            {language} code intelligence is off in your home folder.
          </span>
          {openFolder !== undefined && (
            <Button size="xs" variant="outline" onClick={openFolder}>
              Open Folder…
            </Button>
          )}
        </>
      )}
      {notice === "untrusted" && (
        <>
          <span {...props(styles.message)}>
            Trust this folder to turn on {language} code intelligence. Its language servers run code
            from the folder.
          </span>
          <Button
            size="xs"
            variant="outline"
            loading={trust.isPending}
            onClick={() => trust.mutate(folder.id)}
          >
            Trust Folder
          </Button>
        </>
      )}
      <Button
        size="xs"
        iconOnly
        icon="close"
        aria-label="Dismiss"
        onClick={() => setDismissed(notice)}
      />
    </div>
  );
}
