import { useRef, useState } from "react";
import { Button, HStack, Host, Image, Menu, Text } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  disabled,
  frame,
  font,
  foregroundStyle,
  accessibilityValue,
} from "@expo/ui/swift-ui/modifiers";
import type { NyteClient } from "@nyte-ai/client";
import type { WorkspaceInfo, WorkspaceSelectInput, WorkspaceSelection } from "@nyte-ai/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AccessibilityInfo } from "react-native";
import { css, html } from "react-strict-dom";
import { describeHostError } from "../connection/connection.ts";
import { controls, spacing, textStyles, typography, useTheme } from "../theme.ts";
import {
  listedWorkspaces,
  selectionMatches,
  workspaceChipLabel,
  workspaceMenuAvailable,
  workspaceSelectCaption,
  type WorkspaceMenu,
} from "./workspace-menu.ts";

/**
 * Home and recent folders for a new chat. Follow-ups have no picker: the
 * session already sits on a folder. Shares without workspace capability hide
 * this. There is no Open folder control on the phone.
 */
export function WorkspacePicker({
  client,
  onSelecting,
  onWorkspaceChange,
}: {
  client: NyteClient;
  /** Handed the in-flight select so a caller can wait out the host's retarget. */
  onSelecting?: (pending: Promise<void>) => void;
  onWorkspaceChange?: () => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();

  const menuQuery = useQuery({
    queryKey: ["workspace-picker"],
    queryFn: async (): Promise<{
      selection: WorkspaceSelection;
      items: readonly WorkspaceInfo[];
    } | null> => {
      const info = await client.info();

      if (!workspaceMenuAvailable(info)) return null;

      const [selection, items] = await Promise.all([
        client.workspace.current(),
        client.workspace.list(),
      ]);

      return { selection, items: listedWorkspaces(items) };
    },
  });

  const inFlight = useRef(false);
  const [switching, setSwitching] = useState(false);
  const [caption, setCaption] = useState<string>();

  const menu: WorkspaceMenu =
    menuQuery.isPending || menuQuery.data === null
      ? { kind: "hidden" }
      : menuQuery.isError
        ? { kind: "failed", message: describeHostError(menuQuery.error) }
        : {
            kind: "ready",
            items: menuQuery.data.items,
            selection: menuQuery.data.selection,
          };

  const choose = (input: WorkspaceSelectInput) => {
    const data = menuQuery.data;

    if (data == null || inFlight.current) return;

    if (selectionMatches(data.selection, input)) return;
    inFlight.current = true;
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
            (old: { selection: WorkspaceSelection; items: readonly WorkspaceInfo[] } | null) =>
              old == null ? old : { ...old, selection: outcome.selection },
          );
          onWorkspaceChange?.();
        } else {
          setCaption(workspaceSelectCaption(outcome));
        }
      })
      .catch((cause: unknown) => {
        setCaption(describeHostError(cause));
      })
      .finally(() => {
        inFlight.current = false;
        setSwitching(false);
      });
  };

  if (menu.kind === "hidden") return null;

  if (menu.kind === "failed") {
    return (
      <html.p role="alert" style={textStyles.error}>
        {menu.message}
      </html.p>
    );
  }

  const selected = menu.selection;

  return (
    <html.div style={styles.row} aria-busy={switching}>
      <Host matchContents={{ horizontal: true }} style={chipHost} ignoreSafeArea="all">
        <Menu
          label={
            <HStack spacing={4}>
              <Text modifiers={[font(chipFont), foregroundStyle(theme.muted)]}>
                {workspaceChipLabel(selected)}
              </Text>
              <Image
                systemName="chevron.down"
                size={10}
                modifiers={[foregroundStyle(theme.muted)]}
              />
            </HStack>
          }
          modifiers={[
            buttonStyle("plain"),
            frame({ minHeight: controls.touchTarget }),
            disabled(switching),
            accessibilityValue(switching ? "Switching workspace" : workspaceChipLabel(selected)),
          ]}
        >
          <Button
            label="Home"
            modifiers={[disabled(switching)]}
            systemImage={selected.kind === "home" ? "checkmark" : undefined}
            onPress={() => choose({ kind: "home" })}
          />
          {menu.items.map((item) => (
            <Button
              key={item.path}
              label={item.name}
              modifiers={[disabled(switching)]}
              systemImage={
                selected.kind === "project" && selected.workspace.path === item.path
                  ? "checkmark"
                  : undefined
              }
              onPress={() => choose({ kind: "project", path: item.path })}
            />
          ))}
        </Menu>
      </Host>
      {switching ? (
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

const chipFont = { size: typography.caption.fontSize, weight: "medium" } as const;

const chipHost = { height: controls.touchTarget } as const;

const styles = css.create({
  row: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
});
