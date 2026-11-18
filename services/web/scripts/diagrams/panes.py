"""
Desktop — a window, partitioned.

The Electron client is one window that keeps splitting: sidebar from
workspace, transcript from browser panel, composer from transcript. The figure
is a binary space partition — a rectangle split across its longer side, each
half split again, five levels deep. The split falls at the golden section and
alternates which side takes the larger share, so no two panes are the same
size and the nesting is still one rule applied to every rectangle.

The splits draw on in the order they were made, outermost first, which is the
order a layout is decided in; then they hold and start again.
"""

from __future__ import annotations

from _canvas import ACCENT, INK, Canvas, emit, fmt

PHI = (5**0.5 - 1) / 2
DEPTH = 5
FRAME = (36.0, 24.0, 248.0, 132.0)  # x, y, w, h
GAP = 0.0


def partition(
    x: float, y: float, w: float, h: float, depth: int, flip: bool, out: list[list[str]]
) -> None:
    if depth == DEPTH:
        return
    share = PHI if flip else 1 - PHI
    if w >= h:
        split = x + w * share
        out[depth].append(f"M{fmt(split)},{fmt(y)}L{fmt(split)},{fmt(y + h)}")
        partition(x, y, split - x, h, depth + 1, not flip, out)
        partition(split, y, x + w - split, h, depth + 1, flip, out)
    else:
        split = y + h * share
        out[depth].append(f"M{fmt(x)},{fmt(split)}L{fmt(x + w)},{fmt(split)}")
        partition(x, y, w, split - y, depth + 1, not flip, out)
        partition(x, split, w, y + h - split, depth + 1, flip, out)


def build() -> Canvas:
    canvas = Canvas("panes")
    x, y, w, h = FRAME

    canvas.path(
        f"M{fmt(x)},{fmt(y)}h{fmt(w)}v{fmt(h)}h{fmt(-w)}Z",
        stroke=INK,
        width=1,
        opacity=0.5,
    )

    levels: list[list[str]] = [[] for _ in range(DEPTH)]
    partition(x, y, w, h, 0, True, levels)

    cycle = 12.0
    for depth, lines in enumerate(levels):
        # Deeper splits are finer: thinner, fainter, and later.
        opacity = 0.5 - depth * 0.07
        canvas.path("".join(lines), stroke=INK, width=1, opacity=opacity, cls=f"p{depth}")
        # The longest single segment at this depth bounds every dash length.
        length = max(w, h)
        canvas.draw_on(f"p{depth}", length=length, seconds=cycle, delay=depth * 0.55)

    # The first split is the sidebar edge, and it is the one the accent sits on.
    canvas.path(levels[0][0], stroke=ACCENT, width=1, opacity=0.9, cls="p0a")
    canvas.draw_on("p0a", length=max(w, h), seconds=cycle, delay=0.0)

    return canvas


if __name__ == "__main__":
    emit(build())
