import Link from "next/link";
import { cloudNavGroups } from "~/lib/cloud-nav";
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
      {cloudNavGroups().map((group) => {
        const first = group.items[0];
        if (group.label === "" || !first) return null;
        const presentation = layerPresentation(group.label);
        if (!presentation) return null;
        const Icon = docsIcons[presentation.icon];
        return (
          <Link key={group.label} href={first.href} className="cloud-feature">
            <span className="cloud-feature-icon">
              <Icon size={28} />
            </span>
            <span>
              <strong>{group.label}</strong>
              <span>{presentation.description}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
