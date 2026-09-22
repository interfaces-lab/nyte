import { create, props } from "@stylexjs/stylex";
import { hashKey } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type {
  WorkspaceSearchInput,
  WorkspaceSearchMatch,
  WorkspaceSearchResult,
} from "../../../shared/workspace-editor.ts";
import { Icon } from "../components/icons.tsx";
import { focus } from "../components/ui.tsx";
import { useWorkspaceSearch } from "../queries.ts";
import { t } from "../theme/vars.stylex.ts";
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
    fontFamily: t.fontSans,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    color: t.textPrimary,
  },
  controls: { display: "flex", flexDirection: "column", gap: 4, padding: 8, flexShrink: 0 },
  toolbar: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  searchField: {
    "--_search-options-opacity": { default: "0", ":hover": "1", ":focus-within": "1" },
    "--_search-options-events": { default: "none", ":hover": "auto", ":focus-within": "auto" },
    "--_search-options-space": { default: "0px", ":hover": "62px", ":focus-within": "62px" },
    position: "relative",
  },
  populated: {
    "--_search-options-opacity": "1",
    "--_search-options-events": "auto",
    "--_search-options-space": "62px",
  },
  searchInput: { paddingInlineEnd: "var(--_search-options-space)" },
  searchIcon: { display: "inline-flex", alignItems: "center", height: 20, marginTop: -1 },
  field: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    height: 28,
    minHeight: 28,
    boxSizing: "border-box",
    gap: 4,
    paddingInline: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: t.strokeSecondary, ":focus-within": t.strokeFocused },
    borderRadius: t.radiusBase,
    backgroundColor: t.bgElevated,
    color: t.iconSecondary,
  },
  input: {
    flex: 1,
    width: "100%",
    minWidth: 0,
    padding: 0,
    borderStyle: "none",
    outline: "none",
    backgroundColor: "transparent",
    color: { default: t.textPrimary, "::placeholder": t.textTertiary },
    fontFamily: "inherit",
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  toggles: {
    display: "flex",
    alignItems: "center",
    gap: 1,
    position: "absolute",
    insetInlineEnd: 4,
    top: 0,
    height: 26,
    opacity: "var(--_search-options-opacity)",
    pointerEvents: "var(--_search-options-events)",
    transitionProperty: "opacity",
    transitionDuration: "100ms",
    transitionTimingFunction: "ease",
  },
  toggle: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 20,
    height: 20,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radiusXs,
    backgroundColor: { default: "transparent", ":hover": t.fillGhostHover },
    color: t.textSecondary,
    fontFamily: t.fontSans,
    fontSize: t.fontBase,
    lineHeight: 1,
    cursor: "pointer",
  },
  selected: { backgroundColor: t.fillAccentSubtle, color: t.textAccent },
  wholeWord: { textDecoration: "underline", textUnderlineOffset: 3 },
  filtersButton: { width: 20, height: 28, borderRadius: t.radiusBase },
  filters: { display: "flex", flexDirection: "column", gap: 4 },
  results: { flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", paddingBottom: 8 },
  status: { margin: 0, paddingBlock: 6, paddingInline: 8, color: t.textTertiary },
  error: { color: t.textDanger, overflowWrap: "anywhere" },
  group: { margin: 0, padding: 0, listStyleType: "none" },
  fileHeading: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    minHeight: 24,
    paddingInline: 8,
    color: t.textSecondary,
    fontSize: t.fontBase,
    fontWeight: 400,
  },
  path: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  count: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    height: 18,
    paddingInline: 4,
    borderRadius: t.radiusFull,
    backgroundColor: t.fillSecondary,
    fontSize: t.fontXs,
    fontVariantNumeric: "tabular-nums",
    color: t.textTertiary,
  },
  draft: { flexShrink: 0, color: t.textWarning, fontSize: t.fontSm },
  result: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    minHeight: 24,
    width: "100%",
    paddingBlock: 2,
    paddingInlineStart: 32,
    paddingInlineEnd: 8,
    marginBlockEnd: 2,
    borderRadius: t.radiusSm,
    borderStyle: "none",
    backgroundColor: { default: "transparent", ":hover": t.fillGhostHover },
    color: t.textSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    textAlign: "start",
    cursor: "pointer",
  },
  snippet: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    whiteSpace: "pre",
    fontFamily: t.fontSans,
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
    backgroundColor: `color-mix(in srgb, ${t.fillAccent} 40%, transparent)`,
    color: t.textPrimary,
    borderRadius: 2,
  },
  zeroMatch: { display: "inline-block", width: 2, backgroundColor: t.textAccent },
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
          <div {...props(styles.field, styles.searchField, query !== "" && styles.populated)}>
            <span {...props(styles.searchIcon)}>
              <Icon name="search" size={12} />
            </span>
            <input
              type="text"
              aria-label="Search workspace"
              placeholder="Search"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              {...props(styles.input, styles.searchInput)}
            />
            <div role="group" aria-label="Search options" {...props(styles.toggles)}>
              <button
                type="button"
                aria-label="Match case"
                title="Match case"
                aria-pressed={caseSensitive}
                onClick={() => setCaseSensitive((current) => !current)}
                {...props(styles.toggle, caseSensitive && styles.selected, focus.ringInset)}
              >
                Aa
              </button>
              <button
                type="button"
                aria-label="Match whole word"
                title="Match whole word"
                aria-pressed={wholeWord}
                onClick={() => setWholeWord((current) => !current)}
                {...props(
                  styles.toggle,
                  styles.wholeWord,
                  wholeWord && styles.selected,
                  focus.ringInset,
                )}
              >
                ab
              </button>
              <button
                type="button"
                aria-label="Use regular expression"
                title="Use regular expression"
                aria-pressed={regex}
                onClick={() => setRegex((current) => !current)}
                {...props(styles.toggle, regex && styles.selected, focus.ringInset)}
              >
                .*
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="Search filters"
            title="Search filters"
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
            onClick={() => setFiltersOpen((current) => !current)}
            {...props(
              styles.toggle,
              styles.filtersButton,
              (filtersOpen || include !== "" || exclude !== "") && styles.selected,
              focus.ring,
            )}
          >
            <Icon name="filters" size={15} />
          </button>
        </div>
        <div id={filtersId} hidden={!filtersOpen}>
          <div {...props(styles.filters)}>
            <span {...props(styles.field)}>
              <input
                type="text"
                aria-label="Files to include"
                placeholder="Files to include"
                title="Glob patterns separated by semicolons, for example src/**; lib/**"
                value={include}
                spellCheck={false}
                onChange={(event) => setInclude(event.currentTarget.value)}
                {...props(styles.input)}
              />
            </span>
            <span {...props(styles.field)}>
              <input
                type="text"
                aria-label="Files to exclude"
                placeholder="Files to exclude"
                title="Glob patterns separated by semicolons, for example **/*.test.*"
                value={exclude}
                spellCheck={false}
                onChange={(event) => setExclude(event.currentTarget.value)}
                {...props(styles.input)}
              />
            </span>
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
          {...props(styles.status, state.kind === "error" && styles.error)}
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
            {file.source === "draft" && <span {...props(styles.draft)}>Unsaved</span>}
          </h3>
          <ul {...props(styles.group)}>
            {file.matches.map((match) => {
              const start = match.column - match.snippetColumn;
              return (
                <li key={`${String(match.line)}:${String(match.column)}:${String(match.length)}`}>
                  <button
                    type="button"
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
                    {...props(styles.result, focus.ringInset)}
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
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
