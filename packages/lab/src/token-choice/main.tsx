import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/opsz.css";
import "../tokens/palette.css";
import "../shell/reset.css";
import { App } from "./app";
import { LabNav } from "../shell/lab-nav";

const root = document.getElementById("root");

if (root === null) throw new Error("index.html is missing #root");

createRoot(root).render(
  <StrictMode>
    <App />
    <LabNav current="/" />
  </StrictMode>,
);
