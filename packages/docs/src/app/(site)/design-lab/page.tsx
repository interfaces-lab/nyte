import type { Metadata } from "next";
import { Lab } from "~/components/design-lab/lab";
import "~/components/design-lab/tokens.css";

export const metadata: Metadata = {
  title: "Design lab — Nyte",
  description:
    "The desktop shell rendered under two token models, so the difference on screen is the token layer and nothing else.",
  robots: { index: false, follow: false },
};

export default function DesignLab() {
  return <Lab />;
}
