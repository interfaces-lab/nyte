"use client";

import { Row } from "@nyte-ai/ui";
import {
  borderVars,
  colorVars,
  fontVars,
  radiusVars,
  spaceVars,
} from "@nyte-ai/ui/platform-tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { IconBubbleText } from "central-icons";
import { useState } from "react";

const sessions = [
  { id: "onboarding", title: "Onboarding flow", updatedAt: "2m" },
  { id: "migration", title: "Schema migration", updatedAt: "1h" },
  { id: "release", title: "Release notes", updatedAt: "Yesterday" },
];

const styles = stylex.create({
  list: {
    "--nyte-row-height": "36px",
    "--nyte-row-gap": "8px",
    "--nyte-row-padding-inline": "8px",
    "--nyte-row-leading-size": "16px",
    boxSizing: "border-box",
    width: "300px",
    padding: spaceVars["--nyte-space-1"],
    borderWidth: borderVars["--nyte-border-control-width"],
    borderStyle: "solid",
    borderColor: colorVars["--nyte-color-border"],
    borderRadius: radiusVars["--nyte-radius-menu"],
    backgroundColor: colorVars["--nyte-color-sidebar"],
    fontFamily: fontVars["--nyte-font-family-ui"],
    fontSize: fontVars["--nyte-font-size-label"],
    lineHeight: fontVars["--nyte-leading-label"],
  },
});

export function RowDemo() {
  const [currentId, setCurrentId] = useState("migration");

  return (
    <div {...stylex.props(styles.list)}>
      {sessions.map((session) => (
        <Row key={session.id} interactive selected={session.id === currentId}>
          <Row.Primary render={<button type="button" onClick={() => setCurrentId(session.id)} />}>
            <Row.Leading>
              <IconBubbleText size={16} />
            </Row.Leading>
            <Row.Label>{session.title}</Row.Label>
            <Row.Meta>{session.updatedAt}</Row.Meta>
          </Row.Primary>
        </Row>
      ))}
    </div>
  );
}
