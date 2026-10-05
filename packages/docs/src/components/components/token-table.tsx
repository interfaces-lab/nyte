import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * Reads the `--nyte-*` declarations from the stylesheet @nyte-ai/ui ships, so
 * the table can never disagree with the package. The first declaration of a
 * token is its default; a coarse-pointer value follows under @media.
 */
// Resolved by path rather than through the package export so the bundler
// treats it as data, not as a stylesheet to be placed in a chunk.
const uiCss = readFileSync(path.resolve(process.cwd(), "../ui/dist/ui.css"), "utf8");

const rootBlock = /:root, \.[a-z0-9]+ \{([^}]*)\}/g;

const declaration = /(--nyte-[a-z0-9-]+):\s*([^;]+);/g;

const declared = new Map<string, string>();

for (const [, body = ""] of uiCss.matchAll(rootBlock)) {
  for (const [, name, value] of body.matchAll(declaration)) {
    if (name && value && !declared.has(name)) declared.set(name, value.trim());
  }
}

export function TokenTable({
  prefix,
  swatch = false,
}: {
  prefix: string | readonly string[];
  swatch?: boolean;
}) {
  const prefixes = typeof prefix === "string" ? [prefix] : prefix;
  const rows = [...declared].filter(([name]) => prefixes.some((start) => name.startsWith(start)));

  return (
    <table className="cloud-token-table">
      <thead>
        <tr>
          <th>Token</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, value]) => (
          <tr key={name}>
            <td>
              <code>{name}</code>
            </td>
            <td>
              {swatch && (
                <span aria-hidden className="cloud-swatch" style={{ background: `var(${name})` }} />
              )}
              <code>{value}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
