import { measureNaturalWidth, prepare } from "@chenglou/pretext";
import { FileTree, useFileTree } from "@nyte-ai/ui/trees/react";
import { create, props } from "@stylexjs/stylex";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Popover } from "@nyte-ai/ui/popover";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { MentionFile } from "../../data/files.ts";
import { PIERRE_TREE_CSS } from "@nyte-ai/ui/worker-pool";
import { syncTreePaths } from "./tree-paths.ts";
import { treeItemHeight } from "./tree-theme.ts";
import { WORKBENCH_KINDS } from "../model.ts";
import { workbenchStyles } from "../workbench.stylex.ts";

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
  crumb: { minWidth: 0 },
  label: { overflow: "hidden", textOverflow: "ellipsis" },
  labelWidth: (width: number) => ({ maxWidth: width }),
  separator: { display: "inline-flex", flexShrink: 0, color: role.contentQuaternary },
  menu: { maxWidth: "min(320px, var(--available-width))" },
  popup: { width: "min(320px, var(--available-width))", padding: 0 },
  tree: { display: "block", height: "min(320px, var(--available-height))", width: "100%" },
});

interface CrumbFit {
  readonly hidden: number;
  readonly nameWidth: number | undefined;
}

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
  const crumbs = external ? undefined : path;
  const fit = useCrumbFit(nav, crumbs);
  const segments = crumbs?.split("/") ?? [];
  const hidden = segments.slice(0, Math.min(fit.hidden, segments.length - 1));

  return (
    <nav ref={nav} aria-label="File path" {...props(styles.path)}>
      {path === undefined && WORKBENCH_KINDS.editor.label}
      {external && (
        <span title={path} {...props(styles.label)}>
          {path}
        </span>
      )}
      {hidden.length > 0 && (
        <HiddenFolders
          directories={hidden.map((_, index) => segments.slice(0, index + 1).join("/"))}
          files={files}
          onOpen={onOpen}
        />
      )}
      {segments.map((segment, index, all) => {
        if (index < hidden.length) return null;
        const current = index === all.length - 1;

        return (
          <Fragment key={all.slice(0, index + 1).join("/")}>
            {index > 0 && (
              <span aria-hidden="true" {...props(styles.separator)}>
                <Icon name="chevron-right" size="2xs" />
              </span>
            )}
            <FileCrumb
              label={segment}
              path={all.slice(0, index + 1).join("/")}
              directory={all.slice(0, current ? index : index + 1).join("/")}
              current={current}
              labelWidth={current ? fit.nameWidth : undefined}
              files={files}
              onOpen={onOpen}
            />
          </Fragment>
        );
      })}
    </nav>
  );
}

function useCrumbFit(nav: RefObject<HTMLElement | null>, path: string | undefined): CrumbFit {
  const [fit, setFit] = useState<CrumbFit>({ hidden: 0, nameWidth: undefined });

  // oxlint-disable-next-line nyte-code/no-direct-effect -- measures the path before paint and observes the bar's width
  useLayoutEffect(() => {
    const node = nav.current;

    if (node === null || path === undefined) return;
    const segments = path.split("/");
    const measurements = new Map<string, { readonly labels: number[]; readonly more: number }>();

    const measure = (): void => {
      const current = node.querySelector('[aria-current="page"]');

      if (!(current instanceof HTMLElement)) return;
      const style = getComputedStyle(current);
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);

      const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;

      const width = (label: string) =>
        Math.ceil(measureNaturalWidth(prepare(label, font, { letterSpacing })));

      const measured = measurements.get(font) ?? {
        labels: segments.map(width),
        more: width(HIDDEN_LABEL),
      };

      measurements.set(font, measured);

      const next = fitCrumbs(
        measured.labels.map((label) => label + padding),
        measured.more + padding,
        padding,
        node.clientWidth,
      );

      setFit((previous) =>
        previous.hidden === next.hidden && previous.nameWidth === next.nameWidth ? previous : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);

    return () => observer.disconnect();
  }, [nav, path]);

  return fit;
}

function fitCrumbs(
  crumbs: readonly number[],
  more: number,
  padding: number,
  available: number,
): CrumbFit {
  const name = crumbs.at(-1) ?? 0;
  const folders = crumbs.slice(0, -1);
  const total = crumbs.reduce((sum, width) => sum + width, 0) + SEPARATOR_WIDTH * folders.length;

  if (total <= available) return { hidden: 0, nameWidth: undefined };
  const base = name + (folders.length === 0 ? 0 : more + SEPARATOR_WIDTH);

  const kept = folders
    .toReversed()
    .filter(
      (_, index, nearest) =>
        nearest.slice(0, index + 1).reduce((sum, width) => sum + width + SEPARATOR_WIDTH, base) <=
        available,
    ).length;

  return {
    hidden: folders.length - kept,
    nameWidth: base <= available ? undefined : Math.max(0, name - padding - (base - available)),
  };
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
            <Button ref={trigger} title={directories.at(-1)} xstyle={styles.crumb}>
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
  path,
  directory,
  current,
  labelWidth,
  files,
  onOpen,
}: {
  readonly label: string;
  readonly path: string;
  readonly directory: string;
  readonly current: boolean;
  readonly labelWidth: number | undefined;
  readonly files: readonly MentionFile[] | undefined;
  readonly onOpen: (file: MentionFile) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <Button title={path} aria-current={current ? "page" : undefined} xstyle={styles.crumb}>
            <span
              {...props(styles.label, labelWidth !== undefined && styles.labelWidth(labelWidth))}
            >
              {label}
            </span>
          </Button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner align="start">
          <Popover.Popup aria-label={directory || "Workspace files"} xstyle={styles.popup}>
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
    .filter((file) => file.displayPath.startsWith(prefix))
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
