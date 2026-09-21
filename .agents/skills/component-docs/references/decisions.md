# Decisions

What changed, why, and the evidence behind it. A new rule belongs here before it belongs in the
other files. Remove one when it stops helping.

## 2026-09-18, the reader is someone who installed the package

The Cloud section documented the desktop app's component tier and its application surfaces, 22
pages. `@nyte-ai/desktop` is `private: true` and ships to nobody, so none of it was installable or
importable. Deleted. Evidence: the manifest, and ConnectKit documenting ConnectKit rather than the
Family wallet app.

## 2026-09-18, one component, one page

Pages were split into Primitives, the components we had written StyleX for, and Headless, the ones
we re-exported unstyled. That split describes our implementation. A reader importing `Popover`
from `@nyte-ai/ui/popover` is using our component either way. Merged into Components, one page per
import path, both paths shown on the page.

## 2026-09-18, include Base UI's tables, do not vendor their pages

The headless pages were 11,600 lines of Base UI documentation reproduced verbatim by a generator.
Most of it was their props tables, which already exist per part in `content/base-ui-reference/`,
plus prose introducing demos the generator had stripped. The generator now writes only the part
tables and the pages pull them in with `<include>`. Keep the MIT attribution, it is a condition of
using their text.

## 2026-09-18, source before neighbour

Three defects reached the pages in one session, and all three came from an agent trusting an
existing page over `packages/ui/src`: an invented `ButtonPrimitive` export, four documented Button
variants against five in the type, and `createHandle` taught ahead of the common path. The rules
in `sourcing.md` exist because of these three.

## Open

A deterministic check of documented imports against the package exports was written and removed.
It caught all three defects above and passed the one legitimate alias, so the case for it is real.
It was dropped to avoid a bespoke script with no owner. Revisit if the same class of defect
returns, and prefer extending an existing check over adding a new one.
