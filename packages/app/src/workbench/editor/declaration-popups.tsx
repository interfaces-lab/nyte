import { CodeView } from "@nyte-ai/ui/diffs/react";
import type { CodeViewItem } from "@nyte-ai/ui/diffs/react";
import { create, props } from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { CodeAction } from "@nyte-ai/schema";
import type { LanguageApi, TextPosition } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Loader } from "@nyte-ai/ui/loader";
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem } from "@nyte-ai/ui/menu";
import { Popover } from "@nyte-ai/ui/popover";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { PIERRE_EDITOR_HIGHLIGHTER_OPTIONS } from "@nyte-ai/ui/worker-pool";
import type { SelectedWorkspace, ThemePreference } from "../../contract/bridge.ts";
import { ChatScope } from "../../chat/chat-scope.tsx";
import { Prose } from "../../chat/markdown/prose.tsx";
import { documentsApi } from "../../data/documents.ts";
import { CodeActionsMenu } from "./code-actions-menu.tsx";
import type { Landing } from "./declaration.ts";
import { RenameField } from "./rename-field.tsx";

export type DeclarationPopup =
  | {
      readonly kind: "choose";
      readonly anchor: DOMRect;
      readonly title: string;
      readonly landings: readonly Landing[];
    }
  | {
      readonly kind: "peek";
      readonly anchor: DOMRect;
      readonly name: string;
      readonly landings: readonly Landing[];
      readonly index: number;
    }
  | {
      readonly kind: "hint";
      readonly anchor: DOMRect;
      readonly message: string;
      readonly detail?: string;
      readonly busy: boolean;
    }
  | {
      readonly kind: "hover";
      readonly anchor: DOMRect;
      readonly markdown: string;
      readonly position: TextPosition;
      readonly pinned: boolean;
    }
  | {
      readonly kind: "rename";
      readonly anchor: DOMRect;
      readonly position: TextPosition;
      readonly name: string;
      readonly revision: number;
      readonly busy: boolean;
    }
  | {
      readonly kind: "actions";
      readonly anchor: DOMRect;
      readonly actions: readonly CodeAction[];
      readonly revision: number;
      readonly running: CodeAction | undefined;
    };

const PEEK_LINES = 18;

const styles = create({
  chooser: { maxWidth: "min(640px, var(--available-width))" },
  snippet: {
    fontFamily: type.fontMono,
    whiteSpace: "pre",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  hint: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    maxWidth: 360,
    paddingBlock: space.s1_5,
    paddingInline: space.s2_5,
  },
  hintText: { display: "flex", flexDirection: "column", minWidth: 0 },
  hintDetail: { color: role.contentSecondary, overflowWrap: "anywhere" },
  hover: {
    maxWidth: "min(560px, var(--available-width))",
    maxHeight: "min(320px, var(--available-height))",
    overflowY: "auto",
    paddingBlock: space.s2,
    paddingInline: space.s3,
  },
  peek: {
    display: "flex",
    flexDirection: "column",
    width: "min(640px, var(--available-width))",
    padding: 0,
    overflow: "hidden",
  },
  peekHeader: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    minWidth: 0,
    paddingBlock: space.s1,
    paddingInlineStart: space.s2_5,
    paddingInlineEnd: space.s1,
  },
  peekName: {
    flexShrink: 0,
    fontFamily: type.fontMono,
    color: role.contentPrimary,
  },
  peekWhere: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: role.contentTertiary,
    direction: "rtl",
    textAlign: "start",
  },
  peekCount: { flexShrink: 0, color: role.contentTertiary, fontVariantNumeric: "tabular-nums" },
  peekBody: (lines: number) => ({
    "--diffs-min-number-column-width": "initial",
    height: `calc(${type.leadingCode} * ${String(lines)} + ${space.s2} * 2)`,
    overflow: "auto",
    borderRadius: radius.control,
    marginInline: space.s1,
    marginBlockEnd: space.s1,
    backgroundColor: role.bgMutedTranslucent,
  }),
  peekLoading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: `calc(${type.leadingCode} * 4)`,
  },
});

export function DeclarationPopups({
  popup,
  api,
  root,
  theme,
  mac,
  onPick,
  onPeek,
  onClose,
  onHover,
  onRename,
  onAction,
  folder,
}: {
  readonly popup: DeclarationPopup | undefined;
  readonly api: LanguageApi | undefined;
  readonly root: string | undefined;
  readonly theme: ThemePreference;
  readonly mac: boolean;
  readonly onPick: (landing: Landing) => void;
  readonly onPeek: (index: number) => void;
  readonly onClose: () => void;
  readonly onHover: { readonly enter: () => void; readonly leave: () => void };
  readonly onRename: { readonly submit: (name: string) => void; readonly cancel: () => void };
  readonly onAction: { readonly pick: (action: CodeAction) => void; readonly close: () => void };
  readonly folder: SelectedWorkspace | undefined;
}): ReactElement | null {
  if (popup === undefined) return null;
  const anchor = { getBoundingClientRect: () => popup.anchor };

  switch (popup.kind) {
    case "choose":
      return (
        <Chooser
          title={popup.title}
          anchor={anchor}
          landings={popup.landings}
          root={root}
          onPick={onPick}
          onClose={onClose}
        />
      );
    case "peek":
      return (
        <Peek
          popup={popup}
          anchor={anchor}
          api={api}
          root={root}
          theme={theme}
          mac={mac}
          onPick={onPick}
          onPeek={onPeek}
          onClose={onClose}
        />
      );
    case "hint":
      return (
        <Popover.Root open modal={false} onOpenChange={(open) => !open && onClose()}>
          <Popover.Portal>
            <Popover.Positioner anchor={anchor} side="bottom" align="start" sideOffset={4}>
              <Popover.Popup
                initialFocus={false}
                role={popup.busy ? "status" : "alert"}
                xstyle={styles.hint}
              >
                {popup.busy && <Loader />}
                <span {...props(text.sm, styles.hintText)}>
                  <span>{popup.message}</span>
                  {popup.detail !== undefined && (
                    <span {...props(styles.hintDetail)}>{popup.detail}</span>
                  )}
                </span>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      );
    case "hover":
      return (
        <Popover.Root open modal={false} onOpenChange={(open) => !open && onClose()}>
          <Popover.Portal>
            <Popover.Positioner anchor={anchor} side="top" align="start" sideOffset={4}>
              <Popover.Popup
                initialFocus={false}
                aria-label="Documentation"
                xstyle={styles.hover}
                onPointerEnter={onHover.enter}
                onPointerLeave={onHover.leave}
              >
                <ChatScope folder={folder}>
                  <Prose markdown={popup.markdown} />
                </ChatScope>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      );
    case "rename":
      return (
        <RenameField
          anchor={anchor}
          name={popup.name}
          busy={popup.busy}
          onRename={onRename.submit}
          onCancel={onRename.cancel}
          onClose={onClose}
        />
      );
    case "actions":
      return (
        <CodeActionsMenu
          anchor={anchor}
          actions={popup.actions}
          running={popup.running}
          onPick={onAction.pick}
          onClose={onAction.close}
        />
      );
    default: {
      const exhaustive: never = popup;

      return exhaustive;
    }
  }
}

function Chooser({
  title,
  anchor,
  landings,
  root,
  onPick,
  onClose,
}: {
  readonly title: string;
  readonly anchor: { readonly getBoundingClientRect: () => DOMRect };
  readonly landings: readonly Landing[];
  readonly root: string | undefined;
  readonly onPick: (landing: Landing) => void;
  readonly onClose: () => void;
}): ReactElement {
  const lines = useLandingLines(landings);

  return (
    <Menu open onOpenChange={(open) => !open && onClose()}>
      <MenuContent anchor={anchor} align="start" sideOffset={4} xstyle={styles.chooser}>
        <MenuGroup>
          <MenuGroupLabel>{title}</MenuGroupLabel>
          {landings.map((landing) => {
            const snippet = lines.data?.get(landing.path)?.[landing.range.start.line]?.trim();
            const where = shortPath(landing.path, root);

            const shared =
              snippet === undefined ||
              landings.some(
                (other) =>
                  other !== landing &&
                  lines.data?.get(other.path)?.[other.range.start.line]?.trim() === snippet,
              );

            return (
              <MenuItem
                key={`${landing.path}:${String(landing.range.start.line)}:${String(landing.range.start.utf16Column)}`}
                layout="plain"
                meta={
                  shared
                    ? where.slice(0, Math.max(0, where.lastIndexOf("/")))
                    : `${where}:${String(landing.range.start.line + 1)}`
                }
                onClick={() => onPick(landing)}
              >
                <span {...props(styles.snippet)}>
                  {shared
                    ? `${fileName(landing.path)}:${String(landing.range.start.line + 1)}`
                    : snippet}
                </span>
              </MenuItem>
            );
          })}
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}

function Peek({
  popup,
  anchor,
  api,
  root,
  theme,
  mac,
  onPick,
  onPeek,
  onClose,
}: {
  readonly popup: Extract<DeclarationPopup, { readonly kind: "peek" }>;
  readonly anchor: { readonly getBoundingClientRect: () => DOMRect };
  readonly api: LanguageApi | undefined;
  readonly root: string | undefined;
  readonly theme: ThemePreference;
  readonly mac: boolean;
  readonly onPick: (landing: Landing) => void;
  readonly onPeek: (index: number) => void;
  readonly onClose: () => void;
}): ReactElement {
  const landing = popup.landings[popup.index] ?? popup.landings[0];
  const count = popup.landings.length;
  const lines = useLandingLines(popup.landings);

  const extent = useQuery({
    queryKey: ["declaration", "extent", landing?.path, landing?.range.start.line],
    queryFn: async () =>
      landing === undefined || api === undefined ? undefined : declarationExtent(api, landing),
    staleTime: Infinity,
  });

  const file = landing === undefined ? undefined : lines.data?.get(landing.path);
  const start = landing?.range.start.line ?? 0;
  const end = extent.data ?? start + PEEK_LINES - 1;
  const snippet = file?.slice(start, end + 1);

  const edit = (): void => {
    if (landing !== undefined) onPick(landing);
  };

  const step = (delta: 1 | -1): void => onPeek((popup.index + delta + count) % count);

  return (
    <Popover.Root open modal={false} onOpenChange={(open) => !open && onClose()}>
      <Popover.Portal>
        <Popover.Positioner anchor={anchor} side="bottom" align="start" sideOffset={4}>
          <Popover.Popup
            aria-label={`Definition of ${popup.name}`}
            xstyle={styles.peek}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "F4") {
                event.preventDefault();
                edit();
              }

              if (count > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
                event.preventDefault();
                step(event.key === "ArrowLeft" ? -1 : 1);
              }
            }}
          >
            <div {...props(text.sm, styles.peekHeader)}>
              <span {...props(styles.peekName)}>{popup.name}</span>
              <span {...props(styles.peekWhere)}>
                <bdi>
                  {landing === undefined
                    ? ""
                    : `${shortPath(landing.path, root)}:${String(landing.range.start.line + 1)}`}
                </bdi>
              </span>
              {count > 1 && (
                <>
                  <Button
                    size="2xs"
                    iconOnly
                    icon="arrow-left"
                    aria-label="Previous definition"
                    onClick={() => step(-1)}
                  />
                  <span {...props(styles.peekCount)}>
                    {popup.index + 1}/{count}
                  </span>
                  <Button
                    size="2xs"
                    iconOnly
                    icon="arrow-right"
                    aria-label="Next definition"
                    onClick={() => step(1)}
                  />
                </>
              )}
              <Button size="2xs" variant="plain" onClick={edit}>
                Edit Source <Kbd keys={[mac ? "↩" : "Enter"]} />
              </Button>
            </div>
            {snippet === undefined || landing === undefined ? (
              <div {...props(styles.peekLoading)}>
                <Loader />
              </div>
            ) : (
              <div {...props(styles.peekBody(Math.min(snippet.length, PEEK_LINES)))}>
                <CodeView
                  key={`${landing.path}:${String(start)}:${String(snippet.length)}`}
                  initialItems={peekItems(landing.path, snippet.join("\n"))}
                  options={{
                    ...PIERRE_EDITOR_HIGHLIGHTER_OPTIONS,
                    themeType: theme,
                    disableFileHeader: true,
                    disableLineNumbers: true,
                    overflow: "scroll",
                    unsafeCSS: ":host { color-scheme: inherit; --diffs-bg: transparent; }",
                  }}
                />
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function peekItems(path: string, contents: string): readonly CodeViewItem<undefined>[] {
  return [
    {
      id: `peek:${path}`,
      type: "file",
      file: { name: fileName(path), contents, cacheKey: `peek:${path}:${contents.length}` },
    },
  ];
}

async function declarationExtent(api: LanguageApi, landing: Landing): Promise<number> {
  const start = landing.range.start;
  const symbols = await api.symbols({ path: landing.path }).catch(() => []);

  const found = symbols.find(
    (symbol) =>
      symbol.selection.start.line === start.line &&
      symbol.selection.start.utf16Column <= start.utf16Column &&
      start.utf16Column <= symbol.selection.end.utf16Column,
  );

  const last = found?.range.end.line ?? start.line + PEEK_LINES - 1;
  const first = found?.range.start.line ?? start.line;

  return Math.min(last, Math.max(first, start.line) + PEEK_LINES * 3);
}

function useLandingLines(landings: readonly Landing[]) {
  const paths = [...new Set(landings.map((landing) => landing.path))];

  return useQuery({
    queryKey: ["declaration", "lines", ...paths],
    queryFn: async () => {
      const documents = await documentsApi();

      const read = await Promise.all(
        paths.map(async (path) => {
          const document = await documents.read(path, { as: "document" }).catch(() => undefined);

          return [path, document?.kind === "text" ? document.contents.split("\n") : []] as const;
        }),
      );

      return new Map(read);
    },
    staleTime: 5000,
  });
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function shortPath(path: string, root: string | undefined): string {
  if (root !== undefined && path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  const module = /\/pkg\/mod\/(.+)$/u.exec(path)?.[1];

  if (module !== undefined) return module;

  return /\/src\/(.+)$/u.exec(path)?.[1] ?? path;
}
