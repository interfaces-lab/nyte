import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useLights } from "../light/light.ts";
import { designLights } from "./designs.ts";
import type { Designs } from "./designs.ts";
import { studioStyles } from "./studio.stylex.ts";

const KINDS = [
  { folder: "screens", icon: "phone" },
  { folder: "blocks", icon: "layers" },
  { folder: "controls", icon: "cube" },
] as const;

const FRAME_NAME = /\sdata-frame=(?<quote>["'])(?<name>.+?)\k<quote>/u;

function belongs(path: string, folder: string): boolean {
  return path.includes(`/${folder}/`) || path.includes(`/${folder}.`);
}

/**
 * The workspace's designs in the order they build on each other: screens, the blocks they are made of, the controls
 * under those, then the tokens. What a design is shows as its icon, and each goes by its first frame's name, as the
 * board labels it, or by its file's when it names no frame.
 */
export function DesignList(input: {
  readonly designs: Designs;
  /** Shown even where the panel is too narrow to keep it open. */
  readonly open: boolean;
  readonly onReveal: (path: string) => void;
}): ReactElement {
  const lit = useLights((lights) => designLights(lights).you?.subject.path);
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
      {rows.map((row) => (
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
          <Row.Label>
            {FRAME_NAME.exec(input.designs.texts.get(row.path) ?? "")?.groups?.["name"] ??
              (row.path.split("/").at(-1) ?? row.path).replace(/\.jsx$/u, "")}
          </Row.Label>
        </Row>
      ))}
    </nav>
  );
}
