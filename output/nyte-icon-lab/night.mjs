export const marks = [
  {
    name: "Open interval",
    slug: "open-interval",
    note: "Two soft planes. One clear opening.",
    description:
      "A curved opening gives the mark its identity. The light sits between two surfaces, with enough contrast to hold at Dock size.",
  },
  {
    name: "Soft current",
    slug: "soft-current",
    note: "A continuous curve, moving upward.",
    description:
      "A rising ribbon carries the eye through the mark. The turn is broad and soft, with a darker underside to give it depth.",
  },
  {
    name: "First thought",
    slug: "first-thought",
    note: "A small glow above a quiet horizon.",
    description:
      "Light gathers at one edge of a dark field. This is the quietest direction, with the fewest shapes and the most open space.",
  },
];
export function renderMark(index = 0, light = 64, id = "nyte", size = 512) {
  const glow = Math.max(0, Math.min(100, light)) / 100;
  const shapes =
    [
      `<path d="M111 297 C128 203 209 141 294 153 C350 160 386 194 405 239 C342 212 296 224 254 271 C210 321 156 333 111 297Z" fill="url(#${id}-light)"/>
   <path d="M111 321 C173 364 228 327 270 284 C315 240 363 237 404 260 C391 327 333 378 268 383 C195 389 137 365 111 321Z" fill="url(#${id}-lower)"/>
   <path d="M118 311 C176 347 224 315 262 274 C306 231 352 226 400 250" stroke="#c9d7ff" stroke-opacity="${0.12 + glow * 0.32}" stroke-width="2" fill="none"/>`,
      `<path d="M123 353 C92 322 113 275 160 242 L300 142 C331 119 370 126 390 152 C412 182 397 210 367 234 L223 338 C188 365 155 380 123 353Z" fill="url(#${id}-lower)"/>
   <path d="M123 353 C156 354 186 326 214 294 L302 194 C330 162 360 145 390 152 C370 126 331 119 300 142 L160 242 C113 275 92 322 123 353Z" fill="url(#${id}-light)"/>
   <path d="M127 349 C160 350 188 321 213 294 L299 196" fill="none" stroke="#ecf0ff" stroke-width="1.5" stroke-opacity="${0.15 + glow * 0.3}"/>`,
      `<ellipse cx="266" cy="252" rx="140" ry="96" fill="url(#${id}-bloom)"/>
   <path d="M112 301 C167 273 217 236 267 234 C320 232 356 254 404 276 L404 324 C348 294 309 274 267 276 C215 278 168 317 112 342Z" fill="url(#${id}-light)"/>
   <path d="M110 326 C170 301 217 264 267 262 C320 260 357 282 406 305 L406 399 H110Z" fill="url(#${id}-night)"/>
   <path d="M112 325 C170 300 217 264 267 262 C320 260 357 282 404 304" fill="none" stroke="#d2ddff" stroke-opacity="${0.2 + glow * 0.42}" stroke-width="2"/>`,
    ][index] || "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512" role="img" aria-label="Nyte ${marks[index]?.name || "mark"}"><defs>
 <linearGradient id="${id}-tile" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#303750"/><stop offset=".65" stop-color="#1a2034"/><stop offset="1" stop-color="#151a2b"/></linearGradient>
 <linearGradient id="${id}-light" gradientUnits="userSpaceOnUse" x1="185" y1="160" x2="314" y2="355"><stop stop-color="#e2e9ff"/><stop offset=".4" stop-color="#c1d0ff"/><stop offset="1" stop-color="#819ee9"/></linearGradient>
 <linearGradient id="${id}-lower" gradientUnits="userSpaceOnUse" x1="154" y1="192" x2="329" y2="380"><stop stop-color="#6681c2"/><stop offset=".6" stop-color="#8ba8ef"/><stop offset="1" stop-color="#c7d5fc"/></linearGradient>
 <linearGradient id="${id}-night" gradientUnits="userSpaceOnUse" x1="240" y1="252" x2="260" y2="415"><stop stop-color="#303c5e"/><stop offset="1" stop-color="#1b2135"/></linearGradient>
 <radialGradient id="${id}-bloom"><stop stop-color="#b6c8fa" stop-opacity="${0.14 + glow * 0.48}"/><stop offset="1" stop-color="#7898eb" stop-opacity="0"/></radialGradient>
 <clipPath id="${id}-clip"><rect x="50" y="50" width="412" height="412" rx="91"/></clipPath>
 <filter id="${id}-shadow" x="-25%" y="-25%" width="150%" height="160%"><feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="#050919" flood-opacity=".25"/></filter>
 <filter id="${id}-depth" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#070c20" flood-opacity=".28"/></filter>
 </defs><rect x="50" y="50" width="412" height="412" rx="91" fill="url(#${id}-tile)" filter="url(#${id}-shadow)"/>
 <g clip-path="url(#${id}-clip)"><ellipse cx="255" cy="220" rx="195" ry="166" fill="url(#${id}-bloom)"/><g filter="url(#${id}-depth)" opacity="${0.78 + glow * 0.22}">${shapes}</g><rect x="50.75" y="50.75" width="410.5" height="410.5" rx="90" stroke="#d2ddff" stroke-opacity=".1" stroke-width="1.5" fill="none"/></g></svg>`;
}
