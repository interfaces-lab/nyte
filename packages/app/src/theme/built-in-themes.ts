import type { VscodeTheme } from "./vscode-theme.ts";

export const BUILT_IN_THEMES: readonly VscodeTheme[] = [
  {
    name: "Pierre Light",
    scheme: "light",
    colors: {
      "editor.background": "#ffffff",
      "sideBar.background": "#f5f5f5",
      "editor.foreground": "#0a0a0a",
      "textLink.foreground": "#009fff",
    },
  },
  {
    name: "GitHub Light",
    scheme: "light",
    colors: {
      "editor.background": "#ffffff",
      "sideBar.background": "#f6f8fa",
      "editor.foreground": "#1f2328",
      "textLink.foreground": "#0969da",
    },
  },
  {
    name: "Catppuccin Latte",
    scheme: "light",
    colors: {
      "editor.background": "#eff1f5",
      "sideBar.background": "#e6e9ef",
      "editor.foreground": "#4c4f69",
      "textLink.foreground": "#1e66f5",
    },
  },
  {
    name: "Solarized Light",
    scheme: "light",
    colors: {
      "editor.background": "#fdf6e3",
      "sideBar.background": "#eee8d5",
      "editor.foreground": "#657b83",
      focusBorder: "#b49471",
    },
  },
  {
    name: "Pierre Dark",
    scheme: "dark",
    colors: {
      "editor.background": "#0a0a0a",
      "sideBar.background": "#171717",
      "editor.foreground": "#fafafa",
      "textLink.foreground": "#009fff",
    },
  },
  {
    name: "GitHub Dark",
    scheme: "dark",
    colors: {
      "editor.background": "#0d1117",
      "sideBar.background": "#010409",
      "editor.foreground": "#e6edf3",
      "textLink.foreground": "#2f81f7",
    },
  },
  {
    name: "Dracula",
    scheme: "dark",
    colors: {
      "editor.background": "#282a36",
      "sideBar.background": "#21222c",
      "editor.foreground": "#f8f8f2",
      focusBorder: "#6272a4",
    },
  },
  {
    name: "Catppuccin Mocha",
    scheme: "dark",
    colors: {
      "editor.background": "#1e1e2e",
      "sideBar.background": "#181825",
      "editor.foreground": "#cdd6f4",
      "textLink.foreground": "#89b4fa",
    },
  },
  {
    name: "Nord",
    scheme: "dark",
    colors: {
      "editor.background": "#2e3440",
      "sideBar.background": "#2e3440",
      "editor.foreground": "#d8dee9",
      "textLink.foreground": "#88c0d0",
    },
  },
  {
    name: "Tokyo Night",
    scheme: "dark",
    colors: {
      "editor.background": "#1a1b26",
      "sideBar.background": "#16161e",
      "editor.foreground": "#a9b1d6",
      "textLink.foreground": "#6183bb",
    },
  },
];
