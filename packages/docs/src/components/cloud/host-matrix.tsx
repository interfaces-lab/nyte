import Link from "next/link";
import type { ReactNode } from "react";

interface HostCell {
  label: string;
  href?: string;
  note?: ReactNode;
}

/*
 * The table at the top of every Surfaces page: which component implements
 * this concern in each host. "none" is a valid, honest cell.
 */
export function HostMatrix({
  primitive,
  desktop,
  terminal,
}: {
  primitive: HostCell | "none";
  desktop: HostCell | "none";
  terminal: HostCell | "none";
}) {
  const cells = [
    ["Primitive", primitive],
    ["Desktop", desktop],
    ["Terminal", terminal],
  ] as const;

  return (
    <table>
      <thead>
        <tr>
          <th>Host</th>
          <th>Implementation</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        {cells.map(([host, cell]) => (
          <tr key={host}>
            <td>{host}</td>
            <td>
              {cell === "none" ? (
                <em>none</em>
              ) : cell.href ? (
                <Link href={cell.href}>
                  <code>{cell.label}</code>
                </Link>
              ) : (
                <code>{cell.label}</code>
              )}
            </td>
            <td>{cell === "none" ? "" : cell.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
