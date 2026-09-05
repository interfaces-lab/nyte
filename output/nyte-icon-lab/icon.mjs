export const palettes = {
  chalk: { name: 'Chalk', base: '#252629', top: '#ebe8e1', bottom: '#bac7d7' },
  frost: { name: 'Frost', base: '#24272c', top: '#dee7ec', bottom: '#8fa8c4' },
  pearl: { name: 'Pearl', base: '#252525', top: '#f1ece4', bottom: '#cfcbc8' },
  ink: { name: 'Ink on ivory', base: '#eeece6', top: '#484b52', bottom: '#292d35' },
  bluepress: { name: 'Blue press', base: '#1646b9', top: '#fcf8ec', bottom: '#c5d5db', ink: '#193663', plate: '#ffdc00', sky: ['#27a5e6', '#1666d5', '#1535a4'] },
  yellowpress: { name: 'Yellow press', base: '#222324', top: '#f0e748', bottom: '#d2c83e', ink: '#222324', plate: '#2777c9' },
  newsprint: { name: 'Newsprint', base: '#eae3d0', top: '#343735', bottom: '#1d2526', ink: '#ddd6bd', plate: '#939eab' },
  nytetint: { name: 'Nyte Software tint', base: '#151724', top: '#d2ddff', bottom: '#7898eb', ink: '#6277b4', plate: '#b6c8fa', rim: '#d2ddff', shadowOpacity: .26, sky: ['#303750', '#242a42', '#191d30'] },
};

export const defaults = { footprint: 100, elevation: 0, moon: 'none', moonSize: 64, moonX: 340, moonY: 150, moonTurn: -25, lighting: 'print', softness: 50, puff: 50, tilt: 0, squash: 100, shape: 'valley', letter: 'none', slant: -24, finish: 'smooth', halftone: 55, registration: 4, wear: 0, palette: 'chalk', crop: 0, offset: 0, scale: 108, depth: 16, blend: 42, grain: 1, light: 315 };
export const studies = [
  { name: 'Soft cut', note: 'The starting point. Two broad peaks.', ...defaults },
  { name: 'Closer', note: 'A tighter crop with less sky.', ...defaults, crop: -42, scale: 121, blend: 27, depth: 10 },
  { name: 'Right drift', note: 'More space above the low shoulder.', ...defaults, offset: 68, crop: 22, light: 225, palette: 'frost' },
  { name: 'Paper', note: 'Nearly flat, with a quiet edge shadow.', ...defaults, palette: 'pearl', blend: 14, depth: 8, grain: 0, crop: -5 },
  { name: 'Soft shoulder', note: 'A rounded valley, slightly off center.', ...defaults, shape: 'round', offset: -22, crop: 5, blend: 32, light: 45 },
  { name: 'Reverse', note: 'A dark cloud on warm ivory.', ...defaults, palette: 'ink', blend: 28, depth: 12, grain: 0, scale: 114 },
  { name: 'Cloud N', note: 'The cloud shoulders become the stems of a soft N.', ...defaults, letter: 'cloud', scale: 100, blend: 35, depth: 12 },
  { name: 'Cut into the cloud', note: 'The original crop, with an N carved out of its face.', ...defaults, letter: 'cut', blend: 30, depth: 12 },
  { name: 'Quiet signature', note: 'A small inset N. The cloud stays the main shape.', ...defaults, letter: 'inset', blend: 30, depth: 12 },
  { name: 'Blue edition', note: 'Raised paper, worn ink, and a bright yellow edge over gradient blue.', ...defaults, finish: 'press', palette: 'bluepress', grain: 4, blend: 12, depth: 14, wear: 35 },
  { name: 'Yellow edition', note: 'A cloud-shaped N with halftone ink and a hard shadow.', ...defaults, finish: 'press', palette: 'yellowpress', letter: 'cloud', scale: 100, grain: 3, blend: 5, depth: 18, registration: 6 },
  { name: 'Morning paper', note: 'One-color ink on warm paper. A quieter print treatment.', ...defaults, finish: 'press', palette: 'newsprint', grain: 4, blend: 8, depth: 10, registration: 2, halftone: 38, shape: 'round' },
  { name: 'Slanted N', note: 'A wide diagonal fold between two cropped cloud shoulders.', ...defaults, finish: 'press', palette: 'bluepress', letter: 'slanted', scale: 124, crop: 8, grain: 4, blend: 39, depth: 14, wear: 5, registration: 0, halftone: 49 },
  { name: 'Nyte tint', note: 'Round cloud shoulders, pale periwinkle light, and a soft blue underside.', ...defaults, shape: 'billow', finish: 'press', palette: 'nytetint', halftone: 0, registration: 0, wear: 0, crop: 65, offset: 65, scale: 104, depth: 16, blend: 72, grain: 0 },
];

// Study 14's saved color and material settings anchor the composition studies.
studies.push(...[
  { name: 'Cloud stamp', note: 'One complete cloud, centered with a generous navy border.', shape: 'stamp', scale: 100, offset: 0, crop: 0, depth: 10, blend: 55 },
  { name: 'Room to breathe', note: 'A smaller cloud floats inside the tile. More space gives the silhouette weight.', shape: 'stamp', scale: 85, offset: 0, crop: -18, depth: 12 },
  { name: 'Low tide', note: 'A large cloud sits low and spills through the left edge.', shape: 'stamp', scale: 145, offset: -22, crop: 110, depth: 10 },
  { name: 'Passing through', note: 'The cloud enters from the right, leaving a broad pocket of open sky.', shape: 'stamp', scale: 145, offset: 104, crop: -65, depth: 10 },
  { name: 'Arc rhythm', note: 'Three round arches, separated by narrow sky cuts. The most geometric direction.', shape: 'arches', scale: 100, offset: 0, crop: 0, depth: 6, blend: 32 },
  { name: 'Cloud layers', note: 'Two staggered cloud banks, separated by a slim ribbon of sky.', shape: 'banks', scale: 100, offset: 0, crop: 0, depth: 12, blend: 65 },
].map(study => ({ ...studies[13], ...study })));

studies.push(...[
  { name: 'Peekaboo', note: 'A little cloud peeking up from the corner. Try turning up the puff.', puff: 80, tilt: -12, squash: 105, offset: 92, crop: 96, scale: 104 },
  { name: 'Pillow pile', note: 'Three uneven pillows, squeezed into the frame.', puff: 95, tilt: 7, squash: 118, offset: -20, crop: 34, scale: 98 },
  { name: 'Sleepy stretch', note: 'A low, lazy cloud stretching across the tile.', puff: 35, tilt: -5, squash: 66, offset: 0, crop: 55, scale: 114 },
  { name: 'Tumble', note: 'A cloud caught mid-roll. Tilt it until it feels right.', puff: 68, tilt: 29, squash: 108, offset: 32, crop: 25, scale: 112 },
].map(study => ({ ...studies[13], shape: 'play', depth: 13, ...study })));

studies.push(...[
  { name: 'Up all night', note: 'A climbing diagonal, with a broad light from the upper left.', shape:'billow', tilt:-32, crop:70, offset:45, squash:110, light:225, softness:85 },
  { name: 'Other side', note: 'The same cloud and crop, lit from the lower right. Compare the depth.', shape:'billow', tilt:-32, crop:70, offset:45, squash:110, light:45, softness:40 },
  { name: 'Cloud slide', note: 'Three puffs sliding toward the corner, caught by a light from the upper right.', shape:'play', puff:65, tilt:35, crop:55, offset:-30, squash:85, light:315, softness:70 },
  { name: 'Low glow', note: 'The same diagonal puffs, with soft light rising from below.', shape:'play', puff:65, tilt:35, crop:55, offset:-30, squash:85, light:90, softness:95 },
  { name: 'Side light', note: 'A tall diagonal shoulder with a close light on its left edge.', shape:'billow', tilt:-52, crop:25, offset:65, squash:120, light:180, softness:20 },
  { name: 'Soft landing', note: 'A low cloud, tipped gently into a broad pool of light.', shape:'play', puff:40, tilt:18, crop:90, offset:0, squash:75, light:270, softness:100 },
].map(study => ({ ...studies[13], lighting:'directional', depth:22, blend:90, ...study })));

studies.push(...[
  { name:'Corner nap', note:'Just one soft shoulder peeks into a large field of navy.', shape:'billow', tilt:-42, crop:108, offset:120, scale:125, squash:72, light:225, softness:95 },
  { name:'Overhead', note:'A cloud hangs from the top edge, lit softly from below.', shape:'billow', tilt:174, crop:-45, offset:-15, scale:112, squash:95, light:90, softness:90 },
  { name:'Left awake', note:'A near-vertical cloud occupies the left edge. Light arrives from the right.', shape:'play', puff:38, tilt:92, crop:0, offset:-70, scale:100, squash:95, light:0, softness:45 },
  { name:'Right awake', note:'The opposite edge, with a broad light coming from the left.', shape:'play', puff:38, tilt:-92, crop:0, offset:70, scale:100, squash:95, light:180, softness:80 },
  { name:'Big soft thing', note:'An oversized rounded shoulder and a tiny corner of open sky.', shape:'billow', tilt:-24, crop:-65, offset:112, scale:145, squash:125, light:315, softness:100 },
  { name:'Diagonal hush', note:'A compressed bank running across the tile on a steep diagonal.', shape:'play', puff:25, tilt:55, crop:50, offset:-20, scale:115, squash:58, light:135, softness:60 },
  { name:'Under the covers', note:'A deep upper cloud with a slim pocket of sky beneath it.', shape:'play', puff:65, tilt:155, crop:75, offset:-35, scale:125, squash:115, light:45, softness:85 },
  { name:'Little lift', note:'A low row of puffs lifting gently from the bottom right.', shape:'play', puff:88, tilt:-18, crop:110, offset:105, scale:90, squash:62, light:270, softness:30 },
].map(study => ({ ...studies[13], lighting:'directional', depth:24, blend:95, ...study })));

studies.push(
  {...studies[13],name:'Moon tucked in',note:'A crescent rests behind the cloud shoulder, sharing its soft blue light.',moon:'crescent',moonSize:88,moonX:322,moonY:196,moonTurn:-25},
  {...studies[30],name:'A little moon',note:'A small crescent sits in the open sky above the diagonal cloud.',moon:'crescent',moonSize:49,moonX:178,moonY:155,moonTurn:-15},
  {...studies[13],name:'Almost hidden',note:'A full moon slips behind the cloud, leaving just a bright cap.',moon:'full',moonSize:84,moonX:366,moonY:205,moonTurn:0},
  {...studies[24],name:'Moonrise',note:'A larger crescent meets the rising edge. Adjust its position to change the overlap.',moon:'crescent',moonSize:104,moonX:252,moonY:225,moonTurn:25}
);

studies.push(...[
  { name:'A wink of night', note:'A tiny crescent above a broad cloud. Small, clear, and playful.', shape:'billow', tilt:-8, crop:85, offset:45, moon:'crescent', moonSize:44, moonX:160, moonY:123, moonTurn:-30, light:225, softness:85 },
  { name:'Moon hammock', note:'A larger crescent settles into the dip between two cloud shoulders.', shape:'billow', tilt:8, crop:78, offset:55, moon:'crescent', moonSize:106, moonX:275, moonY:190, moonTurn:35, light:315, softness:95 },
  { name:'Late bloomer', note:'A light crescent floats over a low, squished row of cloud puffs.', shape:'play', puff:70, tilt:-14, squash:65, crop:105, offset:20, moon:'crescent', moonSize:68, moonX:330, moonY:140, moonTurn:-65, light:270, softness:75 },
  { name:'Under a blanket', note:'An overhead cloud hides the top of a moon hanging beneath it.', shape:'billow', tilt:175, crop:-55, offset:0, moon:'crescent', moonSize:72, moonX:300, moonY:365, moonTurn:145, light:90, softness:90 },
  { name:'Night visitor', note:'A crescent meets the edge of a vertical cloud bank.', shape:'play', puff:35, tilt:90, crop:0, offset:-80, moon:'crescent', moonSize:84, moonX:330, moonY:200, moonTurn:-20, light:0, softness:55 },
  { name:'A soft embrace', note:'A tall cloud wraps around a crescent on the other side of the tile.', shape:'billow', tilt:-88, crop:0, offset:55, moon:'crescent', moonSize:110, moonX:195, moonY:215, moonTurn:155, light:180, softness:95 },
  { name:'Half a secret', note:'A full moon, partly hidden by the cloud. A clean circle against a soft contour.', shape:'billow', tilt:0, crop:65, offset:65, moon:'full', moonSize:112, moonX:268, moonY:205, moonTurn:0, light:225, softness:85 },
  { name:'Out of frame', note:'A lighter cloud and cropped moon, lifted gently inside a macOS-sized canvas.', shape:'play', puff:20, tilt:12, squash:60, crop:105, offset:-30, scale:96, moon:'full', moonSize:104, moonX:446, moonY:106, moonTurn:0, light:315, softness:70, depth:24, blend:70, footprint:86, elevation:12 },
].map(study => ({ ...studies[13], lighting:'directional', depth:18, blend:85, ...study })));

const paths = {
  stamp: 'M 151 332 C 116 332 88 307 88 275 C 88 243 112 218 144 214 C 157 170 193 145 237 145 C 284 145 323 178 332 224 C 375 218 408 246 408 280 C 408 310 384 332 351 332 Z',
  arches: 'M 93 332 V 264 A 54 54 0 0 1 201 264 V 332 Z M 213 332 V 207 A 54 54 0 0 1 321 207 V 332 Z M 333 332 V 274 A 43 43 0 0 1 419 274 V 332 Z',
  banks: 'M 123 249 C 98 249 79 232 79 210 C 79 188 96 172 118 170 C 127 140 151 124 181 124 C 213 124 239 147 245 177 C 274 173 296 191 296 214 C 296 235 280 249 258 249 Z M 203 421 C 171 421 148 399 148 370 C 148 343 168 321 196 317 C 207 280 238 260 275 260 C 315 260 347 288 354 326 C 391 321 419 345 419 374 C 419 400 398 421 370 421 Z',
  billow: 'M -200 352 C -134 171 -52 95 38 117 C 89 130 117 155 146 181 C 162 196 173 203 187 203 C 204 203 215 190 233 173 C 270 139 311 115 362 109 C 472 99 559 181 636 320 L 750 800 L -250 800 Z',
  valley: 'M -210 350 C -140 149 -51 69 38 107 C 98 132 139 182 174 231 C 221 174 278 124 342 112 C 461 87 560 153 630 306 L 750 800 L -250 800 Z',
  round: 'M -200 352 C -134 171 -52 95 38 117 C 93 130 126 161 155 200 C 166 215 174 215 185 199 C 226 140 289 100 362 109 C 472 120 559 181 636 320 L 750 800 L -250 800 Z',
  wide: 'M -220 320 C -143 149 -59 86 32 122 C 89 144 118 188 152 228 C 217 161 279 133 351 130 C 469 125 559 187 650 320 L 750 800 L -250 800 Z',
};

// Squircle, cloud path, and lighting are shared by previews and exported assets.
export function renderIcon(settings = defaults, id = 'nyte', size = 512) {
  const s = { ...defaults, ...settings };
  const p = palettes[s.palette] || palettes.chalk;
  const press = s.finish === 'press';
  const directional = s.lighting === 'directional';
  const worn = press && s.wear > 0;
  const sky = press && p.sky;
  // Fixed coordinates keep the print wear identical across sizes and exports.
  let randomState = 7319;
  const random = () => { randomState = (Math.imul(randomState,1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
  const scratches = worn ? Array.from({length:290}, () => {
    const x = (random()*512).toFixed(2), y = (random()*512).toFixed(2);
    const length = (.35 + random()*2.8).toFixed(2), rise = (random()*1.3-.65).toFixed(2);
    return `M${x} ${y}l${length} ${rise}`;
  }).join('') : '';
  const tile = 'M 132 16 H 380 C 454 16 496 58 496 132 V 380 C 496 454 454 496 380 496 H 132 C 58 496 16 454 16 380 V 132 C 16 58 58 16 132 16 Z';
  const angle = s.light * Math.PI / 180;
  const lx = Math.cos(angle), ly = Math.sin(angle);
  const x1 = 50 + lx * 50, y1 = 50 + ly * 50;
  const x2 = 50 - lx * 50, y2 = 50 - ly * 50;
  const dx = (-lx * s.depth * .22).toFixed(2), dy = (-ly * s.depth * .22).toFixed(2);
  const transform = `translate(${s.offset} ${s.crop}) translate(256 256) scale(${s.scale / 100}) translate(-256 -256)`;
  const cloudN = 'M -20 550 V 220 C -20 142 17 104 65 104 C 103 104 132 126 164 172 L 342 393 V 180 C 342 132 378 106 423 106 C 477 106 521 151 521 207 V 550 H 401 L 161 257 V 550 Z';
  const isCloudN = s.letter === 'cloud' || s.letter === 'slanted';
  const puff = s.puff / 100;
  const playful = `M -200 700 V 300 C -170 205 -82 177 -25 235 C -26 ${190-puff*90} 37 ${123-puff*75} 99 ${169-puff*65} C 129 ${187-puff*65} 144 ${216-puff*50} 145 230 C 172 ${154-puff*75} 236 ${122-puff*75} 300 ${167-puff*65} C 332 ${190-puff*65} 343 225 342 242 C 398 ${181-puff*70} 472 ${201-puff*45} 515 268 C 570 235 625 287 670 345 V 700 Z`;
  const cloud = `<path d="${isCloudN ? cloudN : s.shape === 'play' ? playful : paths[s.shape] || paths.valley}" transform="${transform} rotate(${s.tilt} 256 256) translate(0 ${256*(1-s.squash/100)}) scale(1 ${s.squash/100})${s.letter === 'slanted' ? ` rotate(${s.slant} 256 256)` : ''}"/>`;
  const n = 'M 0 140 V 17 Q 0 0 17 0 Q 27 0 34 10 L 100 94 V 16 Q 100 0 116 0 Q 132 0 132 16 V 123 Q 132 140 116 140 Q 106 140 99 131 L 32 46 V 140 Z';
  const letterTransform = s.letter === 'inset' ? 'translate(338 343) scale(.58)' : 'translate(225 290) scale(.9)';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512" role="img" aria-label="Nyte cropped cloud app icon">
  <defs>
    <mask id="${id}-moon-cut" maskUnits="userSpaceOnUse" x="-180" y="-180" width="360" height="360"><circle r="${s.moonSize}" fill="white"/>${s.moon === 'crescent' ? `<circle cx="${s.moonSize*.58}" cy="${-s.moonSize*.28}" r="${s.moonSize*.96}" fill="black"/>` : ''}</mask>
    <linearGradient id="${id}-moon-tone" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f1f4ff"/><stop offset=".55" stop-color="${p.top}"/><stop offset="1" stop-color="${s.elevation ? p.bottom : p.top}"/></linearGradient>
    <clipPath id="${id}-tile"><path d="${tile}"/></clipPath>
    <clipPath id="${id}-cloud">${cloud}</clipPath>
    ${sky ? `<linearGradient id="${id}-sky" gradientUnits="userSpaceOnUse" x1="${directional ? x1*5.12 : 0}" y1="${directional ? y1*5.12 : 0}" x2="${directional ? x2*5.12 : 512}" y2="${directional ? y2*5.12 : 220}"><stop stop-color="${p.sky[0]}"/><stop offset=".48" stop-color="${p.sky[1]}"/><stop offset="1" stop-color="${p.sky[2]}"/></linearGradient>` : ''}
    <pattern id="${id}-dots" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx="2.5" cy="2.5" r="1.25" fill="${p.ink || '#25272a'}"/></pattern>
    <linearGradient id="${id}-dot-fade" gradientUnits="userSpaceOnUse" x1="${x1 * 5.12}" y1="${y1 * 5.12}" x2="${x2 * 5.12}" y2="${y2 * 5.12}"><stop stop-color="white" stop-opacity=".04"/><stop offset=".38" stop-color="white" stop-opacity=".16"/><stop offset="1" stop-color="white"/></linearGradient>
    <radialGradient id="${id}-corner" gradientUnits="userSpaceOnUse" cx="35" cy="491" r="325"><stop stop-color="white"/><stop offset=".3" stop-color="white" stop-opacity=".9"/><stop offset=".7" stop-color="white" stop-opacity=".23"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient>
    <mask id="${id}-screen" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect width="512" height="512" fill="url(#${id}-${sky ? 'corner' : 'dot-fade'})"/></mask>
    <mask id="${id}-cut" maskUnits="userSpaceOnUse" x="-256" y="-256" width="1024" height="1280"><rect x="-256" y="-256" width="1024" height="1280" fill="white"/>${s.letter === 'cut' ? `<path d="${n}" transform="${letterTransform}" fill="black"/>` : ''}</mask>
    <linearGradient id="${id}-tone" gradientUnits="userSpaceOnUse" x1="${x1 * 5.12}" y1="${y1 * 5.12}" x2="${x2 * 5.12}" y2="${y2 * 5.12}">
      <stop stop-color="${p.top}"/><stop offset=".4" stop-color="${p.top}"/><stop offset="1" stop-color="${p.bottom}"/>
    </linearGradient>
    <linearGradient id="${id}-rim" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".2"/><stop offset=".5" stop-color="#fff" stop-opacity=".025"/><stop offset="1" stop-color="#000" stop-opacity=".13"/></linearGradient>
    <filter id="${id}-moon-shadow" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feDropShadow dx="${s.elevation*.2}" dy="${s.elevation*.45}" stdDeviation="${s.elevation*.4}" flood-color="#060d24" flood-opacity="${s.elevation ? .3 : 0}"/></filter>
    <filter id="${id}-base-shadow" x="-25%" y="-25%" width="150%" height="160%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="${5+s.elevation*.45}" stdDeviation="${5+s.elevation*.25}" flood-opacity="${s.elevation ? .22 : .15}"/>
    </filter>
    <filter id="${id}-edge" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
      <feDropShadow dx="${directional ? -lx*s.depth*.55 : press ? s.depth * .35 : dx}" dy="${directional ? -ly*s.depth*.55 : press ? -s.depth * (sky ? .65 : .3) : dy}" stdDeviation="${directional ? .5+s.depth*s.softness/100*.65 : press ? (sky ? s.depth * .34 : .35) : Math.max(.1, s.depth * .22)}" flood-color="#080b12" flood-opacity="${s.depth ? (press ? p.shadowOpacity ?? .7 : .12 + s.depth / 180) : 0}"/>
    </filter>
    <filter id="${id}-worn" filterUnits="userSpaceOnUse" x="-16" y="-16" width="544" height="544" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency=".11 .24" numOctaves="2" seed="8" result="roughness"/>
      <feDisplacementMap in="SourceGraphic" in2="roughness" scale="${s.wear * .085}" xChannelSelector="R" yChannelSelector="G"/>
      <feGaussianBlur stdDeviation="${s.wear * .009}"/>
    </filter>
    <filter id="${id}-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".88" numOctaves="3" seed="19" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
  </defs>
  <g transform="translate(256 256) scale(${s.footprint/100}) translate(-256 -256)">
  <path d="${tile}" fill="${sky ? `url(#${id}-sky)` : p.base}" filter="url(#${id}-base-shadow)"/>
  <g clip-path="url(#${id}-tile)">
    ${s.moon !== 'none' ? `<g transform="translate(${s.moonX} ${s.moonY}) rotate(${s.moonTurn})"><circle r="${s.moonSize}" fill="url(#${id}-moon-tone)" mask="url(#${id}-moon-cut)" filter="url(#${id}-moon-shadow)"/></g>` : ''}
    ${worn ? `<rect width="512" height="512" filter="url(#${id}-grain)" opacity="${s.wear * .0016}" style="mix-blend-mode:soft-light"/><path d="${scratches}" fill="none" stroke="#12254e" stroke-width=".65" stroke-linecap="round" opacity="${s.wear * .003}"/>` : ''}
    <g ${worn ? `filter="url(#${id}-worn)"` : ''}>
    ${press ? `<g fill="${p.top}" filter="url(#${id}-edge)" mask="url(#${id}-cut)">${cloud}</g>` : ''}
    ${press ? `<g transform="translate(${s.registration} ${-s.registration})" fill="${p.plate || '#648da9'}" stroke="${p.plate || '#648da9'}" stroke-width="7" stroke-linejoin="round">${cloud}</g>` : ''}
    <g ${press ? '' : `filter="url(#${id}-edge)"`} mask="url(#${id}-cut)">
      ${press ? `<g fill="none" stroke="${p.rim || '#f5f0de'}" stroke-width="6" stroke-linejoin="round">${cloud}</g>` : ''}
      <g fill="${p.top}">${cloud}</g>
      <g fill="url(#${id}-tone)" opacity="${s.blend / 100}">${cloud}</g>
    </g>
    ${press ? `<g clip-path="url(#${id}-cloud)" mask="url(#${id}-cut)"><rect width="512" height="512" fill="url(#${id}-dots)" opacity="${s.halftone / 100}" mask="url(#${id}-screen)"/></g>` : ''}
    ${s.grain > 0 ? `<g clip-path="url(#${id}-cloud)" mask="url(#${id}-cut)" opacity="${s.grain / 100}"><rect x="0" y="0" width="512" height="512" filter="url(#${id}-grain)" style="mix-blend-mode:multiply"/></g>` : ''}
    ${s.letter === 'inset' ? `<g clip-path="url(#${id}-cloud)"><path d="${n}" transform="translate(0 1.5) ${letterTransform}" fill="white" opacity=".4"/><path d="${n}" transform="${letterTransform}" fill="${p.base}" opacity=".32"/></g>` : ''}
    ${worn ? `<g clip-path="url(#${id}-cloud)" mask="url(#${id}-cut)"><path d="${scratches}" fill="none" stroke="${p.ink || '#283043'}" stroke-width="1.05" stroke-linecap="round" opacity="${s.wear * .009}" mask="url(#${id}-screen)"/></g>` : ''}
    </g>
    <path d="${tile}" fill="none" stroke="url(#${id}-rim)" stroke-width="2"/>
  </g>
  </g>
</svg>`;
}
