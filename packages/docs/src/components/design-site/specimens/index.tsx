import { componentSpecimens } from "./components";
import { foundationSpecimens } from "./foundations";

const specimens = { ...foundationSpecimens, ...componentSpecimens };

type SpecimenSlug = keyof typeof specimens;

/** Specimens that take two catalogue columns. */
export const wideSpecimens: ReadonlySet<string> = new Set(["colors", "typography"]);

export function hasSpecimen(slug: string): slug is SpecimenSlug {
  return Object.hasOwn(specimens, slug);
}

/** The live specimen for a page slug: `button` renders buttons. */
export function Specimen({ slug }: { slug: string }) {
  if (!hasSpecimen(slug)) return null;

  const Render = specimens[slug];

  return <Render />;
}
