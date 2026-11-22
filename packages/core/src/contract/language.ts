import type {
  CodeAction,
  CodeActionKind,
  CodeActionOutcome,
  CodeActionResolveToken,
  Color,
  ColorPresentation,
  CompletionItem,
  CompletionList,
  CompletionResolveToken,
  CompletionTrigger,
  DiagnosticsFrame,
  DocumentColor,
  DocumentHighlight,
  DocumentLink,
  DocumentLinkToken,
  DocumentSymbol,
  FoldingRange,
  FormatOptions,
  HierarchyCall,
  HierarchyItem,
  HierarchyToken,
  Hover,
  InlayHint,
  LanguageLocation,
  LanguageFormatOutcome,
  LinkedEditingRanges,
  LanguageRefresh,
  LanguageServerView,
  RenameOutcome,
  RenameTarget,
  SemanticTokens,
  SignatureHelp,
  TextChange,
  TextPosition,
  TextRange,
  WorkspaceSymbol,
} from "@nyte-ai/schema";

/**
 * Language intelligence for a workspace's files, from every language server that takes a file,
 * one per server and project root. A query goes to the servers that answer it and their answers
 * are merged, or the first one's taken where only one can apply, such as a rename. Paths are workspace-relative or absolute and come back workspace-relative inside the
 * workspace. A client drives the text of the documents it opens: `open` with its version, then
 * `change` with each newer version, one at a time and in order, then `close`. A file no client
 * opened is read from disk for each request. A query waits for the file's servers to start, and
 * for a missing one to download. Queries on a file no server handles, or whose servers are
 * missing or failed, answer empty; `status` says why.
 */
export interface LanguageApi {
  status(): Promise<readonly LanguageServerView[]>;
  watchStatus(): AsyncIterable<readonly LanguageServerView[]>;
  /** The servers that took the document, each once it started or said why it did not; empty for a file no server handles. */
  open(input: {
    readonly path: string;
    readonly text: string;
    readonly version: number;
  }): Promise<readonly LanguageServerView[]>;
  /** Throws `SdkError("unknown")` for a document no client opened and `SdkError("stale")` for a version no newer than the last; open the document again to start over. */
  change(input: {
    readonly path: string;
    readonly version: number;
    readonly changes: readonly TextChange[];
  }): Promise<null>;
  close(input: { readonly path: string }): Promise<null>;
  /** Each frame holds the files whose list changed since the last; the first holds every file's known list. */
  diagnostics(): AsyncIterable<readonly DiagnosticsFrame[]>;
  completion(
    input: LanguagePosition & { readonly trigger: CompletionTrigger },
  ): Promise<CompletionList>;
  resolveCompletion(input: {
    readonly token: CompletionResolveToken;
  }): Promise<CompletionItem | null>;
  hover(input: LanguagePosition): Promise<Hover | null>;
  definition(input: LanguagePosition): Promise<readonly LanguageLocation[]>;
  typeDefinition(input: LanguagePosition): Promise<readonly LanguageLocation[]>;
  implementation(input: LanguagePosition): Promise<readonly LanguageLocation[]>;
  declaration(input: LanguagePosition): Promise<readonly LanguageLocation[]>;
  references(
    input: LanguagePosition & { readonly includeDeclaration: boolean },
  ): Promise<readonly LanguageLocation[]>;
  documentHighlights(input: LanguagePosition): Promise<readonly DocumentHighlight[]>;
  symbols(input: { readonly path: string }): Promise<readonly DocumentSymbol[]>;
  /** Asks the servers now running; it starts none. */
  workspaceSymbols(input: { readonly query: string }): Promise<readonly WorkspaceSymbol[]>;
  prepareRename(input: LanguagePosition): Promise<RenameTarget | null>;
  rename(input: LanguagePosition & { readonly name: string }): Promise<RenameOutcome>;
  /** With `only`, just the actions of those kinds and the kinds under them, as a server offers some only when asked. */
  codeActions(input: {
    readonly path: string;
    readonly range: TextRange;
    readonly only?: readonly CodeActionKind[];
  }): Promise<readonly CodeAction[]>;
  resolveCodeAction(input: { readonly token: CodeActionResolveToken }): Promise<CodeActionOutcome>;
  /** With `range`, formats only that range, by a server that formats ranges. */
  format(input: {
    readonly path: string;
    readonly options: FormatOptions;
    readonly range?: TextRange;
  }): Promise<LanguageFormatOutcome>;
  signatureHelp(input: LanguagePosition): Promise<SignatureHelp | null>;
  inlayHints(input: {
    readonly path: string;
    readonly range: TextRange;
  }): Promise<readonly InlayHint[]>;
  foldingRanges(input: { readonly path: string }): Promise<readonly FoldingRange[]>;
  /** One list per position, innermost range first. */
  selectionRanges(input: {
    readonly path: string;
    readonly positions: readonly TextPosition[];
  }): Promise<readonly (readonly TextRange[])[]>;
  /** The whole document's tokens, or with `range` the tokens in it where the server can tell; null when no server has tokens. */
  semanticTokens(input: {
    readonly path: string;
    readonly range?: TextRange;
  }): Promise<SemanticTokens | null>;
  callHierarchy(input: LanguagePosition): Promise<readonly HierarchyItem[]>;
  /** Empty for a stale token, as for an item nothing calls. */
  incomingCalls(input: { readonly token: HierarchyToken }): Promise<readonly HierarchyCall[]>;
  outgoingCalls(input: { readonly token: HierarchyToken }): Promise<readonly HierarchyCall[]>;
  typeHierarchy(input: LanguagePosition): Promise<readonly HierarchyItem[]>;
  supertypes(input: { readonly token: HierarchyToken }): Promise<readonly HierarchyItem[]>;
  subtypes(input: { readonly token: HierarchyToken }): Promise<readonly HierarchyItem[]>;
  /** The edits that keep code working once the files or folders are renamed; call it before renaming, while `from` still exists. It starts the servers of the files named and asks every running server that follows renames. */
  renameFiles(input: {
    readonly files: readonly { readonly from: string; readonly to: string }[];
  }): Promise<RenameOutcome>;
  documentLinks(input: { readonly path: string }): Promise<readonly DocumentLink[]>;
  resolveDocumentLink(input: { readonly token: DocumentLinkToken }): Promise<DocumentLink | null>;
  documentColors(input: { readonly path: string }): Promise<readonly DocumentColor[]>;
  colorPresentations(input: {
    readonly path: string;
    readonly range: TextRange;
    readonly color: Color;
  }): Promise<readonly ColorPresentation[]>;
  linkedEditingRanges(input: LanguagePosition): Promise<LinkedEditingRanges | null>;
  /** Each frame names what a server asked to be computed again since the last. */
  refreshes(): AsyncIterable<readonly LanguageRefresh[]>;
}

export interface LanguagePosition {
  readonly path: string;
  readonly position: TextPosition;
}

/** What a provider hands its attachment: the API, and `shutdown` to stop every server when the workspace detaches. */
export interface LanguageService extends LanguageApi {
  /** Follows a change to the folder's trust: trusting starts the servers that waited for it and hold documents, and withdrawing it stops every running server. */
  trustChanged(trusted: boolean): Promise<void>;
  shutdown(): Promise<void>;
}
