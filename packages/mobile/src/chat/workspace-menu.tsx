import { useState } from "react";
import { Button, Divider, HStack, Host, Image, Menu, Text } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  disabled,
  frame,
  font,
  foregroundStyle,
  accessibilityValue,
  accessibilityLabel,
} from "@expo/ui/swift-ui/modifiers";
import type { NyteClient } from "@nyte-ai/client";
import type { WorkspaceInfo, WorkspaceSelectInput, WorkspaceSelection } from "@nyte-ai/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AccessibilityInfo } from "react-native";
import { css, html } from "react-strict-dom";
import { describeHostError } from "../connection/connection.ts";
import { useHost } from "../connection/host-context.tsx";
import { controls, spacing, textStyles, useTheme } from "../theme.ts";
import { toast } from "../ui/toast.tsx";
import {
  listedWorkspaces,
  selectionMatches,
  usesWorkspaceCursor,
  workspaceChipLabel,
  workspaceSelectCaption,
  type WorkspaceMenu,
} from "./workspace-menu.ts";
import { useRegistryFolders, type RegistryFolders } from "./workspace-start.tsx";

/**
 * Where a new chat goes. A cursor host offers Home and its recent folders and
 * moves its shared cursor; a registry host offers the folders its owner made
 * ready, and the choice stays on this phone. Follow-ups have no picker: the
 * session already sits on a folder. There is no Open folder control here.
 */
export function WorkspacePicker({
  client,
  busy = false,
  onSelecting,
  onWorkspaceChange,
  toolbar = false,
  onSettings,
}: {
  client: NyteClient;
  busy?: boolean;
  /** Handed the in-flight select so a caller can wait out the host's retarget. */
  onSelecting?: (pending: Promise<void>) => void;
  onWorkspaceChange?: () => void;
  toolbar?: boolean;
  onSettings?: () => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { info } = useHost();
  const cursor = usesWorkspaceCursor(info);
  const registry = useRegistryFolders();

  const menuQuery = useQuery({
    queryKey: ["workspace-picker"],
    enabled: cursor,
    queryFn: async (): Promise<{
      selection: WorkspaceSelection;
      items: readonly WorkspaceInfo[];
    }> => {
      const [selection, items] = await Promise.all([
        client.workspace.current(),
        client.workspace.list(),
      ]);

      return { selection, items: listedWorkspaces(items) };
    },
  });

  const [switching, setSwitching] = useState(false);
  const [caption, setCaption] = useState<string>();

  const choose = (input: WorkspaceSelectInput) => {
    const data = menuQuery.data;

    if (data === undefined || switching || busy) return;

    if (selectionMatches(data.selection, input)) return;
    setSwitching(true);
    AccessibilityInfo.announceForAccessibility("Switching workspace");
    setCaption(undefined);
    const flight = client.workspace.select(input);
    onSelecting?.(flight.then(() => undefined));
    void flight
      .then((outcome) => {
        if (outcome.kind === "opened") {
          queryClient.setQueryData(
            ["workspace-picker"],
            (
              old: { selection: WorkspaceSelection; items: readonly WorkspaceInfo[] } | undefined,
            ) => (old === undefined ? old : { ...old, selection: outcome.selection }),
          );
          onWorkspaceChange?.();
        } else {
          const message = workspaceSelectCaption(outcome);

          if (toolbar) toast.show("Workspace unchanged", message);
          else setCaption(message);
        }
      })
      .catch((cause: unknown) => {
        const message = describeHostError(cause);

        if (toolbar) toast.show("Couldn't change workspace", message);
        else setCaption(message);
      })
      .finally(() => {
        setSwitching(false);
      });
  };

  const menu: WorkspaceMenu =
    registry !== undefined
      ? registryMenu(registry, onWorkspaceChange)
      : !cursor
        ? { kind: "hidden" }
        : menuQuery.isPending
          ? { kind: "loading" }
          : menuQuery.isError
            ? {
                kind: "failed",
                message: describeHostError(menuQuery.error),
                retry: () => void menuQuery.refetch(),
              }
            : cursorMenu(menuQuery.data, choose);

  if ((menu.kind === "hidden" || menu.kind === "loading") && !toolbar) return null;

  if (menu.kind === "failed" && !toolbar) {
    return (
      <html.p role="alert" style={textStyles.error}>
        {menu.message}
      </html.p>
    );
  }

  const selected = menu.kind === "ready" ? menu.label : undefined;

  return (
    <html.div style={styles.row} aria-busy={switching}>
      <Host
        matchContents={toolbar ? false : { horizontal: true }}
        style={toolbar ? toolbarHost : chipHost}
        ignoreSafeArea="all"
      >
        <Menu
          label={
            toolbar ? (
              <Image
                systemName="folder"
                size={22}
                modifiers={[foregroundStyle(theme.foreground)]}
              />
            ) : (
              <HStack spacing={4}>
                <Text
                  modifiers={[
                    font({ textStyle: "footnote", weight: "medium" }),
                    foregroundStyle(theme.muted),
                  ]}
                >
                  {selected ?? "Workspaces"}
                </Text>
                <Image
                  systemName="chevron.down"
                  size={10}
                  modifiers={[foregroundStyle(theme.muted)]}
                />
              </HStack>
            )
          }
          modifiers={[
            buttonStyle("plain"),
            frame({ minHeight: controls.touchTarget }),
            disabled(switching || busy),
            accessibilityLabel(toolbar ? "Workspaces and settings" : "Workspace"),
            accessibilityValue(switching ? "Switching workspace" : (selected ?? "")),
          ]}
        >
          {menu.kind === "ready" ? (
            menu.choices.length === 0 ? (
              <Button label="No folders available" modifiers={[disabled(true)]} />
            ) : (
              menu.choices.map((choice) => (
                <Button
                  key={choice.key}
                  label={choice.label}
                  modifiers={[disabled(switching || busy)]}
                  systemImage={choice.selected ? "checkmark" : undefined}
                  onPress={choice.choose}
                />
              ))
            )
          ) : menu.kind === "failed" ? (
            <Button label="Retry workspaces" systemImage="arrow.clockwise" onPress={menu.retry} />
          ) : menu.kind === "loading" ? (
            <Button label="Loading workspaces…" modifiers={[disabled(true)]} />
          ) : null}
          {onSettings === undefined ? null : (
            <>
              <Divider />
              <Button label="Settings" systemImage="gearshape" onPress={onSettings} />
            </>
          )}
        </Menu>
      </Host>
      {toolbar ? null : switching ? (
        <html.p role="status" style={textStyles.caption}>
          Switching workspace…
        </html.p>
      ) : caption === undefined ? null : (
        <html.p role="status" style={textStyles.caption}>
          {caption}
        </html.p>
      )}
    </html.div>
  );
}

function cursorMenu(
  data: { selection: WorkspaceSelection; items: readonly WorkspaceInfo[] },
  choose: (input: WorkspaceSelectInput) => void,
): WorkspaceMenu {
  const { selection, items } = data;

  return {
    kind: "ready",
    label: workspaceChipLabel(selection),
    choices: [
      {
        key: "home",
        label: "Home",
        selected: selection.kind === "home",
        choose: () => choose({ kind: "home" }),
      },
      ...items.map((item) => ({
        key: item.path,
        label: item.name,
        selected: selection.kind === "project" && selection.workspace.path === item.path,
        choose: () => choose({ kind: "project", path: item.path }),
      })),
    ],
  };
}

function registryMenu(folders: RegistryFolders, onChange: (() => void) | undefined): WorkspaceMenu {
  switch (folders.kind) {
    case "loading":
      return { kind: "loading" };
    case "failed":
      return { kind: "failed", message: folders.message, retry: folders.refresh };
    case "ready":
      return {
        kind: "ready",
        label: folders.selected?.name,
        choices: folders.ready.map((row) => ({
          key: row.id,
          label: row.name,
          selected: row.id === folders.selected?.id,
          choose: () => {
            if (row.id === folders.selected?.id) return;
            folders.choose(row.id);
            AccessibilityInfo.announceForAccessibility(`Workspace ${row.name}`);
            onChange?.();
          },
        })),
      };
    default: {
      const exhaustive: never = folders;

      return exhaustive;
    }
  }
}

const chipHost = { height: controls.touchTarget } as const;

const toolbarHost = { width: controls.touchTarget, height: controls.touchTarget } as const;

const styles = css.create({
  row: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
});
