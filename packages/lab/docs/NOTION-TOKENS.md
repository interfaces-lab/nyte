# Notion Calendar tokens, audited

Extracted from the shipped bundles and verified value by value: 198 of 198 ramp
values exact across both modes, no light/dark swaps.

- ramps, surfaces, text, icons, strokes, shadows, hover/pressed: `cron-D7Buzshw.js`
- the material: `App-BLvN7Ea0.js`, the `data-floating-context-panel` element
- easings and weights: `AgentChat-*.css`, a newer Tailwind generation Notion
  keeps separate from `--nds-*`

Anything not listed here is DERIVED and must be marked as such in code.

## The material

| | light | dark |
| --- | --- | --- |
| fill | `rgba(255,255,255,.8)` | `rgba(32,32,32,.9)` |
| backdrop-filter | `blur(12px)` | `blur(12px) brightness(120%)` |
| border | `1px solid` stroke-secondary | same |
| background-clip | `padding-box` | `border-box` |
| box-shadow | shadow-md | shadow-lg |
| border-radius | `12px` | `12px` |

## Surfaces

| token | light | dark |
| --- | --- | --- |
| `surface-page` | `rgba(255,255,255,1)` | `rgba(25,25,25,1)` |
| `surface-wash` | `rgba(248,248,247,1)` | `rgba(32,32,32,1)` |
| `surface-elevated` | `rgba(255,255,255,1)` | `rgba(37,37,37,1)` |
| `surface-contrast` | `rgba(29,27,22,1)` | `rgba(37,37,37,1)` |

## Text and icons

| token | light | dark |
| --- | --- | --- |
| `text-primary` | `rgba(50,48,44,1)` | `rgba(255,255,255,0.81)` |
| `text-secondary` | `rgba(120,119,116,1)` | `rgba(255,255,255,0.445)` |
| `text-tertiary` | `rgba(70,68,64,0.45)` | `rgba(255,255,255,0.283)` |
| `text-quaternary` | `rgba(81,73,60,0.32)` | `rgba(255,255,255,0.13)` |
| `icon-primary` | `rgba(50,48,44,1)` | `rgba(255,255,255,0.81)` |
| `icon-secondary` | `rgba(71,70,68,0.6)` | `rgba(255,255,255,0.445)` |
| `icon-tertiary` | `rgba(81,73,60,0.32)` | `rgba(255,255,255,0.283)` |
| `icon-quaternary` | `rgba(84,72,49,0.15)` | `rgba(255,255,255,0.13)` |

## Strokes and states

| token | light | dark |
| --- | --- | --- |
| `stroke-primary` | `rgba(84,72,49,0.15)` | `rgba(255,255,255,0.13)` |
| `stroke-secondary` | `rgba(84,72,49,0.08)` | `rgba(255,255,255,0.055)` |
| `stroke-input` | `rgba(0,0,0,0.15)` | `rgba(255,255,255,0.2)` |
| `state-hover` | `rgba(0,0,0,.04)` | `rgba(255,255,255,.05)` |
| `state-pressed` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.08)` |

Notion ships no selected state. Any selected step is DERIVED.

## Shadows

| token | light | dark |
| --- | --- | --- |
| `shadow-2xs` | `0 0 0 1px rgba(84,72,49,0.15)` | `0 0 0 1px rgba(255,255,255,0.095)` |
| `shadow-xs` | `0px 2px 4px 0 rgba(0,0,0,0.04)` | `0px 2px 4px 0 rgba(0,0,0,0.08)` |
| `shadow-sm` | `0px 4px 12px -2px rgba(0,0,0,0.08)` | `0px 4px 12px -2px rgba(0,0,0,0.16)` |
| `shadow-md` | `0px 14px 28px -6px rgba(0,0,0,0.10), 0px 2px 4px -1px rgba(0,0,0,0.06)` | `0px 14px 28px -6px rgba(0,0,0,0.20), 0px 2px 4px -1px rgba(0,0,0,0.12)` |
| `shadow-lg` | `0px 24px 48px -8px rgba(0,0,0,0.24), 0px 4px 12px -1px rgba(0,0,0,0.12)` | `0px 24px 48px -8px rgba(0,0,0,0.48), 0px 4px 12px -1px rgba(0,0,0,0.24)` |

## Radius, easing, weight

`--radius-{0,2,4,6,8,10,12,14,16,20,24,full}` at their face values.

`--ease-default: cubic-bezier(.45,0,.55,1)`, `--ease-enter: cubic-bezier(.33,1,.68,1)`,
`--ease-exit: cubic-bezier(.55,0,.45,1)`.

Weights: 450 regular, 550 medium, 650 semibold, 700 bold.

## Ramps

Nine hues, eleven steps. In light, 30 and 100-400 are alpha and 50 and 500-900
are solid. Dark inverts this on 63 of 198 steps and its gray ramp is solid
throughout, so do not state the pattern as a system property.

| step | light | dark |
| --- | --- | --- |
| `gray-30` | `rgba(84,72,49,0.04)` | `rgba(21,21,21,1)` |
| `gray-50` | `rgba(248,248,247,1)` | `rgba(25,25,25,1)` |
| `gray-100` | `rgba(84,72,49,0.15)` | `rgba(32,32,32,1)` |
| `gray-200` | `rgba(81,73,60,0.32)` | `rgba(37,37,37,1)` |
| `gray-300` | `rgba(70,68,64,0.45)` | `rgba(47,47,47,1)` |
| `gray-400` | `rgba(71,70,68,0.6)` | `rgba(55,55,55,1)` |
| `gray-500` | `rgba(120,119,116,1)` | `rgba(90,90,90,1)` |
| `gray-600` | `rgba(95,94,91,1)` | `rgba(127,127,127,1)` |
| `gray-700` | `rgba(72,71,67,1)` | `rgba(155,155,155,1)` |
| `gray-800` | `rgba(50,48,44,1)` | `rgba(211,211,211,1)` |
| `gray-900` | `rgba(29,27,22,1)` | `rgba(255,255,255,1)` |
| `blue-30` | `rgba(91,166,209,0.07)` | `rgba(203,230,247,1)` |
| `blue-50` | `rgba(231,243,248,1)` | `rgba(51,126,169,0.08)` |
| `blue-100` | `rgba(93,165,206,0.27)` | `rgba(29,40,46,1)` |
| `blue-200` | `rgba(57,135,184,0.4)` | `rgba(51,126,169,0.2)` |
| `blue-300` | `rgba(63,137,184,0.65)` | `rgba(20,58,78,1)` |
| `blue-400` | `rgba(54,129,177,0.82)` | `rgba(51,126,169,0.5)` |
| `blue-500` | `rgba(51,126,169,1)` | `rgba(51,126,169,0.65)` |
| `blue-600` | `rgba(45,99,135,1)` | `rgba(51,126,169,0.82)` |
| `blue-700` | `rgba(31,74,104,1)` | `rgba(51,126,169,0.91)` |
| `blue-800` | `rgba(24,51,71,1)` | `rgba(56,142,191,1)` |
| `blue-900` | `rgba(12,29,43,1)` | `rgba(55,154,211,1)` |
| `red-30` | `rgba(243,136,118,0.07)` | `rgba(253,218,218,1)` |
| `red-50` | `rgba(253,235,236,1)` | `rgba(222,85,88,0.1)` |
| `red-100` | `rgba(244,171,159,0.4)` | `rgba(54,36,34,1)` |
| `red-200` | `rgba(215,38,21,0.32)` | `rgba(222,85,85,0.25)` |
| `red-300` | `rgba(215,38,21,0.5)` | `rgba(82,46,42,1)` |
| `red-400` | `rgba(215,38,21,0.68)` | `rgba(222,85,83,0.45)` |
| `red-500` | `rgba(212,76,71,1)` | `rgba(222,85,82,0.6)` |
| `red-600` | `rgba(174,47,46,1)` | `rgba(222,85,81,0.8)` |
| `red-700` | `rgba(134,33,32,1)` | `rgba(222,85,80,0.91)` |
| `red-800` | `rgba(93,23,21,1)` | `rgba(222,85,80,1)` |
| `red-900` | `rgba(48,19,15,1)` | `rgba(223,84,82,1)` |
| `green-30` | `rgba(123,183,129,0.07)` | `rgba(215,232,217,1)` |
| `green-50` | `rgba(237,243,236,1)` | `rgba(45,153,100,0.08)` |
| `green-100` | `rgba(123,183,129,0.27)` | `rgba(34,43,38,1)` |
| `green-200` | `rgba(80,144,103,0.4)` | `rgba(45,153,100,0.2)` |
| `green-300` | `rgba(80,144,103,0.65)` | `rgba(36,61,48,1)` |
| `green-400` | `rgba(66,133,90,0.82)` | `rgba(45,153,100,0.5)` |
| `green-500` | `rgba(68,131,97,1)` | `rgba(44,167,106,0.65)` |
| `green-600` | `rgba(51,104,78,1)` | `rgba(44,167,106,0.82)` |
| `green-700` | `rgba(31,79,59,1)` | `rgba(44,167,106,0.91)` |
| `green-800` | `rgba(28,56,41,1)` | `rgba(60,157,106,1)` |
| `green-900` | `rgba(16,36,22,1)` | `rgba(82,158,114,1)` |
| `yellow-30` | `rgba(215,177,24,0.07)` | `rgba(240,226,203,1)` |
| `yellow-50` | `rgba(251,243,219,1)` | `rgba(162,105,50,0.1)` |
| `yellow-100` | `rgba(236,191,66,0.39)` | `rgba(57,46,30,1)` |
| `yellow-200` | `rgba(229,175,25,0.55)` | `rgba(179,129,61,0.2)` |
| `yellow-300` | `rgba(215,150,9,0.75)` | `rgba(86,67,40,1)` |
| `yellow-400` | `rgba(192,125,0,0.82)` | `rgba(250,177,67,0.5)` |
| `yellow-500` | `rgba(203,145,47,1)` | `rgba(240,166,51,0.6)` |
| `yellow-600` | `rgba(131,94,51,1)` | `rgba(232,162,37,0.8)` |
| `yellow-700` | `rgba(95,64,35,1)` | `rgba(221,154,34,0.91)` |
| `yellow-800` | `rgba(64,44,27,1)` | `rgba(217,158,53,1)` |
| `yellow-900` | `rgba(37,25,16,1)` | `rgba(202,152,77,1)` |
| `orange-30` | `rgba(224,124,57,0.07)` | `rgba(240,224,200,1)` |
| `orange-50` | `rgba(251,236,221,1)` | `rgba(233,126,40,0.06)` |
| `orange-100` | `rgba(224,124,57,0.27)` | `rgba(56,40,30,1)` |
| `orange-200` | `rgba(217,95,13,0.4)` | `rgba(233,126,37,0.2)` |
| `orange-300` | `rgba(217,95,13,0.65)` | `rgba(92,59,35,1)` |
| `orange-400` | `rgba(217,95,13,0.82)` | `rgba(233,126,35,0.45)` |
| `orange-500` | `rgba(217,115,13,1)` | `rgba(233,126,34,0.6)` |
| `orange-600` | `rgba(141,78,23,1)` | `rgba(233,126,33,0.8)` |
| `orange-700` | `rgba(106,59,18,1)` | `rgba(233,126,32,0.91)` |
| `orange-800` | `rgba(73,41,14,1)` | `rgba(228,133,57,1)` |
| `orange-900` | `rgba(40,24,9,1)` | `rgba(199,125,72,1)` |
| `purple-30` | `rgba(206,175,229,0.07)` | `rgba(232,222,246,1)` |
| `purple-50` | `rgba(248,243,252,1)` | `rgba(155,97,211,0.08)` |
| `purple-100` | `rgba(168,129,197,0.27)` | `rgba(43,36,49,1)` |
| `purple-200` | `rgba(141,98,174,0.4)` | `rgba(155,97,211,0.18)` |
| `purple-300` | `rgba(154,114,185,0.65)` | `rgba(60,45,73,1)` |
| `purple-400` | `rgba(148,103,182,0.82)` | `rgba(168,91,242,0.34)` |
| `purple-500` | `rgba(144,101,176,1)` | `rgba(155,97,211,0.65)` |
| `purple-600` | `rgba(117,77,146,1)` | `rgba(155,97,211,0.82)` |
| `purple-700` | `rgba(90,56,114,1)` | `rgba(155,97,211,0.91)` |
| `purple-800` | `rgba(65,36,84,1)` | `rgba(157,103,210,1)` |
| `purple-900` | `rgba(38,21,46,1)` | `rgba(157,104,211,1)` |
| `pink-30` | `rgba(231,147,188,0.07)` | `rgba(246,218,247,1)` |
| `pink-50` | `rgba(252,241,246,1)` | `rgba(220,76,145,0.06)` |
| `pink-100` | `rgba(225,136,179,0.27)` | `rgba(48,34,40,1)` |
| `pink-200` | `rgba(204,92,146,0.4)` | `rgba(220,76,145,0.22)` |
| `pink-300` | `rgba(209,91,148,0.65)` | `rgba(78,44,60,1)` |
| `pink-400` | `rgba(196,84,138,0.82)` | `rgba(220,76,145,0.4)` |
| `pink-500` | `rgba(193,76,138,1)` | `rgba(220,76,145,0.6)` |
| `pink-600` | `rgba(162,51,111,1)` | `rgba(220,76,145,0.82)` |
| `pink-700` | `rgba(111,49,81,1)` | `rgba(216,87,149,0.91)` |
| `pink-800` | `rgba(76,35,55,1)` | `rgba(201,75,140,1)` |
| `pink-900` | `rgba(44,20,32,1)` | `rgba(209,87,150,1)` |
| `brown-30` | `rgba(210,162,141,0.07)` | `rgba(244,244,211,1)` |
| `brown-50` | `rgba(244,238,238,1)` | `rgba(184,101,72,0.08)` |
| `brown-100` | `rgba(210,162,141,0.35)` | `rgba(47,39,35,1)` |
| `brown-200` | `rgba(156,76,40,0.32)` | `rgba(184,101,69,0.25)` |
| `brown-300` | `rgba(156,76,40,0.5)` | `rgba(74,50,40,1)` |
| `brown-400` | `rgba(156,76,40,0.68)` | `rgba(184,101,67,0.45)` |
| `brown-500` | `rgba(159,107,83,1)` | `rgba(239,153,118,0.6)` |
| `brown-600` | `rgba(128,84,63,1)` | `rgba(209,138,109,0.75)` |
| `brown-700` | `rgba(97,62,46,1)` | `rgba(187,125,100,0.91)` |
| `brown-800` | `rgba(68,42,30,1)` | `rgba(178,126,103,1)` |
| `brown-900` | `rgba(45,21,6,1)` | `rgba(186,133,111,1)` |
