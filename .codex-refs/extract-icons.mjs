import fs from "node:fs";
const [variantDir, ...names] = process.argv.slice(2);
for (const name of names) {
  const src = fs.readFileSync(`${variantDir}/${name}/index.js`, "utf8");
  // children of the icon: everything after ariaLabel:"...",maskId:"..."}
  const start = src.indexOf('maskId:"');
  const body = src.slice(start);
  const els = [...body.matchAll(/createElement\("(path|circle|rect|line|ellipse)",\{([^}]*)\}\)/g)]
    .filter((m) => !/mask:|fill:"#000"/.test(m[2]))
    .map((m) => {
      const attrs = m[2]
        .replace(/strokeWidth/g, "stroke-width").replace(/strokeLinecap/g, "stroke-linecap")
        .replace(/strokeLinejoin/g, "stroke-linejoin").replace(/fillRule/g, "fill-rule").replace(/clipRule/g, "clip-rule")
        .replace(/(\b[\w-]+):"([^"]*)"/g, '$1="$2"').replace(/,/g, " ");
      return `<${m[1]} ${attrs}/>`;
    });
  console.log(`<symbol id="${name}" viewBox="0 0 24 24" fill="none">${els.join("")}</symbol>`);
}
