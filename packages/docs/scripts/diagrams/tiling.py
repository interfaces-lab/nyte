"""
UI — one tile, every cell.

`@nyte-ai/ui` is a small set of primitives styled once and used by every host.
A Truchet tiling says the same thing about shape: there is exactly one tile,
two quarter-arcs joining the midpoints of adjacent sides, and the whole field
is that tile placed in one of two orientations. Nothing in the figure is drawn
twice; every curve you see is the primitive, rotated.

The orientation rule is deterministic — a cell flips when the sum of its
indices lands on a residue of a small modulus — so the field is patterned
without being periodic in either axis. The pulse travels along diagonals, the
one direction the rule treats specially.
"""

from __future__ import annotations

import math

from _canvas import ACCENT, CX, CY, INK, Canvas, emit, fmt

TILE = 20.0
RADIUS = 84.0
DIAGONALS = 16


def arcs(x: float, y: float, flipped: bool) -> str:
    """Two quarter circles of radius TILE/2, centred on opposite corners."""
    r = TILE / 2
    if flipped:
        # centred on the top-right and bottom-left corners
        return (
            f"M{fmt(x + r)},{fmt(y)}A{fmt(r)},{fmt(r)} 0 0,0 {fmt(x + TILE)},{fmt(y + r)}"
            f"M{fmt(x)},{fmt(y + r)}A{fmt(r)},{fmt(r)} 0 0,1 {fmt(x + r)},{fmt(y + TILE)}"
        )
    # centred on the top-left and bottom-right corners
    return (
        f"M{fmt(x + r)},{fmt(y)}A{fmt(r)},{fmt(r)} 0 0,1 {fmt(x)},{fmt(y + r)}"
        f"M{fmt(x + TILE)},{fmt(y + r)}A{fmt(r)},{fmt(r)} 0 0,0 {fmt(x + r)},{fmt(y + TILE)}"
    )


def build() -> Canvas:
    canvas = Canvas("tiling")

    columns = int(RADIUS / TILE) + 1
    rows = int(RADIUS / TILE) + 1
    by_diagonal: dict[int, list[str]] = {}

    for row in range(-rows, rows + 1):
        for column in range(-columns, columns + 1):
            x = CX + column * TILE - TILE / 2
            y = CY + row * TILE - TILE / 2
            if math.hypot(x + TILE / 2 - CX, y + TILE / 2 - CY) > RADIUS:
                continue
            flipped = (column * 3 + row * 5) % 7 < 3
            key = (column + row) % DIAGONALS
            by_diagonal.setdefault(key, []).append(arcs(x, y, flipped))

    for key, paths in sorted(by_diagonal.items()):
        canvas.path("".join(paths), stroke=INK, width=1, opacity=0.34)
        # The same tile again in the accent, faded in and out by diagonal, so
        # a wave of emphasis runs across the field without any tile moving.
        canvas.path("".join(paths), stroke=ACCENT, width=1, opacity=0.9, cls=f"d{key}")
        canvas.pulse(f"d{key}", seconds=9.0, delay=key * 9.0 / DIAGONALS, low=0.0, high=0.45)

    return canvas


if __name__ == "__main__":
    emit(build())
