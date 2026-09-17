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
    case "Primitives":
      return {
        icon: "IconComponents",
        description: "Styled wrappers exported from @nyte-ai/ui.",
      };
    case "Headless":
      return {
        icon: "IconCodeBrackets",
        description: "Base UI namespaces, unstyled, with the author's contract intact.",
      };
    case "Desktop":
      return {
        icon: "IconConsole",
        description: "The desktop app's own component tier.",
      };
    case "Surfaces":
      return {
        icon: "IconPackage",
        description: "One page per product concern, across hosts.",
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
