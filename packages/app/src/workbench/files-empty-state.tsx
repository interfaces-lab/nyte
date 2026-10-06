import { create, props } from "@stylexjs/stylex";
import { useId, useMemo, useState, type ReactElement } from "react";
import type { MentionFile } from "@nyte-ai/client";
import type { VcsFile } from "@nyte-ai/protocol";
import { Icon } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Row } from "@nyte-ai/ui/row";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { isFolder } from "../conversation/message-references.ts";
import { createFileRanking } from "../file-ranking.ts";
import { macPlatform } from "../platform.ts";
import { treeStatus } from "./tree-theme.ts";

const MATCH_LIMIT = 50;

/** What the files panel shows before any file is open. Changes take the tree's status colors. */
export function FilesEmptyState({
  files,
  changes,
  explorerVisible,
  onOpen,
  onShowExplorer,
  onSearch,
}: {
  readonly files: readonly MentionFile[] | undefined;
  readonly changes: readonly VcsFile[];
  readonly explorerVisible: boolean;
  readonly onOpen: (file: MentionFile) => void;
  readonly onShowExplorer: () => void;
  readonly onSearch: () => void;
}): ReactElement {
  const id = useId();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const needle = query.trim().toLocaleLowerCase();
  const mod = macPlatform(undefined) ? "⌘" : "Ctrl";

  const { rank, byPath } = useMemo(() => {
    const openable = (files ?? []).filter((file) => !isFolder(file));

    return {
      rank: createFileRanking(openable, MATCH_LIMIT),
      byPath: new Map(openable.map((file) => [file.displayPath, file])),
    };
  }, [files]);

  const matches = needle === "" ? [] : rank(needle);
  const active = Math.min(highlight, matches.length - 1);

  return (
    <div {...props(styles.root)}>
      <div {...props(styles.content)}>
        <InputGroup>
          <Icon name="search" size={16} />
          <Input
            autoFocus
            aria-label="Go to file"
            placeholder="Go to file…"
            role="combobox"
            aria-expanded={matches.length > 0}
            aria-controls={`${id}-matches`}
            aria-activedescendant={active < 0 ? undefined : `${id}-match-${active}`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");

              if (matches.length === 0) return;

              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setHighlight((active + step + matches.length) % matches.length);
              }

              if (event.key === "Enter") onOpen(matches[active]);
            }}
          />
        </InputGroup>

        {needle !== "" ? (
          matches.length === 0 ? (
            <p role="status" {...props(styles.noMatch)}>
              No files match “{query.trim()}”
            </p>
          ) : (
            <div id={`${id}-matches`} role="listbox" aria-label="Files">
              {matches.map((file, index) => (
                <Row
                  key={file.path}
                  id={`${id}-match-${index}`}
                  role="option"
                  aria-selected={index === active}
                  tabIndex={-1}
                  variant="nav"
                  selected={index === active}
                  onClick={() => onOpen(file)}
                  onPointerMove={() => setHighlight(index)}
                >
                  <FileLabel path={file.displayPath} />
                </Row>
              ))}
            </div>
          )
        ) : (
          <div {...props(styles.columns)}>
            <section aria-labelledby={`${id}-start`} {...props(styles.section)}>
              <h2 id={`${id}-start`} {...props(styles.heading)}>
                Start
              </h2>
              {!explorerVisible && (
                <Row variant="nav" onClick={onShowExplorer}>
                  <Row.Leading>
                    <Icon name="folder-open" size={16} />
                  </Row.Leading>
                  <Row.Label>Show Explorer</Row.Label>
                </Row>
              )}
              <Row variant="nav" onClick={onSearch}>
                <Row.Leading>
                  <Icon name="search" size={16} />
                </Row.Leading>
                <Row.Label>Search in Files</Row.Label>
                <Row.Meta>
                  <Kbd keys={[mod, "F"]} plain />
                </Row.Meta>
              </Row>
            </section>
            <ChangedFiles id={`${id}-changes`} changes={changes} byPath={byPath} onOpen={onOpen} />
          </div>
        )}
      </div>
    </div>
  );
}

function ChangedFiles({
  id,
  changes,
  byPath,
  onOpen,
}: {
  readonly id: string;
  readonly changes: readonly VcsFile[];
  readonly byPath: ReadonlyMap<string, MentionFile>;
  readonly onOpen: (file: MentionFile) => void;
}): ReactElement | null {
  const changed = changes.flatMap((change) => {
    const file = byPath.get(change.path);

    return file === undefined ? [] : [{ file, status: treeStatus(change.kind) }];
  });

  if (changed.length === 0) return null;

  return (
    <section aria-labelledby={id} {...props(styles.section)}>
      <h2 id={id} {...props(styles.heading)}>
        Changes
      </h2>
      {changed.map(({ file, status }) => (
        <Row key={file.path} variant="nav" onClick={() => onOpen(file)}>
          <FileLabel path={file.displayPath} xstyle={statusColor[status]} />
        </Row>
      ))}
    </section>
  );
}

function FileLabel({
  path,
  xstyle,
}: {
  readonly path: string;
  readonly xstyle?: (typeof statusColor)[keyof typeof statusColor];
}): ReactElement {
  const slash = path.lastIndexOf("/");

  return (
    <>
      <Row.Leading>
        <Icon name="file" size={16} />
      </Row.Leading>
      <Row.Label>
        <span {...props(xstyle)}>{path.slice(slash + 1)}</span>
        {slash > 0 && <span {...props(styles.directory)}>{path.slice(0, slash)}</span>}
      </Row.Label>
    </>
  );
}

/** The panel sets these for its tree; a change reads the same color here. */
const statusColor = create({
  added: { color: "var(--trees-status-added-override)" },
  untracked: { color: "var(--trees-status-untracked-override)" },
  modified: { color: "var(--trees-status-modified-override)" },
  renamed: { color: "var(--trees-status-renamed-override)" },
  deleted: { color: "var(--trees-status-deleted-override)" },
});

const styles = create({
  root: {
    position: "absolute",
    inset: 0,
    overflowY: "auto",
    containerType: "inline-size",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    maxWidth: 880,
    marginInline: "auto",
    paddingInline: 24,
    paddingBlock: "min(14vh, 96px) 24px",
  },
  columns: {
    display: "grid",
    alignItems: "start",
    gap: 24,
    gridTemplateColumns: {
      default: "minmax(0, 1fr)",
      "@container (min-width: 720px)": "minmax(0, 240px) minmax(0, 1fr)",
    },
  },
  section: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  heading: {
    margin: 0,
    paddingInline: 10,
    paddingBlockEnd: 4,
    color: role.contentTertiary,
    fontSize: type.fontXs,
    fontWeight: 500,
  },
  directory: { marginInlineStart: 8, color: role.contentTertiary },
  noMatch: { margin: 0, paddingInline: 10, color: role.contentSecondary, overflowWrap: "anywhere" },
});
