/**
 * turtle-svg.ts
 *
 * Renders a sequence of turtle-style drawing commands to an SVG string,
 * and provides helpers to encode that SVG as a data URL suitable for
 * assigning to an <img src="...">.
 *
 * Command semantics
 * -----------------
 * The turtle starts at (0, 0) with a heading of 0° (pointing along +x).
 * Coordinates are screen-style: +y is down, and positive angles rotate
 * clockwise on screen.
 *
 *  - spin:  rotate in place by `degrees` (no movement, never draws).
 *  - line:  move forward `distance` along the current heading.
 *           Draws only when `penDown` is true.
 *  - arc:   travel along a circular arc of `radius`, sweeping `degrees`.
 *           Positive degrees curve toward the turtle's "positive angle"
 *           side, negative degrees curve the other way. The heading
 *           changes by `degrees`. Arcs always draw (the source format
 *           carries no pen flag for them).
 *
 * Usage
 * -----
 *   import { commandsToImgSrc } from "./turtle-svg";
 *   const img = document.createElement("img");
 *   img.src = commandsToImgSrc(commands, { stroke: "#222", strokeWidth: 2 });
 */

export interface SpinCommand {
  kind: "spin";
  degrees: number;
}

export interface LineCommand {
  kind: "line";
  distance: number;
  penDown: boolean;
}

export interface ArcCommand {
  kind: "arc";
  radius: number;
  degrees: number;
}

export type DrawCommand = SpinCommand | LineCommand | ArcCommand;

export interface RenderOptions {
  /** Stroke color for the drawing. Default: "#1a1a1a". */
  stroke?: string;
  /** Stroke width in drawing units. Default: 2. */
  strokeWidth?: number;
  /** Padding around the drawing's bounding box, in drawing units. Default: 20. */
  padding?: number;
  /** Optional background fill. Default: none (transparent). */
  background?: string;
  /** Initial heading in degrees. Default: 0 (pointing along +x). */
  startHeading?: number;
  /**
   * Mirror the drawing vertically (use if your source data assumed a
   * math-style +y-up coordinate system). Default: false.
   */
  flipY?: boolean;
  /** Fixed output size, e.g. { width: 512 }. Height is derived from the
   *  drawing's aspect ratio when omitted. By default the SVG has no
   *  width/height and scales to its container via the viewBox. */
  width?: number;
  height?: number;
}

interface Point {
  x: number;
  y: number;
}

const DEG2RAD = Math.PI / 180;

/** Max angular span of a single SVG `A` segment. Splitting below 180°
 *  keeps the large-arc flag unambiguous and handles full 360° circles. */
const MAX_ARC_SEGMENT_DEGREES = 90;

function fmt(n: number): string {
  // Compact but precise-enough number formatting for path data.
  return Number(n.toFixed(3)).toString();
}

/**
 * Walks the command list once, producing SVG path data and tracking the
 * bounding box of everything that was drawn.
 */
function tracePath(
  commands: readonly DrawCommand[],
  startHeading: number,
): {
  d: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
} {
  let x = 0;
  let y = 0;
  let heading = startHeading; // degrees

  let d = "";
  let penAt: Point | null = null; // last point emitted into the path, if any

  let minX = Infinity;
  let minY = Infinity;
  let maxX = Infinity * -1;
  let maxY = -Infinity;

  const include = (px: number, py: number) => {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  };

  const moveTo = (px: number, py: number) => {
    d += `M ${fmt(px)} ${fmt(py)} `;
    penAt = { x: px, y: py };
    include(px, py);
  };

  const ensurePenAt = (px: number, py: number) => {
    // Start a new subpath unless the pen is already exactly here.
    if (!penAt || penAt.x !== px || penAt.y !== py) moveTo(px, py);
  };

  for (const cmd of commands) {
    switch (cmd.kind) {
      case "spin": {
        heading += cmd.degrees;
        break;
      }

      case "line": {
        const rad = heading * DEG2RAD;
        const nx = x + cmd.distance * Math.cos(rad);
        const ny = y + cmd.distance * Math.sin(rad);
        if (cmd.penDown) {
          ensurePenAt(x, y);
          d += `L ${fmt(nx)} ${fmt(ny)} `;
          penAt = { x: nx, y: ny };
          include(nx, ny);
        }
        x = nx;
        y = ny;
        break;
      }

      case "arc": {
        const { radius, degrees } = cmd;
        if (radius <= 0 || degrees === 0) {
          heading += degrees;
          break;
        }

        // The arc's center sits perpendicular to the heading, on the side
        // the turtle is turning toward.
        const side = Math.sign(degrees); // +1 or -1
        const centerAngle = (heading + side * 90) * DEG2RAD;
        const cx = x + radius * Math.cos(centerAngle);
        const cy = y + radius * Math.sin(centerAngle);

        // Angle from center to the turtle's current position.
        let phi = heading - side * 90;

        ensurePenAt(x, y);

        // Emit the arc in <=90° chunks so full circles and reflex arcs
        // render correctly with large-arc-flag = 0.
        const sweepFlag = degrees > 0 ? 1 : 0;
        const chunks = Math.max(
          1,
          Math.ceil(Math.abs(degrees) / MAX_ARC_SEGMENT_DEGREES),
        );
        const step = degrees / chunks;

        for (let i = 1; i <= chunks; i++) {
          const phiEnd = (phi + step * i) * DEG2RAD;
          const ex = cx + radius * Math.cos(phiEnd);
          const ey = cy + radius * Math.sin(phiEnd);
          d += `A ${fmt(radius)} ${fmt(radius)} 0 0 ${sweepFlag} ${fmt(ex)} ${fmt(ey)} `;

          // Sample the chunk for the bounding box (arc extrema can lie
          // between endpoints).
          const phiStart = (phi + step * (i - 1)) * DEG2RAD;
          const samples = 8;
          for (let s = 0; s <= samples; s++) {
            const a = phiStart + ((phiEnd - phiStart) * s) / samples;
            include(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
          }
        }

        const phiFinal = (phi + degrees) * DEG2RAD;
        x = cx + radius * Math.cos(phiFinal);
        y = cy + radius * Math.sin(phiFinal);
        penAt = { x, y };
        heading += degrees;
        break;
      }
    }
  }

  const bounds = minX === Infinity ? null : { minX, minY, maxX, maxY };
  return { d: d.trim(), bounds };
}

/**
 * Renders the commands to a complete standalone SVG document string.
 */
export function renderToSvg(
  commands: readonly DrawCommand[],
  options: RenderOptions = {},
): string {
  const {
    stroke = "#1a1a1a",
    strokeWidth = 2,
    padding = 20,
    background,
    startHeading = 0,
    flipY = false,
    width,
    height,
  } = options;

  const { d, bounds } = tracePath(commands, startHeading);

  // Fall back to a small empty canvas if nothing was drawn.
  const b = bounds ?? { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const vbX = b.minX - padding;
  const vbY = b.minY - padding;
  const vbW = b.maxX - b.minX + padding * 2;
  const vbH = b.maxY - b.minY + padding * 2;

  const aspect = vbW / vbH;
  const outW = width ?? (height !== undefined ? height * aspect : undefined);
  const outH = height ?? (width !== undefined ? width / aspect : undefined);

  const sizeAttrs =
    (outW !== undefined ? ` width="${fmt(outW)}"` : "") +
    (outH !== undefined ? ` height="${fmt(outH)}"` : "");

  const bgRect = background
    ? `<rect x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(vbW)}" height="${fmt(
        vbH,
      )}" fill="${background}"/>`
    : "";

  const transform = flipY
    ? ` transform="translate(0 ${fmt(vbY * 2 + vbH)}) scale(1 -1)"`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` viewBox="${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(vbH)}"${sizeAttrs}>` +
    bgRect +
    `<path d="${d}" fill="none" stroke="${stroke}"` +
    ` stroke-width="${strokeWidth}" stroke-linecap="round"` +
    ` stroke-linejoin="round"${transform}/>` +
    `</svg>`
  );
}

/**
 * Encodes an SVG document string as a data URL usable in <img src>.
 * Uses URI-encoding (more compact than base64 for SVG text).
 */
export const svgToDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * One-step convenience: commands -> data URL for an <img> tag.
 *
 *   document.querySelector("img")!.src = commandsToImgSrc(commands);
 */
export const commandsToImgSrc = (
  commands: readonly DrawCommand[],
  options?: RenderOptions,
) => svgToDataUrl(renderToSvg(commands, options));
