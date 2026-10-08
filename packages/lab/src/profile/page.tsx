/**
 * A draft of the profile page as a member passport. Fixture data only; see
 * `fixtures.ts`.
 */
import { create, props } from "@stylexjs/stylex";
import { useEffect, useState, type ReactElement } from "react";
import { Button } from "@nyte-ai/ui/button";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { Passport } from "./passport";

const SCHEMES = [
  ["system", "System", "light dark"],
  ["light", "Light", "light"],
  ["dark", "Dark", "dark"],
] as const;

type Scheme = (typeof SCHEMES)[number][0];

const BOOK_ID = "profile-passport";

export function ProfilePage(): ReactElement {
  const [open, setOpen] = useState(false);
  const [scheme, setScheme] = useState<Scheme>("system");

  // On the document, so the copy button's tooltip, which portals out, follows it.
  useEffect(() => {
    const value = SCHEMES.find(([name]) => name === scheme)?.[2] ?? "light dark";
    document.documentElement.style.colorScheme = value;

    return () => {
      document.documentElement.style.colorScheme = "";
    };
  }, [scheme]);

  return (
    <main {...props(styles.page)}>
      <header {...props(styles.header)}>
        <h1 {...props(styles.title)}>Profile</h1>
        <div {...props(styles.controls)}>
          <ToggleGroup
            aria-label="Appearance"
            value={[scheme]}
            onValueChange={(values) => {
              const next = SCHEMES.find(([name]) => name === values[0]);

              if (next !== undefined) setScheme(next[0]);
            }}
          >
            {SCHEMES.map(([name, label]) => (
              <Toggle key={name} value={name} size="sm">
                {label}
              </Toggle>
            ))}
          </ToggleGroup>
          <Button
            variant="outline"
            size="sm"
            aria-controls={BOOK_ID}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Close passport" : "Open passport"}
          </Button>
        </div>
      </header>

      <Passport id={BOOK_ID} open={open} onOpenChange={setOpen} />
    </main>
  );
}

const styles = create({
  page: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: { default: 32, "@media (min-width: 760px)": 56 },
    minBlockSize: "100dvh",
    paddingBlock: "32px 96px",
    paddingInline: 16,
    overflowX: "clip",
    backgroundColor: role.bgChrome,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    inlineSize: "min(100%, 720px)",
  },
  title: {
    margin: 0,
    fontSize: type.fontLg,
    fontWeight: 600,
    lineHeight: type.leadingLg,
  },
  controls: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
  },
});
