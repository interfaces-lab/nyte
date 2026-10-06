import type { Metadata } from "next";
import { SignedIn } from "./signed-in";

export const metadata: Metadata = {
  title: "Signed in",
  description: "Return to Nyte to finish signing in.",
  robots: { index: false },
};

export default function Page() {
  return (
    <main className="mx-auto flex w-[min(100%,var(--site-inner))] flex-1 flex-col justify-center px-(--site-pad) py-16">
      <SignedIn />
    </main>
  );
}
