import Link from "next/link";
import { navGroups } from "~/lib/nav";
import { docsIcons, type DocsIconName } from "~/lib/docs-icons";

function layerPresentation(label: string): { icon: DocsIconName; description: string } | undefined {
  switch (label) {
    case "Foundations":
      return {
        icon: "IconLayersThree",
        description: "Tokens, theming channels, focus modality, and icons.",
      };
    case "Components":
      return {
        icon: "IconComponents",
        description: "Every component the package exports, styled or unstyled.",
      };
    default:
      return undefined;
  }
}

export function CloudFeatures() {
  return (
    <div className="cloud-features">
      {["Foundations", "Components"].map((label) => {
        const first = navGroups()
          .find((group) => group.label === "Components")
          ?.items.find((item) => item.sub === label);
        const presentation = layerPresentation(label);
        if (!first || !presentation) return null;
        const Icon = docsIcons[presentation.icon];
        return (
          <Link key={label} href={first.href} className="cloud-feature">
            <span className="cloud-feature-icon">
              <Icon size={28} />
            </span>
            <span>
              <strong>{label}</strong>
              <span>{presentation.description}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
