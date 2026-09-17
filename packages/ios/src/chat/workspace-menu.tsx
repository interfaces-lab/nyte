import { useEffect, useRef, useState } from "react";
import { Button, HStack, Host, Image, Menu, Text } from "@expo/ui/swift-ui";
import { buttonStyle, font, foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import type { NyteClient } from "@nyte-ai/client";
import type { WorkspaceSelectInput } from "@nyte-ai/protocol";
import { css, html } from "react-strict-dom";
import { describeHostError } from "../connection/connection.ts";
import { controls, spacing, textStyles, typography, useTheme } from "../theme.ts";
import {
  applyWorkspaceSelect,
  listedWorkspaces,
  sameSelectInput,
  selectionMatches,
  workspaceChipLabel,
  workspaceMenuAvailable,
  type WorkspaceMenu,
} from "./workspace-menu.ts";

/**
 * Home and recent folders for a new chat. Follow-ups have no picker: the
 * session already sits on a folder. Shares without workspace capability hide
 * this. There is no Open folder control on the phone.
 */
export function WorkspacePicker({
  client,
  onWorkspaceChange,
}: {
  client: NyteClient;
  onWorkspaceChange?: () => void;
}) {
  const theme = useTheme();
  const [menu, setMenu] = useState<WorkspaceMenu>({ kind: "hidden" });
  const [caption, setCaption] = useState<string>();
  const menuRef = useRef(menu);
  menuRef.current = menu;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const info = await client.info();
        if (!active) return;
        if (!workspaceMenuAvailable(info)) {
          menuRef.current = { kind: "hidden" };
          setMenu({ kind: "hidden" });
          setCaption(undefined);
          return;
        }
        menuRef.current = { kind: "loading" };
        setMenu({ kind: "loading" });
        const [selection, items] = await Promise.all([
          client.workspace.current(),
          client.workspace.list(),
        ]);
        if (!active) return;
        const next = { kind: "ready" as const, items: listedWorkspaces(items), selection };
        menuRef.current = next;
        setMenu(next);
      } catch (cause: unknown) {
        if (!active) return;
        const next = { kind: "failed" as const, message: describeHostError(cause) };
        menuRef.current = next;
        setMenu(next);
      }
    })();
    return () => {
      active = false;
    };
  }, [client]);

  const choose = (input: WorkspaceSelectInput) => {
    const current = menuRef.current;
    if (current.kind !== "ready" || current.switching !== undefined) return;
    if (selectionMatches(current.selection, input)) return;
    const next = { ...current, switching: input };
    menuRef.current = next;
    setCaption(undefined);
    setMenu(next);
    void client.workspace
      .select(input)
      .then((outcome) => {
        const latest = menuRef.current;
        if (latest.kind !== "ready" || latest.switching === undefined) return;
        if (!sameSelectInput(latest.switching, input)) return;
        const applied = applyWorkspaceSelect(latest, outcome);
        menuRef.current = applied.menu;
        setMenu(applied.menu);
        setCaption(applied.caption);
        if (outcome.kind === "opened") onWorkspaceChange?.();
      })
      .catch((cause: unknown) => {
        const latest = menuRef.current;
        if (latest.kind !== "ready" || latest.switching === undefined) return;
        if (!sameSelectInput(latest.switching, input)) return;
        const restored = {
          kind: "ready" as const,
          items: latest.items,
          selection: latest.selection,
        };
        menuRef.current = restored;
        setMenu(restored);
        setCaption(describeHostError(cause));
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
  if (menu.kind === "loading") {
    return (
      <Host matchContents={{ horizontal: true }} style={chipHost} ignoreSafeArea="all">
        <Text modifiers={[font(chipFont), foregroundStyle(theme.muted)]}>Workspace</Text>
      </Host>
    );
  }

  const selected = menu.selection;
  return (
    <html.div style={styles.row}>
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
          modifiers={[buttonStyle("plain")]}
        >
          <Button
            label="Home"
            systemImage={selected.kind === "home" ? "checkmark" : undefined}
            onPress={() => choose({ kind: "home" })}
          />
          {menu.items.map((item) => (
            <Button
              key={item.path}
              label={item.name}
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
      {caption === undefined ? null : (
        <html.p role="status" style={textStyles.caption}>
          {caption}
        </html.p>
      )}
    </html.div>
  );
}

const chipFont = { size: typography.caption.fontSize, weight: "medium" } as const;
const chipHost = { height: controls.metaTarget } as const;

const styles = css.create({
  row: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
});
