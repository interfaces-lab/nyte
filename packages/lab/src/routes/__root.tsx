import { HeadContent, Outlet, createRootRoute } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { LabNav } from "../shell/lab-nav";

function LabLayout(): ReactElement {
  return (
    <>
      <HeadContent />
      <Outlet />
      <LabNav />
    </>
  );
}

export const rootRoute = createRootRoute({ component: LabLayout });
