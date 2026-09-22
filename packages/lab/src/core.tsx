import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CoreReview } from "./core-review";
import "./tokens/palette.css";
import "./shell/reset.css";

const root = document.getElementById("root");

if (root === null) throw new Error("core.html is missing #root");

createRoot(root).render(
  <StrictMode>
    <CoreReview />
  </StrictMode>,
);
