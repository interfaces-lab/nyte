import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <main className="mx-auto flex w-[min(100%,var(--site-inner))] flex-1 flex-col justify-center gap-3 px-(--site-pad) py-24">
      <h1 className="text-2xl font-medium">Page not found</h1>
      <p className="text-muted-foreground">
        This page moved or never existed.{" "}
        <Link to="/docs" className="text-foreground underline underline-offset-4">
          Read the docs
        </Link>
      </p>
    </main>
  );
}
