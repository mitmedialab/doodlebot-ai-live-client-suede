"""turtle_svg.py

Python port of ``src/lib/utils/turtle-svg.ts``.

Renders a sequence of turtle-style drawing commands to an SVG document string.
The server uses this to turn one of the ``src/lib/samples/*.json`` command lists
into a renderable vectorization image served from the ``/resource`` route.

Command semantics (identical to the TS original)
------------------------------------------------
The turtle starts at (0, 0) with a heading of 0 degrees (pointing along +x).
Coordinates are screen-style: +y is down, positive angles rotate clockwise.

  - spin:  rotate in place by ``degrees`` (never draws).
  - line:  move forward ``distance`` along the current heading; draws only when
           ``penDown`` is true.
  - arc:   travel along a circular arc of ``radius`` sweeping ``degrees``; the
           heading changes by ``degrees``. Arcs always draw.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Sequence, TypedDict, Union


# --- Command types ---------------------------------------------------------


class SpinCommand(TypedDict):
    kind: Literal["spin"]
    degrees: float


class LineCommand(TypedDict):
    kind: Literal["line"]
    distance: float
    penDown: bool


class ArcCommand(TypedDict):
    kind: Literal["arc"]
    radius: float
    degrees: float


DrawCommand = Union[SpinCommand, LineCommand, ArcCommand]


@dataclass(frozen=True)
class RenderOptions:
    """Mirrors the TS ``RenderOptions`` interface (only the fields the server
    exercises are given non-default values)."""

    stroke: str = "#1a1a1a"
    stroke_width: float = 2
    padding: float = 20
    background: str | None = None
    start_heading: float = 0
    flip_y: bool = False
    width: float | None = None
    height: float | None = None


DEG2RAD = math.pi / 180

# Max angular span of a single SVG ``A`` segment. Splitting below 180 keeps the
# large-arc flag unambiguous and handles full 360 circles.
MAX_ARC_SEGMENT_DEGREES = 90


def _fmt(n: float) -> str:
    """Compact but precise-enough number formatting for path data."""
    return str(round(n, 3) + 0.0)  # ``+ 0.0`` collapses ``-0.0`` to ``0.0``


@dataclass
class _Bounds:
    min_x: float
    min_y: float
    max_x: float
    max_y: float


@dataclass
class _Point:
    x: float
    y: float


def _trace_path(commands: Sequence[DrawCommand], start_heading: float) -> tuple[str, _Bounds | None]:
    """Walk the command list once, producing SVG path data and the bounding box
    of everything that was drawn."""
    x = 0.0
    y = 0.0
    heading = float(start_heading)  # degrees

    d = ""
    pen_at: _Point | None = None  # last point emitted into the path, if any

    min_x = math.inf
    min_y = math.inf
    max_x = -math.inf
    max_y = -math.inf

    def include(px: float, py: float) -> None:
        nonlocal min_x, min_y, max_x, max_y
        if px < min_x:
            min_x = px
        if py < min_y:
            min_y = py
        if px > max_x:
            max_x = px
        if py > max_y:
            max_y = py

    def move_to(px: float, py: float) -> None:
        nonlocal d, pen_at
        d += f"M {_fmt(px)} {_fmt(py)} "
        pen_at = _Point(px, py)
        include(px, py)

    def ensure_pen_at(px: float, py: float) -> None:
        # Start a new subpath unless the pen is already exactly here.
        if pen_at is None or pen_at.x != px or pen_at.y != py:
            move_to(px, py)

    for cmd in commands:
        kind = cmd["kind"]
        if kind == "spin":
            heading += cmd["degrees"]

        elif kind == "line":
            rad = heading * DEG2RAD
            nx = x + cmd["distance"] * math.cos(rad)
            ny = y + cmd["distance"] * math.sin(rad)
            if cmd["penDown"]:
                ensure_pen_at(x, y)
                d += f"L {_fmt(nx)} {_fmt(ny)} "
                pen_at = _Point(nx, ny)
                include(nx, ny)
            x = nx
            y = ny

        elif kind == "arc":
            radius = cmd["radius"]
            degrees = cmd["degrees"]
            if radius <= 0 or degrees == 0:
                heading += degrees
                continue

            # The arc's center sits perpendicular to the heading, on the side
            # the turtle is turning toward.
            side = math.copysign(1, degrees)  # +1 or -1
            center_angle = (heading + side * 90) * DEG2RAD
            cx = x + radius * math.cos(center_angle)
            cy = y + radius * math.sin(center_angle)

            # Angle from center to the turtle's current position.
            phi = heading - side * 90

            ensure_pen_at(x, y)

            # Emit the arc in <=90 chunks so full circles and reflex arcs render
            # correctly with large-arc-flag = 0.
            sweep_flag = 1 if degrees > 0 else 0
            chunks = max(1, math.ceil(abs(degrees) / MAX_ARC_SEGMENT_DEGREES))
            step = degrees / chunks

            for i in range(1, chunks + 1):
                phi_end = (phi + step * i) * DEG2RAD
                ex = cx + radius * math.cos(phi_end)
                ey = cy + radius * math.sin(phi_end)
                d += f"A {_fmt(radius)} {_fmt(radius)} 0 0 {sweep_flag} {_fmt(ex)} {_fmt(ey)} "

                # Sample the chunk for the bounding box (arc extrema can lie
                # between endpoints).
                phi_start = (phi + step * (i - 1)) * DEG2RAD
                samples = 8
                for s in range(samples + 1):
                    a = phi_start + ((phi_end - phi_start) * s) / samples
                    include(cx + radius * math.cos(a), cy + radius * math.sin(a))

            phi_final = (phi + degrees) * DEG2RAD
            x = cx + radius * math.cos(phi_final)
            y = cy + radius * math.sin(phi_final)
            pen_at = _Point(x, y)
            heading += degrees

    bounds = None if min_x == math.inf else _Bounds(min_x, min_y, max_x, max_y)
    return d.strip(), bounds


def render_to_svg(commands: Sequence[DrawCommand], options: RenderOptions | None = None) -> str:
    """Render the commands to a complete standalone SVG document string."""
    opts = options or RenderOptions()
    d, bounds = _trace_path(commands, opts.start_heading)

    # Fall back to a small empty canvas if nothing was drawn.
    b = bounds or _Bounds(0, 0, 100, 100)
    vb_x = b.min_x - opts.padding
    vb_y = b.min_y - opts.padding
    vb_w = b.max_x - b.min_x + opts.padding * 2
    vb_h = b.max_y - b.min_y + opts.padding * 2

    aspect = vb_w / vb_h
    out_w = opts.width if opts.width is not None else (opts.height * aspect if opts.height is not None else None)
    out_h = opts.height if opts.height is not None else (opts.width / aspect if opts.width is not None else None)

    size_attrs = (f' width="{_fmt(out_w)}"' if out_w is not None else "") + (
        f' height="{_fmt(out_h)}"' if out_h is not None else ""
    )

    bg_rect = (
        f'<rect x="{_fmt(vb_x)}" y="{_fmt(vb_y)}" width="{_fmt(vb_w)}" '
        f'height="{_fmt(vb_h)}" fill="{opts.background}"/>'
        if opts.background
        else ""
    )

    transform = f' transform="translate(0 {_fmt(vb_y * 2 + vb_h)}) scale(1 -1)"' if opts.flip_y else ""

    return (
        '<svg xmlns="http://www.w3.org/2000/svg"'
        f' viewBox="{_fmt(vb_x)} {_fmt(vb_y)} {_fmt(vb_w)} {_fmt(vb_h)}"{size_attrs}>'
        + bg_rect
        + f'<path d="{d}" fill="none" stroke="{opts.stroke}"'
        + f' stroke-width="{opts.stroke_width}" stroke-linecap="round"'
        + f' stroke-linejoin="round"{transform}/>'
        + "</svg>"
    )
