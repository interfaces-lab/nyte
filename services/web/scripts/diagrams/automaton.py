"""
Terminal — an automaton, one row per line.

A terminal is a grid of character cells filled line by line, and each new line
is a function of what is already on the screen. Rule 90 is the smallest thing
that behaves that way: each cell is the exclusive-or of its two neighbours on
the row above, and from a single seed that one rule unfolds a Sierpinski
triangle. Nothing on the screen is placed; every cell is computed from the
row before it.

Cells are drawn as short horizontal dashes at a character-cell aspect, so the
figure reads as monospaced output rather than as a bitmap. Rows appear in
order and the last one carries the block cursor, then the screen clears and
the run starts again — output scrolling past, not a picture.
"""

from __future__ import annotations

from _canvas import ACCENT, CX, INK, Canvas, emit, fmt

CELL_W = 5.0
CELL_H = 8.0
COLUMNS = 49
ROWS = 19
TOP = 14.0
RULE = 90
CYCLE_S = 14.0
REVEAL_S = 8.0


def step(cells: list[int]) -> list[int]:
    out: list[int] = []
    for i, _ in enumerate(cells):
        left = cells[i - 1] if i > 0 else 0
        right = cells[i + 1] if i + 1 < len(cells) else 0
        index = (left << 2) | (cells[i] << 1) | right
        out.append((RULE >> index) & 1)
    return out


def build() -> Canvas:
    canvas = Canvas("automaton")

    left = CX - (COLUMNS * CELL_W) / 2
    cells = [0] * COLUMNS
    cells[COLUMNS // 2] = 1

    for row in range(ROWS):
        y = TOP + row * CELL_H + CELL_H / 2
        d = "".join(
            f"M{fmt(left + i * CELL_W + 1)},{fmt(y)}L{fmt(left + i * CELL_W + CELL_W - 1)},{fmt(y)}"
            for i, cell in enumerate(cells)
            if cell
        )
        canvas.path(d, stroke=INK, width=2, opacity=0.5, cls=f"r{row}")
        # Each row holds off until its turn, shows for the rest of the cycle,
        # then the whole screen clears together.
        at = row * REVEAL_S / ROWS / CYCLE_S * 100
        canvas.css(
            f".r{row}{{animation:r{row}-show {fmt(CYCLE_S)}s steps(1,end) infinite}}"
            f"@keyframes r{row}-show{{0%,{fmt(at)}%{{opacity:0}}"
            f"{fmt(at + 0.01)}%,92%{{opacity:1}}93%,100%{{opacity:0}}}}"
        )
        cells = step(cells)

    # The cursor: a block one cell wide at the start of the line being written.
    # It steps down with the rows and blinks at the terminal's own cadence.
    cursor_x = left
    canvas.add(
        f'<rect x="{fmt(cursor_x)}" y="{fmt(TOP)}" width="{fmt(CELL_W - 1)}" '
        f'height="{fmt(CELL_H - 2)}" fill="{ACCENT}" fill-opacity="0.8" class="cur"/>'
    )
    frames = "".join(
        f"{fmt(row * REVEAL_S / ROWS / CYCLE_S * 100)}%{{transform:translateY({fmt(row * CELL_H)}px)}}"
        for row in range(ROWS)
    )
    canvas.css(
        f".cur{{animation:cur-step {fmt(CYCLE_S)}s steps(1,end) infinite,"
        f"cur-blink 1.06s steps(1,end) infinite}}"
        f"@keyframes cur-step{{{frames}"
        f"{fmt(REVEAL_S / CYCLE_S * 100)}%,92%{{transform:translateY({fmt((ROWS - 1) * CELL_H)}px)}}"
        f"93%,100%{{transform:translateY(0)}}}}"
        f"@keyframes cur-blink{{0%,49%{{opacity:1}}50%,100%{{opacity:0}}}}"
    )

    return canvas


if __name__ == "__main__":
    emit(build())
