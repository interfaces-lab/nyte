import { docsIcons, isDocsIconName } from "~/lib/docs-icons";

function CentralIcon({ name }: { name: string }) {
  if (!isDocsIconName(name)) return null;
  const Icon = docsIcons[name];
  return <Icon size={20} />;
}

export function DocCard({
  icon,
  title,
  href,
  description,
}: {
  icon: string;
  title: string;
  href: string;
  description: string;
}) {
  return (
    <a href={href} className="docs-card">
      <span className="docs-card-icon">
        <CentralIcon name={icon} />
      </span>
      <strong>{title}</strong>
      <span>{description}</span>
    </a>
  );
}
