import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CoreGuide } from "./core-guide";
import { LabNav } from "./shell/lab-nav";
import "./tokens/palette.css";
import "./shell/reset.css";

const root = document.getElementById("root");

if (root === null) throw new Error("core.html is missing #root");

createRoot(root).render(
  <StrictMode>
    <CoreGuide />
    <LabNav current="/core" />
  </StrictMode>,
);
