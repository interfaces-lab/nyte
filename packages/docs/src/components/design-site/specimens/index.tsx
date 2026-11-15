import { componentSpecimens } from "./components";
import { fieldTripSpecimens } from "./field-trips";
import { foundationSpecimens } from "./foundations";

const specimens = { ...foundationSpecimens, ...componentSpecimens, ...fieldTripSpecimens };

type SpecimenSlug = keyof typeof specimens;

export const wideSpecimens: ReadonlySet<string> = new Set(["colors", "typography"]);

export function hasSpecimen(slug: string): slug is SpecimenSlug {
  return Object.hasOwn(specimens, slug);
}

export function Specimen({ slug }: { slug: string }) {
  if (!hasSpecimen(slug)) return null;

  const Render = specimens[slug];

  return <Render />;
}
