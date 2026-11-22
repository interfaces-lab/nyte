import { measureNaturalWidth, prepare } from "@chenglou/pretext";
import { FileTree, useFileTree } from "@nyte-ai/ui/trees/react";
import { create, props } from "@stylexjs/stylex";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Popover } from "@nyte-ai/ui/popover";
import { menu } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { MentionFile } from "../data/files.ts";
import { PIERRE_TREE_CSS } from "@nyte-ai/ui/worker-pool";
import { syncTreePaths } from "./tree-paths.ts";
import { treeItemHeight } from "./tree-theme.ts";
import { workbenchStyles } from "../workbench/workbench.stylex.ts";

const SEPARATOR_WIDTH = 10;

const HIDDEN_LABEL = "…";

const styles = create({
  path: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    overflow: "clip",
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    whiteSpace: "nowrap",
  },
  cramped: { visibility: "hidden" },
  crumb: { minWidth: 0 },
  label: { overflow: "hidden", textOverflow: "ellipsis" },
  separator: { display: "inline-flex", flexShrink: 0, color: role.contentQuaternary },
  menu: { maxWidth: "min(320px, var(--available-width))" },
  popup: { width: "min(320px, var(--available-width))", padding: 0 },
  tree: {
    display: "block",
    boxSizing: "border-box",
    height: "min(320px, var(--available-height))",
    width: "100%",
    paddingBlock: menu.padding,
    "--trees-bg-override": "transparent",
    "--trees-border-radius-override": menu.itemRadius,
    "--trees-item-margin-x-override": "0px",
    "--trees-item-padding-x-override": menu.itemPaddingInline,
    "--trees-padding-inline-override": menu.padding,
  },
});

/**
 * The folders of the open file, without its name, which its tab shows. Leading folders fold into a `…` menu to fit the
 * row, and the path hides when the file sits at the root or not even its nearest folder fits.
 */
export function FileBreadcrumbs({
  path,
  external,
  files,
  onOpen,
}: {
  readonly path: string | undefined;
  readonly external: boolean;
  readonly files: readonly MentionFile[] | undefined;
  readonly onOpen: (file: MentionFile) => void;
}): ReactElement {
  const nav = useRef<HTMLElement>(null);
  const folders = path === undefined || external ? [] : path.split("/").slice(0, -1);
  const hidden = useHiddenFolders(nav, folders.join("/"));
  const folded = folders.slice(0, Math.min(hidden, folders.length - 1));

  return (
    <nav
      ref={nav}
      aria-label="File path"
      {...props(styles.path, folders.length > 0 && hidden >= folders.length && styles.cramped)}
    >
      {external && path !== undefined && (
        <span title={path} {...props(styles.label)}>
          {path.replace(/[\\/][^\\/]*$/u, "")}
        </span>
      )}
      {folded.length > 0 && (
        <HiddenFolders
          directories={folded.map((_, index) => folders.slice(0, index + 1).join("/"))}
          files={files}
          onOpen={onOpen}
        />
      )}
      {folders.map((folder, index) => {
        if (index < folded.length) return null;
        const directory = folders.slice(0, index + 1).join("/");

        return (
          <Fragment key={directory}>
            {index > 0 && (
              <span aria-hidden="true" {...props(styles.separator)}>
                <Icon name="chevron-right" size="2xs" />
              </span>
            )}
            <FileCrumb label={folder} directory={directory} files={files} onOpen={onOpen} />
          </Fragment>
        );
      })}
    </nav>
  );
}

function useHiddenFolders(nav: RefObject<HTMLElement | null>, path: string): number {
  const [hidden, setHidden] = useState(0);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- measures the path before paint and observes the bar's width
  useLayoutEffect(() => {
    const node = nav.current;

    if (node === null || path === "") return;
    const folders = path.split("/");
    const measurements = new Map<string, { readonly labels: number[]; readonly more: number }>();

    const measure = (): void => {
      const crumb = node.querySelector("button");

      if (crumb === null) return;
      const style = getComputedStyle(crumb);
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);

      const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;

      const width = (label: string) =>
        Math.ceil(measureNaturalWidth(prepare(label, font, { letterSpacing })));

      const measured = measurements.get(font) ?? {
        labels: folders.map(width),
        more: width(HIDDEN_LABEL),
      };

      measurements.set(font, measured);

      setHidden(
        foldFolders(
          measured.labels.map((label) => label + padding),
          measured.more + padding,
          node.clientWidth,
        ),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);

    return () => observer.disconnect();
  }, [nav, path]);

  return hidden;
}

function foldFolders(folders: readonly number[], more: number, available: number): number {
  const kept =
    folders
      .map((_, index) => folders.length - index)
      .find((count) => {
        const fold = count < folders.length ? more + SEPARATOR_WIDTH : 0;

        return (
          folders
            .slice(folders.length - count)
            .reduce((sum, width) => sum + width + SEPARATOR_WIDTH, fold - SEPARATOR_WIDTH) <=
          available
        );
      }) ?? 0;

  return folders.length - kept;
}

function HiddenFolders({
  directories,
  files,
  onOpen,
}: {
  readonly directories: readonly string[];
  readonly files: readonly MentionFile[] | undefined;
  readonly onOpen: (file: MentionFile) => void;
}): ReactElement {
  const trigger = useRef<HTMLButtonElement>(null);
  const [directory, setDirectory] = useState<string>();

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button ref={trigger} variant="plain" title={directories.at(-1)} xstyle={styles.crumb}>
              {HIDDEN_LABEL}
            </Button>
          }
        />
        <MenuContent align="start" xstyle={styles.menu}>
          {directories.map((entry) => (
            <MenuItem
              key={entry}
              icon="folder-open"
              title={entry}
              onClick={() => setDirectory(entry)}
            >
              {entry.slice(entry.lastIndexOf("/") + 1)}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      <Popover.Root
        open={directory !== undefined}
        onOpenChange={(open) => {
          if (!open) setDirectory(undefined);
        }}
      >
        <Popover.Portal>
          <Popover.Positioner anchor={trigger} align="start">
            <Popover.Popup aria-label={directory} xstyle={styles.popup}>
              {directory !== undefined && (
                <BreadcrumbTree
                  key={directory}
                  directory={directory}
                  files={files}
                  onOpen={(file) => {
                    setDirectory(undefined);
                    onOpen(file);
                  }}
                />
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}

function FileCrumb({
  label,
  directory,
  files,
  onOpen,
}: {
  readonly label: string;
  readonly directory: string;
  readonly files: readonly MentionFile[] | undefined;
  readonly onOpen: (file: MentionFile) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <Button variant="plain" title={directory} xstyle={styles.crumb}>
            <span {...props(styles.label)}>{label}</span>
          </Button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner align="start">
          <Popover.Popup aria-label={directory} xstyle={styles.popup}>
            {open && (
              <BreadcrumbTree
                key={directory}
                directory={directory}
                files={files}
                onOpen={(file) => {
                  setOpen(false);
                  onOpen(file);
                }}
              />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function BreadcrumbTree({
  directory,
  files,
  onOpen,
}: {
  readonly directory: string;
  readonly files: readonly MentionFile[] | undefined;
  readonly onOpen: (file: MentionFile) => void;
}): ReactElement {
  const prefix = directory === "" ? "" : `${directory}/`;

  const paths = (files ?? [])
    .filter((file) => file.displayPath.startsWith(prefix) && file.displayPath !== prefix)
    .map((file) => file.displayPath.slice(prefix.length));

  const [itemHeight] = useState(treeItemHeight);

  const { model } = useFileTree({
    paths: [],
    density: "compact",
    itemHeight,
    unsafeCSS: PIERRE_TREE_CSS,
    initialExpansion: 0,
    search: false,
  });

  const shownPaths = useRef<ReadonlySet<string>>(new Set());
  // oxlint-disable-next-line nyte-code/no-direct-effect -- pushes path changes into the imperative Pierre tree
  useLayoutEffect(() => {
    shownPaths.current = syncTreePaths(model, shownPaths.current, paths);
  }, [model, paths]);

  const openFile = (event: Event): void => {
    const row = event
      .composedPath()
      .find((target) => target instanceof HTMLElement && target.dataset.type === "item");

    if (!(row instanceof HTMLElement) || row.dataset.itemType !== "file") return;

    const file = files?.find(
      (candidate) => candidate.displayPath === `${prefix}${row.dataset.itemPath}`,
    );

    if (file !== undefined) onOpen(file);
  };

  return (
    <FileTree
      model={model}
      onClick={(event) => openFile(event.nativeEvent)}
      onKeyDown={(event) => {
        if (event.key === "Enter") openFile(event.nativeEvent);
      }}
      {...props(workbenchStyles.treeTheme, styles.tree)}
    />
  );
}
