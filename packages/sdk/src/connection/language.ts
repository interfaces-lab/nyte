import type { WorkspaceId } from "@nyte-ai/schema";
import type { LanguageApi } from "@nyte-ai/core";
import type { Rows } from "./rows.ts";

export function languageApi(rows: Rows, workspace: WorkspaceId): LanguageApi {
  return {
    status: () => rows.call("language.status", { workspace }),
    watchStatus: () => rows.watch("language.watchStatus", { workspace }),
    open: (input) => rows.call("language.open", { workspace, ...input }),
    change: (input) => rows.call("language.change", { workspace, ...input }),
    close: (input) => rows.call("language.close", { workspace, ...input }),
    diagnostics: () => rows.watch("language.diagnostics", { workspace }),
    completion: (input) => rows.call("language.completion", { workspace, ...input }),
    resolveCompletion: (input) => rows.call("language.resolveCompletion", { workspace, ...input }),
    hover: (input) => rows.call("language.hover", { workspace, ...input }),
    definition: (input) => rows.call("language.definition", { workspace, ...input }),
    typeDefinition: (input) => rows.call("language.typeDefinition", { workspace, ...input }),
    references: (input) => rows.call("language.references", { workspace, ...input }),
    symbols: (input) => rows.call("language.symbols", { workspace, ...input }),
    prepareRename: (input) => rows.call("language.prepareRename", { workspace, ...input }),
    rename: (input) => rows.call("language.rename", { workspace, ...input }),
    codeActions: (input) => rows.call("language.codeActions", { workspace, ...input }),
    resolveCodeAction: (input) => rows.call("language.resolveCodeAction", { workspace, ...input }),
    format: (input) => rows.call("language.format", { workspace, ...input }),
  };
}
