import { Icon, type IconName } from "@nyte-ai/ui/icon";
import type { ReactNode } from "react";
import { Inline } from "./ui";

export interface Layer {
  readonly name: string;
  readonly icon: IconName;
  readonly files: string;
  readonly role: string;
  readonly href: string;
}

export function LayerStack({ layers }: { readonly layers: readonly Layer[] }) {
  return (
    <nav aria-label="Core layers, top to bottom" className="kernel-stack">
      {layers.map((layer) => (
        <a key={layer.name} href={layer.href} className="flex items-start gap-3">
          <Icon name={layer.icon} size={16} className="mt-1 shrink-0" />
          <span>
            <span className="flex flex-wrap items-baseline gap-x-3">
              <strong>{layer.name}</strong>
              <span className="font-mono text-xs text-muted-foreground">{layer.files}</span>
            </span>
            <span className="block text-sm text-muted-foreground">
              <Inline text={layer.role} />
            </span>
          </span>
        </a>
      ))}
    </nav>
  );
}

export function Cas(input: {
  readonly reason: string;
  readonly note?: string;
  readonly moves: readonly { readonly ref: string; readonly from: string; readonly to: string }[];
}) {
  return (
    <figure aria-label={`refs.update, ${input.reason}`} className="kernel-cas">
      <figcaption className="flex flex-wrap gap-2 text-muted-foreground">
        <span>refs.update</span>
        <span>"{input.reason}"</span>
        {input.note && <span className="ml-auto font-sans">{input.note}</span>}
      </figcaption>
      <table>
        <tbody>
          {input.moves.map((move) => (
            <tr key={move.ref}>
              <td>{move.ref}</td>
              <td>
                {move.from}{" "}
                <span className="text-muted-foreground">{move.from === move.to ? "=" : "→"}</span>{" "}
                {move.to}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function Trace({ children }: { readonly children: ReactNode }) {
  return <ol className="kernel-trace">{children}</ol>;
}

export function TraceStep(input: {
  readonly number: number;
  readonly title: string;
  readonly where: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <li>
      <div className="flex flex-wrap items-baseline gap-2">
        <span aria-hidden className="text-muted-foreground">
          {input.number}
        </span>
        <h3>{input.title}</h3>
        {input.where}
      </div>
      {input.children}
    </li>
  );
}
