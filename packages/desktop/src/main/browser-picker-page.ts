import { HTML_CHARS } from "../shared/browser-picker.ts";

export const PICKER_SCRIPT = `(() => {
  const open = window.__nytePick;
  if (typeof open === "function") {
    open();
    return Promise.resolve(JSON.stringify({ kind: "cancelled" }));
  }
  const accent = "#3884ff";
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;border:2px solid " + accent + ";background:rgba(56,132,255,.12);border-radius:2px;display:none";
  const tag = document.createElement("div");
  tag.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;font:12px/16px ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;background:" + accent + ";padding:1px 4px;border-radius:2px;display:none;max-width:60vw;overflow:hidden;white-space:nowrap;text-overflow:ellipsis";
  document.documentElement.append(box, tag);
  const step = (element) => {
    if (element.id) return "#" + CSS.escape(element.id);
    let part = element.localName;
    for (const name of [...element.classList].slice(0, 2)) part += "." + CSS.escape(name);
    const parent = element.parentElement;
    if (parent !== null && [...parent.children].filter((child) => child.matches(part)).length > 1) {
      const same = [...parent.children].filter((child) => child.localName === element.localName);
      part += ":nth-of-type(" + String(same.findIndex((child) => child === element) + 1) + ")";
    }
    return part;
  };
  const selectorFor = (element) => {
    const parts = [];
    for (let node = element; node !== null && node !== document.documentElement; node = node.parentElement) {
      parts.unshift(step(node));
      const selector = parts.join(" > ");
      try {
        if (document.querySelectorAll(selector).length === 1) return selector;
      } catch {}
    }
    return parts.join(" > ") || element.localName;
  };
  let current = null;
  const show = (element) => {
    if (element === null || element === box || element === tag) return;
    current = element;
    const rect = element.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: rect.left + "px", top: rect.top + "px", width: rect.width + "px", height: rect.height + "px" });
    tag.textContent = step(element);
    Object.assign(tag.style, { display: "block", top: (rect.top >= 20 ? rect.top - 20 : rect.bottom + 2) + "px" });
    tag.style.left = Math.max(0, Math.min(rect.left, window.innerWidth - tag.offsetWidth - 2)) + "px";
  };
  const block = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };
  const trusted = (listener) => (event) => {
    if (event.isTrusted) listener(event);
  };
  return new Promise((resolve) => {
    const finish = (result) => {
      for (const [type, listener] of listeners) window.removeEventListener(type, listener, true);
      box.remove();
      tag.remove();
      delete window.__nytePick;
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(JSON.stringify(result))));
    };
    const pick = () => {
      if (current === null) return;
      const rect = current.getBoundingClientRect();
      const html = current.outerHTML;
      finish({
        kind: "picked",
        selector: selectorFor(current),
        html: html.length > ${HTML_CHARS} ? html.slice(0, ${HTML_CHARS}) + "…" : html,
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      });
    };
    const listeners = [
      ["mousemove", trusted((event) => show(document.elementFromPoint(event.clientX, event.clientY)))],
      ["pointerdown", block],
      ["mousedown", block],
      ["pointerup", block],
      ["mouseup", block],
      ["click", trusted((event) => {
        block(event);
        show(document.elementFromPoint(event.clientX, event.clientY));
        pick();
      })],
      ["keydown", trusted((event) => {
        if (event.key === "Escape") {
          block(event);
          finish({ kind: "cancelled" });
        } else if (event.key === "Enter") {
          block(event);
          pick();
        } else if (event.key === "ArrowUp" && current?.parentElement && current.parentElement !== document.documentElement) {
          block(event);
          show(current.parentElement);
        } else if (event.key === "ArrowDown" && current?.firstElementChild) {
          block(event);
          show(current.firstElementChild);
        }
      })],
    ];
    for (const [type, listener] of listeners) window.addEventListener(type, listener, true);
    window.__nytePick = () => finish({ kind: "cancelled" });
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body) show(focused);
  });
})()`;
