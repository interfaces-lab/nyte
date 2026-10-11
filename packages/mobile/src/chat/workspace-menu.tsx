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
import { AccessibilityInfo } from "react-native";
import { css, html } from "react-strict-dom";
import { controls, spacing, textStyles, useTheme } from "../theme.ts";
import { workspaceName, type WorkspaceMenu } from "./workspace-menu.ts";
import { useRegistryFolders, type RegistryFolders } from "./workspace-start.tsx";

/**
 * Where a new chat goes: the folders the host's owner registered, and the
 * choice stays on this phone. Follow-ups have no picker: the session already
 * sits on a folder. There is no Open folder control here.
 */
export function WorkspacePicker({
  busy = false,
  onWorkspaceChange,
  toolbar = false,
  onSettings,
}: {
  busy?: boolean;
  onWorkspaceChange?: () => void;
  toolbar?: boolean;
  onSettings?: () => void;
}) {
  const theme = useTheme();
  const registry = useRegistryFolders();

  const menu = registryMenu(registry, onWorkspaceChange);

  if (menu.kind === "loading" && !toolbar) return null;

  if (menu.kind === "failed" && !toolbar) {
    return (
      <html.p role="alert" style={textStyles.error}>
        {menu.message}
      </html.p>
    );
  }

  const selected = menu.kind === "ready" ? menu.label : undefined;

  return (
    <html.div style={styles.row}>
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
            disabled(busy),
            accessibilityLabel(toolbar ? "Workspaces and settings" : "Workspace"),
            accessibilityValue(selected ?? ""),
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
                  modifiers={[disabled(busy)]}
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
    </html.div>
  );
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
        label: folders.selected === undefined ? undefined : workspaceName(folders.selected),
        choices: folders.ready.map((row) => ({
          key: row.id,
          label: workspaceName(row),
          selected: row.id === folders.selected?.id,
          choose: () => {
            if (row.id === folders.selected?.id) return;
            folders.choose(row.id);
            AccessibilityInfo.announceForAccessibility(`Workspace ${workspaceName(row)}`);
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
