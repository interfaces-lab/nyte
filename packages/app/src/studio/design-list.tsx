import { props } from "@stylexjs/stylex";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { textDigest } from "@nyte-ai/plugin/design/board-protocol";
import type { SheetError } from "@nyte-ai/plugin/design/board-protocol";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useLights } from "../light/light.ts";
import { useDesignDiagnostics } from "./design-diagnostics.ts";
import { parseDesign } from "./design-source.ts";
import type { DesignStore, Designs } from "./designs.ts";
import { studioStyles } from "./studio.stylex.ts";

const KINDS = [
  { folder: "screens", icon: "phone" },
  { folder: "blocks", icon: "layers" },
  { folder: "controls", icon: "cube" },
] as const;

function belongs(path: string, folder: string): boolean {
  return path.includes(`/${folder}/`) || path.includes(`/${folder}.`);
}

/**
 * The workspace's designs in the order they build on each other: screens, the blocks they are made of, the controls
 * under those, then the tokens. What a design is shows as its icon, and each goes by its first frame's name, as the
 * board labels it, or by its file's when it names no frame.
 */
export function DesignList(input: {
  readonly store: DesignStore;
  readonly designs: Designs;
  /** Shown even where the panel is too narrow to keep it open. */
  readonly open: boolean;
  readonly onReveal: (path: string) => void;
}): ReactElement {
  const lit = useLights((lights) => input.store.lights(lights).you?.subject.path);
  const errors = useDesignDiagnostics();
  const sheets = input.designs.paths.filter((path) => path.endsWith(".jsx"));

  const rows = [
    ...KINDS.flatMap((kind) =>
      sheets
        .filter((path) => belongs(path, kind.folder))
        .map((path) => ({ path, icon: kind.icon })),
    ),
    ...sheets
      .filter((path) => KINDS.every((kind) => !belongs(path, kind.folder)))
      .map((path) => ({ path, icon: "customize" as const })),
  ];

  return (
    <nav
      {...props(studioStyles.sidebar, input.open && studioStyles.sidebarOpen)}
      aria-label="Designs"
      data-nyte-scrollport
    >
      <h2 {...props(text.sm, studioStyles.heading)}>Designs</h2>
      {rows.map((row) => {
        const error = errors.get(row.path);

        return (
          <Row
            key={row.path}
            variant="nav"
            selected={row.path === lit}
            aria-current={row.path === lit}
            onClick={() => input.onReveal(row.path)}
          >
            <Row.Leading>
              <Icon name={row.icon} size="sm" />
            </Row.Leading>
            <DesignName path={row.path} text={input.designs.texts.get(row.path)} />
            {error !== undefined && (
              <Row.Meta title={describeError(error)}>
                <Icon name="warning" size="sm" label={describeError(error)} />
              </Row.Meta>
            )}
          </Row>
        );
      })}
    </nav>
  );
}

function DesignName(input: {
  readonly path: string;
  readonly text: string | undefined;
}): ReactElement {
  const text = input.text;

  const source = useQuery({
    queryKey: ["studio", "design-source", input.path, text === undefined ? null : textDigest(text)],
    queryFn: text === undefined ? skipToken : () => parseDesign(input.path, text),
    gcTime: 0,
    placeholderData: (previous) => previous,
  });

  return (
    <Row.Label>
      {source.data?.frames[0]?.name ??
        (input.path.split("/").at(-1) ?? input.path).replace(/\.jsx$/u, "")}
    </Row.Label>
  );
}

function describeError(error: SheetError): string {
  const at = error.line === null ? "" : `:${String(error.line)}:${String(error.column ?? 1)}`;

  return error.path === null ? error.message : `${error.path}${at}: ${error.message}`;
}
