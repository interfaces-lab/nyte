import { glyph, row, radius, target } from "@nyte-ai/ui/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { hashKey } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type {
  WorkspaceSearchInput,
  WorkspaceSearchMatch,
  WorkspaceSearchResult,
} from "@nyte-ai/protocol";
import { Icon } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { Button } from "@nyte-ai/ui/button";
import { Toggle } from "@nyte-ai/ui/toggle";
import { Row } from "@nyte-ai/ui/row";
import { useWorkspaceSearch } from "../queries.ts";
import { intent } from "@nyte-ai/ui/surface-theme";
import { motion, role, type } from "@nyte-ai/ui/vars.stylex";
import { workbench } from "../theme/schema.stylex.ts";
import { useDebouncedValue } from "../use-debounced-value.ts";

type SearchLocation = Pick<WorkspaceSearchResult["files"][number], "path" | "displayPath"> &
  Pick<WorkspaceSearchMatch, "line" | "column" | "length">;

interface WorkspaceSearchProps {
  readonly onOpen: (location: SearchLocation) => void;
  readonly drafts?: WorkspaceSearchInput["drafts"];
  readonly active?: boolean;
}

type SearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly result: WorkspaceSearchResult };

const styles = create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    fontFamily: type.fontSans,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    color: role.contentPrimary,
  },
  controls: { display: "flex", flexDirection: "column", gap: 4, padding: 8, flexShrink: 0 },
  toolbar: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  /** The match options sit inside the field and show once it is in use. */
  searchField: {
    "--_search-options-opacity": { default: "0", ":hover": "1", ":focus-within": "1" },
    "--_search-options-events": { default: "none", ":hover": "auto", ":focus-within": "auto" },
    "--_search-options-space": {
      default: "0px",
      ":hover": `calc(3 * ${target.min} + 2px)`,
      ":focus-within": `calc(3 * ${target.min} + 2px)`,
    },
    position: "relative",
  },
  populated: {
    "--_search-options-opacity": "1",
    "--_search-options-events": "auto",
    "--_search-options-space": `calc(3 * ${target.min} + 2px)`,
  },
  searchInput: { paddingInlineEnd: "var(--_search-options-space)" },
  searchIcon: { display: "inline-flex", alignItems: "center", height: glyph.lg, marginTop: -1 },
  field: { flex: 1 },
  toggles: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: 4,
    display: "flex",
    alignItems: "center",
    gap: 1,
    opacity: "var(--_search-options-opacity)",
    pointerEvents: "var(--_search-options-events)",
    transitionProperty: "opacity",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
  },
  filters: { display: "flex", flexDirection: "column", gap: 4 },
  results: { flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", paddingBottom: 8 },
  status: { margin: 0, paddingBlock: 6, paddingInline: 8, color: role.contentSecondary },
  error: { color: role.contentSecondary, overflowWrap: "anywhere" },
  group: { margin: 0, padding: 0, listStyleType: "none" },
  fileHeading: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    minHeight: workbench.headingHeight,
    paddingInline: 8,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    fontWeight: 400,
  },
  path: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  count: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    height: type.leadingXs,
    paddingInline: 4,
    borderRadius: radius.pill,
    backgroundColor: role.bgMutedTranslucent,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    fontVariantNumeric: "tabular-nums",
    color: role.contentSecondary,
  },
  draft: { flexShrink: 0, color: role.contentSecondary, fontSize: type.fontSm },
  result: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    minHeight: row.heightMd,
    width: "100%",
    paddingBlock: 2,
    paddingInlineStart: 32,
    paddingInlineEnd: 8,
    marginBlockEnd: 2,
    borderRadius: radius.indicator,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  snippet: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    whiteSpace: "pre",
    fontFamily: type.fontSans,
    fontSize: "inherit",
  },
  // Keep the match visible even when the host returns 80 columns of leading context.
  prefix: { maxWidth: "35%", overflow: "hidden", textOverflow: "ellipsis" },
  suffix: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  match: {
    flexShrink: 0,
    maxWidth: "65%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    backgroundColor: role.bgInteractivePrimaryTranslucent,
    color: role.contentPrimary,
    borderRadius: 2,
  },
  zeroMatch: { display: "inline-block", width: 2, backgroundColor: role.bgInteractiveStrong },
});

export function WorkspaceSearch({
  onOpen,
  drafts,
  active = true,
}: WorkspaceSearchProps): ReactElement {
  const filtersId = useId();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");

  const input = useMemo(
    () => ({
      query,
      caseSensitive,
      wholeWord,
      regex,
      include: include
        .split(";")
        .map((pattern) => pattern.trim())
        .filter(Boolean),
      exclude: exclude
        .split(";")
        .map((pattern) => pattern.trim())
        .filter(Boolean),
      drafts,
    }),
    [query, caseSensitive, wholeWord, regex, include, exclude, drafts],
  );

  const debouncedInput = useDebouncedValue(input, 250);
  const waiting = hashKey([input]) !== hashKey([debouncedInput]);

  const search = useWorkspaceSearch(
    !active || query === "" || waiting ? undefined : debouncedInput,
  );

  const state: SearchState =
    query === ""
      ? { kind: "idle" }
      : waiting || search.isFetching
        ? { kind: "loading" }
        : search.isError
          ? { kind: "error", message: search.error.message }
          : search.data === undefined
            ? { kind: "loading" }
            : { kind: "ready", result: search.data };

  return (
    <section aria-label="Workspace search" {...props(styles.panel)}>
      <div {...props(styles.controls)}>
        <div {...props(styles.toolbar)}>
          <InputGroup xstyle={[styles.field, styles.searchField, query !== "" && styles.populated]}>
            <span {...props(styles.searchIcon)}>
              <Icon name="search" size={12} />
            </span>
            <Input
              type="text"
              aria-label="Search workspace"
              placeholder="Search"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onValueChange={setQuery}
              xstyle={styles.searchInput}
            />
            <div role="group" aria-label="Search options" {...props(styles.toggles)}>
              <Toggle
                iconOnly
                aria-label="Match case"
                title="Match case"
                size="sm"
                pressed={caseSensitive}
                onPressedChange={setCaseSensitive}
              >
                Aa
              </Toggle>
              <Toggle
                iconOnly
                aria-label="Match whole word"
                title="Match whole word"
                size="sm"
                pressed={wholeWord}
                onPressedChange={setWholeWord}
              >
                ab
              </Toggle>
              <Toggle
                iconOnly
                aria-label="Use regular expression"
                title="Use regular expression"
                size="sm"
                pressed={regex}
                onPressedChange={setRegex}
              >
                .*
              </Toggle>
            </div>
          </InputGroup>
          <Button
            size="sm"
            iconOnly
            icon="filters"
            aria-label="Search filters"
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
            onClick={() => setFiltersOpen((current) => !current)}
          />
        </div>
        <div id={filtersId} hidden={!filtersOpen}>
          <div {...props(styles.filters)}>
            <InputGroup xstyle={styles.field}>
              <Input
                type="text"
                aria-label="Files to include"
                placeholder="Files to include"
                title="Glob patterns separated by semicolons, for example src/**; lib/**"
                value={include}
                spellCheck={false}
                onValueChange={setInclude}
              />
            </InputGroup>
            <InputGroup xstyle={styles.field}>
              <Input
                type="text"
                aria-label="Files to exclude"
                placeholder="Files to exclude"
                title="Glob patterns separated by semicolons, for example **/*.test.*"
                value={exclude}
                spellCheck={false}
                onValueChange={setExclude}
              />
            </InputGroup>
          </div>
        </div>
      </div>
      <WorkspaceSearchResults state={state} onOpen={onOpen} />
    </section>
  );
}

export function WorkspaceSearchResults({
  state,
  onOpen,
}: {
  readonly state: SearchState;
  readonly onOpen: WorkspaceSearchProps["onOpen"];
}): ReactElement {
  if (state.kind === "idle") return <div {...props(styles.results)} />;

  if (state.kind !== "ready") {
    return (
      <div {...props(styles.results)}>
        <p
          role={state.kind === "error" ? "alert" : "status"}
          {...props(
            state.kind === "error" && intent.danger,
            styles.status,
            state.kind === "error" && styles.error,
          )}
        >
          {state.kind === "loading" ? "Searching…" : state.message}
        </p>
      </div>
    );
  }

  const result = state.result;

  return (
    <div aria-label="Search results" {...props(styles.results)}>
      <div role="status" {...props(styles.status)}>
        {result.matchCount === 0
          ? result.truncated
            ? "No matches found before the search limit."
            : "No matches found."
          : `${String(result.matchCount)} ${result.matchCount === 1 ? "match" : "matches"} in ${String(result.files.length)} ${result.files.length === 1 ? "file" : "files"}.`}
        {result.truncated && " Search limit reached. Narrow your query or filters."}
      </div>
      {result.files.map((file) => (
        <section key={file.path} aria-label={file.displayPath}>
          <h3 {...props(styles.fileHeading)}>
            <Icon name="file" size={16} />
            <span title={file.displayPath} {...props(styles.path)}>
              {file.displayPath}
            </span>
            <span {...props(styles.count)}>{file.matches.length}</span>
            {file.source === "draft" && (
              <span {...props(intent.warning, styles.draft)}>Unsaved</span>
            )}
          </h3>
          <ul {...props(styles.group)}>
            {file.matches.map((match) => {
              const start = match.column - match.snippetColumn;

              return (
                <li key={`${String(match.line)}:${String(match.column)}:${String(match.length)}`}>
                  <Row.Primary
                    title={match.snippet}
                    aria-label={`${file.displayPath}, line ${String(match.line)}, column ${String(match.column)}: ${match.snippet}`}
                    onClick={() =>
                      onOpen({
                        path: file.path,
                        displayPath: file.displayPath,
                        line: match.line,
                        column: match.column,
                        length: match.length,
                      })
                    }
                    xstyle={styles.result}
                  >
                    <code {...props(styles.snippet)}>
                      <span {...props(styles.prefix)}>{match.snippet.slice(0, start)}</span>
                      <mark
                        {...props(styles.match, match.length === 0 && styles.zeroMatch)}
                        aria-label={match.length === 0 ? "Zero-width match" : undefined}
                      >
                        {match.length === 0
                          ? "\u200b"
                          : match.snippet.slice(start, start + match.length)}
                      </mark>
                      <span {...props(styles.suffix)}>
                        {match.snippet.slice(start + match.length)}
                      </span>
                    </code>
                  </Row.Primary>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
