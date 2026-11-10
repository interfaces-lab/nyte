import { OPERATIONS } from "../../../src/index.ts";
import {
  operation,
  workspace,
  page,
  documentRevision,
  workspaceInput,
  pageInput,
  pageInfo,
} from "../fixtures.ts";
import type { Case } from "../fixtures.ts";

export const browserOperations = {
  "browser.open input": operation(
    OPERATIONS["browser.open"].input,
    { workspace, url: "https://a.b", id: "open-1" },
    { workspace, url: 1 },
  ),
  "browser.adopt input": operation(
    OPERATIONS["browser.adopt"].input,
    { workspace, id: page },
    { workspace },
  ),
  "browser.list input": operation(OPERATIONS["browser.list"].input, workspaceInput, {}),
  "browser.list output": operation(OPERATIONS["browser.list"].output, [pageInfo], [{ id: page }]),
  "browser.watch input": operation(OPERATIONS["browser.watch"].input, workspaceInput, {}),
  "browser.watch output": operation(OPERATIONS["browser.watch"].output, [], {}),
  "page.view input": operation(OPERATIONS["page.view"].input, pageInput, { page }),
  "page.watch input": operation(OPERATIONS["page.watch"].input, pageInput, { workspace }),
  "page.snapshot input": operation(
    OPERATIONS["page.snapshot"].input,
    { ...pageInput, ref: "e1" },
    { ...pageInput, ref: 1 },
  ),
  "page.navigate input": operation(
    OPERATIONS["page.navigate"].input,
    { ...pageInput, url: "https://a.b" },
    pageInput,
  ),
  "page.back input": operation(OPERATIONS["page.back"].input, pageInput, {}),
  "page.forward input": operation(OPERATIONS["page.forward"].input, pageInput, {}),
  "page.reload input": operation(OPERATIONS["page.reload"].input, pageInput, {}),
  "page.stopLoading input": operation(OPERATIONS["page.stopLoading"].input, pageInput, {}),
  "page.click input": operation(
    OPERATIONS["page.click"].input,
    { ...pageInput, ref: "e1", button: "middle", double: true, expect: documentRevision },
    { ...pageInput, ref: "e1", button: "side" },
  ),
  "page.type input": operation(
    OPERATIONS["page.type"].input,
    { ...pageInput, ref: "e1", text: "hi", clear: true, submit: false },
    { ...pageInput, ref: "e1" },
  ),
  "page.press input": operation(
    OPERATIONS["page.press"].input,
    { ...pageInput, key: "Enter" },
    pageInput,
  ),
  "page.scroll input": operation(
    OPERATIONS["page.scroll"].input,
    { ...pageInput, direction: "bottom", pages: 2 },
    { ...pageInput, direction: "left" },
  ),
  "page.wait input": operation(
    OPERATIONS["page.wait"].input,
    { ...pageInput, condition: { kind: "text", text: "Done", present: true } },
    { ...pageInput, condition: { kind: "idle" } },
  ),
  "page.console input": operation(
    OPERATIONS["page.console"].input,
    { ...pageInput, limit: 10, clear: true },
    { ...pageInput, clear: "yes" },
  ),
  "page.console output": operation(
    OPERATIONS["page.console"].output,
    [{ level: "error", text: "Boom.", at: 1 }],
    [{ level: "fatal", text: "Boom.", at: 1 }],
  ),
  "page.capture input": operation(OPERATIONS["page.capture"].input, pageInput, {}),
  "page.capture output": operation(
    OPERATIONS["page.capture"].output,
    "aGk=",
    1,
    Uint8Array.of(104, 105),
  ),
  "page.evaluate input": operation(
    OPERATIONS["page.evaluate"].input,
    { ...pageInput, expression: "document.title", options: { ref: "e1" } },
    pageInput,
  ),
  "page.evaluate output": operation(
    OPERATIONS["page.evaluate"].output,
    { kind: "value", value: { title: "A" } },
    { kind: "threw" },
  ),
  "page.close input": operation(OPERATIONS["page.close"].input, pageInput, {}),
  "page.close output": operation(OPERATIONS["page.close"].output, null, "closed"),
} satisfies Record<string, Case>;
