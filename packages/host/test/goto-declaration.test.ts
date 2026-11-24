import { execFileSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { asId } from "@nyte-ai/schema";
import type { LanguageLocation, TextPosition } from "@nyte-ai/schema";
import type { LanguageService } from "@nyte-ai/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localExec, localFiles } from "../src/index.ts";
import { localLanguage } from "../src/local/language/manager.ts";
import { findExecutable } from "../src/local/process/command.ts";
import { localEnv } from "./language-harness.ts";

/** A spot in a fixture file: the first line holding `line`, at the word `name` in it. */
interface Spot {
  readonly file: string;
  readonly line: string;
  readonly name: string;
}

/** Where a navigation must land: a fixture file, or a standard library file under GOROOT's `src`. */
interface Place {
  readonly file: string;
  readonly line: string;
  readonly name: string;
  readonly root?: "goroot";
}

interface Case {
  readonly name: string;
  readonly query: "definition" | "typeDefinition" | "references";
  readonly at: Spot;
  readonly lands: readonly Place[];
  readonly edit?: { readonly file: string; readonly prefix: string };
}

const at = (file: string, line: string, name: string): Spot => ({ file, line, name });

const goroot = (file: string, line: string, name: string): Place => ({
  file,
  line,
  name,
  root: "goroot",
});

/** Go to Declaration's landing cases on the goto-go fixture, each the way gopls answers GoLand's. */
const CASES: readonly Case[] = [
  {
    name: "a call lands on the function in another file",
    query: "definition",
    at: at("main.go", "shop.Place(order, printer{})", "Place"),
    lands: [at("shop/shop.go", "func Place(", "Place")],
  },
  {
    name: "a qualified type lands on its declaration in another package",
    query: "definition",
    at: at("main.go", "&shop.Order{", "Order"),
    lands: [at("shop/shop.go", "type Order struct", "Order")],
  },
  {
    name: "a package qualifier lands on its import",
    query: "definition",
    at: at("main.go", "shop.Place(order, printer{})", "shop"),
    lands: [at("main.go", '"example.com/goto/shop"', '"')],
  },
  {
    name: "an import path offers every file of the package",
    query: "definition",
    at: at("main.go", '"example.com/goto/shop"', "goto"),
    lands: [
      at("shop/receipt.go", "package shop", "package"),
      at("shop/shop.go", "package shop", "package"),
    ],
  },
  {
    name: "a local variable lands on its short declaration",
    query: "definition",
    at: at("shop/shop.go", "_ = label", "label"),
    lands: [at("shop/shop.go", "label := ", "label")],
  },
  {
    name: "a parameter lands in the signature",
    query: "definition",
    at: at("shop/shop.go", "money.Format(order.Total())", "order"),
    lands: [at("shop/shop.go", "func Place(order *Order", "order")],
  },
  {
    name: "a column after a surrogate pair counts UTF-16 units",
    query: "definition",
    at: at("shop/shop.go", "money.Format(order.Total())", "Total"),
    lands: [at("shop/shop.go", "func (o *Order) Total()", "Total")],
  },
  {
    name: "a field selector lands on the field",
    query: "definition",
    at: at("shop/shop.go", "sum += item.Price", "Price"),
    lands: [at("shop/shop.go", "Price money.Cents", "Price")],
  },
  {
    name: "an embedded field's name lands on the embedding",
    query: "definition",
    at: at("shop/receipt.go", "ledger.Audit.Record", "Audit"),
    lands: [at("shop/shop.go", "\tAudit", "Audit")],
  },
  {
    name: "a promoted method lands on the embedded type's method",
    query: "definition",
    at: at("shop/shop.go", "order.ledger.Record(", "Record"),
    lands: [at("shop/shop.go", "func (a *Audit) Record(", "Record")],
  },
  {
    name: "a method promoted from an embedded standard type lands in GOROOT",
    query: "definition",
    at: at("shop/shop.go", "order.ledger.Lock()", "Lock"),
    lands: [goroot("sync/mutex.go", "func (m *Mutex) Lock()", "Lock")],
  },
  {
    name: "an embedded standard type lands on its declaration",
    query: "definition",
    at: at("shop/shop.go", "sync.Mutex", "Mutex"),
    lands: [goroot("sync/mutex.go", "type Mutex struct", "Mutex")],
  },
  {
    name: "an interface method call lands on the interface's method, not an implementation",
    query: "definition",
    at: at("shop/shop.go", "return notifier.Notify(order)", "Notify"),
    lands: [at("shop/shop.go", "Notify(order *Order) error", "Notify")],
  },
  {
    name: "a standard library function lands in GOROOT",
    query: "definition",
    at: at("shop/shop.go", "fmt.Sprintf(", "Sprintf"),
    lands: [goroot("fmt/print.go", "func Sprintf(", "Sprintf")],
  },
  {
    name: "a builtin lands in the builtin package",
    query: "definition",
    at: at("shop/shop.go", "len(order.Items)", "len"),
    lands: [goroot("builtin/builtin.go", "func len(", "len")],
  },
  {
    name: "a vendored dependency lands in vendor",
    query: "definition",
    at: at("shop/shop.go", "money.Format(order.Total())", "Format"),
    lands: [at("vendor/example.com/money/money.go", "func Format(", "Format")],
  },
  {
    name: "a type parameter lands in the brackets",
    query: "definition",
    at: at("shop/shop.go", "First, Second T", "T"),
    lands: [at("shop/shop.go", "type Pair[T any]", "T")],
  },
  {
    name: "an instantiated generic type lands on the generic declaration",
    query: "definition",
    at: at("main.go", "shop.Pair[int]{", "Pair"),
    lands: [at("shop/shop.go", "type Pair[T any]", "Pair")],
  },
  {
    name: "a declaration answers with itself, which turns Go to Declaration into its usages",
    query: "definition",
    at: at("shop/shop.go", "func Place(", "Place"),
    lands: [at("shop/shop.go", "func Place(", "Place")],
  },
  {
    name: "a declaration with one usage",
    query: "references",
    at: at("shop/shop.go", "func Place(", "Place"),
    lands: [at("main.go", "shop.Place(order, printer{})", "Place")],
  },
  {
    name: "a declaration with several usages",
    query: "references",
    at: at("shop/shop.go", "type Item struct", "Item"),
    lands: [at("main.go", "[]shop.Item{", "Item"), at("shop/shop.go", "Items  []Item", "Item")],
  },
  {
    name: "a variable's type declaration",
    query: "typeDefinition",
    at: at("main.go", "order := &shop.Order", "order"),
    lands: [at("shop/shop.go", "type Order struct", "Order")],
  },
  {
    name: "a field's type declaration",
    query: "typeDefinition",
    at: at("shop/shop.go", "ledger *Ledger", "ledger"),
    lands: [at("shop/shop.go", "type Ledger struct", "Ledger")],
  },
  {
    name: "a keyword has none",
    query: "definition",
    at: at("shop/shop.go", "func Place(", "func"),
    lands: [],
  },
  {
    name: "a string has none",
    query: "definition",
    at: at("shop/shop.go", '"order of %d items"', "items"),
    lands: [],
  },
  {
    name: "a comment word has none",
    query: "definition",
    at: at("shop/shop.go", "// Place records the order", "records"),
    lands: [],
  },
  {
    name: "an unsaved edit above moves the landing with it",
    query: "definition",
    at: at("main.go", "shop.Place(order, printer{})", "printer"),
    lands: [at("main.go", "type printer struct{}", "printer")],
    edit: { file: "main.go", prefix: "// one\n// two\n" },
  },
];

const ROOT = join(import.meta.dirname, "fixtures", "language", "goto-go");

describe.skipIf((await findExecutable("gopls")) === null)(
  "Go to Declaration lands on gopls",
  () => {
    let language: LanguageService;
    let root: string;
    let goSource: string;

    beforeAll(async () => {
      root = await realpath(ROOT);
      goSource = join(execFileSync("go", ["env", "GOROOT"], { encoding: "utf8" }).trim(), "src");
      language = localLanguage(
        {
          identity: asId("goto"),
          cwd: root,
          files: localFiles(root),
          exec: localExec(root),
          close: async () => undefined,
        },
        { trusted: async () => true },
      );
    });

    afterAll(async () => {
      await language.shutdown();
    });

    it.each(CASES)("$name", { timeout: 60_000 }, async (entry) => {
      const text = await readFile(join(root, entry.at.file), "utf8");
      const shift = entry.edit?.prefix.split("\n").length ?? 1;

      if (entry.edit !== undefined) {
        await language.open({
          path: entry.edit.file,
          text: `${entry.edit.prefix}${text}`,
          version: 1,
        });
      }

      try {
        const position = spot(text, entry.at);
        const moved = { line: position.line + shift - 1, utf16Column: position.utf16Column };
        const query = { path: entry.at.file, position: moved };

        const found =
          entry.query === "references"
            ? await language.references({ ...query, includeDeclaration: false })
            : await language[entry.query](query);

        const wanted = await Promise.all(
          entry.lands.map(async (place) => {
            const path = place.root === "goroot" ? join(goSource, place.file) : place.file;
            const landed = spot(
              await readFile(place.root === "goroot" ? path : join(root, path), "utf8"),
              place,
            );
            const edited = entry.edit?.file === place.file ? shift - 1 : 0;

            return `${path}:${String(landed.line + edited + 1)}:${String(landed.utf16Column + 1)}`;
          }),
        );

        expect(found.map(described).toSorted()).toEqual(wanted.toSorted());
      } finally {
        if (entry.edit !== undefined) await language.close({ path: entry.edit.file });
      }
    });
  },
);

const TYPESCRIPT_CASES: readonly Case[] = [
  {
    name: "an imported class lands on its declaration, not on the import",
    query: "definition",
    at: at("src/index.ts", "new Hub()", "Hub"),
    lands: [at("src/hub.ts", "export class Hub", "Hub")],
  },
  {
    name: "an imported class's usages include the other file",
    query: "references",
    at: at("src/index.ts", "new Hub()", "Hub"),
    lands: [
      at("src/hub.ts", "export class Hub", "Hub"),
      at("src/index.ts", "import { Hub", "Hub"),
      at("src/index.ts", "new Hub()", "Hub"),
    ],
  },
];

const TYPESCRIPT_ROOT = join(import.meta.dirname, "fixtures", "language", "notifyhub-ts");

describe.skipIf((await findExecutable("typescript-language-server")) === null)(
  "Go to Declaration lands on typescript-language-server",
  () => {
    it.each(TYPESCRIPT_CASES)("$name", { timeout: 60_000 }, async (entry) => {
      const root = await realpath(TYPESCRIPT_ROOT);
      const language = localLanguage(localEnv(root), { trusted: async () => true });
      const text = await readFile(join(root, entry.at.file), "utf8");
      const query = { path: entry.at.file, position: spot(text, entry.at) };

      try {
        await language.open({ path: entry.at.file, text, version: 1 });

        const found =
          entry.query === "references"
            ? await language.references({ ...query, includeDeclaration: true })
            : await language[entry.query](query);

        const wanted = await Promise.all(
          entry.lands.map(async (place) => {
            const landed = spot(await readFile(join(root, place.file), "utf8"), place);

            return `${place.file}:${String(landed.line + 1)}:${String(landed.utf16Column + 1)}`;
          }),
        );

        expect(found.map(described).toSorted()).toEqual(wanted.toSorted());
      } finally {
        await language.shutdown();
      }
    });
  },
);

function described(location: LanguageLocation): string {
  return `${location.path}:${String(location.range.start.line + 1)}:${String(location.range.start.utf16Column + 1)}`;
}

/** The position of the word `name` in the first line that holds `line`. */
function spot(text: string, place: { readonly line: string; readonly name: string }): TextPosition {
  const lines = text.split("\n");
  const index = lines.findIndex((each) => each.includes(place.line));
  const found = lines[index] ?? "";
  const start = found.indexOf(place.line);
  const bounded = /^\w/u.test(place.name) ? `\\b${place.name}\\b` : place.name;
  const word = new RegExp(bounded, "u").exec(found.slice(start));

  if (index < 0 || word === null) throw new Error(`"${place.line}" isn't in the file.`);

  return { line: index, utf16Column: start + word.index };
}
