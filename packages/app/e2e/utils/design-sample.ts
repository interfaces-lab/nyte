import { join } from "node:path";

/** The desktop suite's sample designs, which the web suite copies into a workspace's `design` folder: a Controls sheet, a Phase card block, a Tonight screen and their tokens. Several desktop chapters pin lines in them, so they stay in that suite. */
export const DESIGN_SAMPLE = join(import.meta.dirname, "../../../desktop/e2e/design-sample");
