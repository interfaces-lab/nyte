"use client";

import { Button, Icon, Row } from "@nyte-ai/ui";
import { t } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";

const styles = create({
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    width: 300,
    padding: 4,
    borderRadius: t.radiusLg,
    backgroundColor: t.bgSidebar,
    boxShadow: `inset 0 0 0 1px ${t.strokeSecondary}`,
    color: t.textSecondary,
    fontFamily: t.fontSans,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  settings: {
    width: 360,
    borderRadius: t.radiusXl,
    backgroundColor: t.bgRaised,
    boxShadow: `inset 0 0 0 1px ${t.strokeSecondary}`,
    fontFamily: t.fontSans,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
});

const sessions = [
  { id: "onboarding", title: "Onboarding flow", updatedAt: "2m" },
  { id: "migration", title: "Schema migration", updatedAt: "1h" },
  { id: "release", title: "Release notes", updatedAt: "Yesterday" },
];

export function RowDemo() {
  const [currentId, setCurrentId] = useState("migration");

  return (
    <div {...props(styles.list)}>
      {sessions.map((session) => (
        <Row key={session.id} interactive selected={session.id === currentId}>
          <Row.Primary
            aria-current={session.id === currentId ? "page" : undefined}
            onClick={() => setCurrentId(session.id)}
          >
            <Row.Leading>
              <Icon name="new-chat" size={14} />
            </Row.Leading>
            <Row.Label>{session.title}</Row.Label>
            <Row.Meta>{session.updatedAt}</Row.Meta>
          </Row.Primary>
        </Row>
      ))}
    </div>
  );
}

export function RowLargeDemo() {
  return (
    <div {...props(styles.settings)}>
      <Row size="lg">
        <Row.Body>
          <Row.Label>Claude Sonnet</Row.Label>
          <Row.Description>200K context · $3 / $15</Row.Description>
        </Row.Body>
        <Row.Actions>
          <Button variant="secondary" size="condensed">
            Hide
          </Button>
        </Row.Actions>
      </Row>
    </div>
  );
}

const sections = [
  { id: "general", icon: "settings", title: "General" },
  { id: "appearance", icon: "canvas-grid", title: "Appearance" },
  { id: "models", icon: "box-3d", title: "Models" },
] as const;

export function RowNavDemo() {
  const [current, setCurrent] = useState<string>("general");

  return (
    <div {...props(styles.list)}>
      {sections.map((section) => (
        <Row
          key={section.id}
          variant="nav"
          selected={section.id === current}
          aria-current={section.id === current ? "page" : undefined}
          onClick={() => setCurrent(section.id)}
        >
          <Row.Leading>
            <Icon name={section.icon} size={14} />
          </Row.Leading>
          <Row.Label>{section.title}</Row.Label>
        </Row>
      ))}
    </div>
  );
}
