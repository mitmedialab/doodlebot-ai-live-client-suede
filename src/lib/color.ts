// Recoloring the red-hat overlay (`elements.png`) to an arbitrary color.
//
// The overlay art is a deep red hat. To let that one asset stand in for *any*
// robot color the backend assigns, we recolor it with a CSS filter chain:
//
//     hue-rotate(<deg>) saturate(<x>) brightness(<x>)
//
// Each robot color arrives from the server as a hex string (e.g. "#52a447").
// `describeRobotColor` turns that hex into everything the UI needs: the filter
// that repaints the hat, a legible inline color chip, and a human-readable name
// ("green") — so we no longer need a hard-coded color-per-robot table.
//
// The three filters map onto the three HSL axes, each measured relative to the
// hat's own resting color:
//
//     hue-rotate(targetH − BASE.h)   shift the hue
//     saturate(targetS / BASE.s)     scale the saturation
//     brightness(targetL / BASE.l)   scale the lightness
//
// It's an approximation — CSS `brightness()` scales RGB, which isn't exactly HSL
// lightness — but it reads unmistakably as the intended color, and (unlike a
// bare hue-rotate) it now reaches greys, browns, black and white too.

export type Hsl = { h: number; s: number; l: number };

/** The overlay's resting color, sampled from the opaque red pixels of
 *  `elements.png` (median HSL of ~18k colored pixels ≈ 358°, 94%, 38%). We take
 *  hue 0 (pure red — the dominant pixels sit there) and treat it as fully
 *  saturated so `saturate()` only ever dials the color *down*, which every
 *  less-vivid target color needs. */
export const BASE_HAT_HSL: Hsl = { h: 0, s: 95, l: 38 };

/** The overlay filter, as the three multipliers/degrees Workflow applies. */
export type OverlayFilter = { hue: number; saturate: number; brightness: number };

/** A two-shade inline chip (deep fill, light label) in the target's own hue. */
export type ColorChip = { bg: string; fg: string };

/** Everything the UI needs to present an assigned robot color. */
export type RobotColor = {
  /** Human-readable name, e.g. "green" (for the completion message + chip). */
  name: string;
  /** CSS filter that recolors the red-hat overlay to this color. */
  filter: OverlayFilter;
  /** Inline chip shades used to render the name legibly in its own color. */
  chip: ColorChip;
};

/** Parse `#rgb` / `#rrggbb` (with or without the leading '#') to 0–255 RGB. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h))
    throw new Error(`Invalid hex color: ${JSON.stringify(hex)}`);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** RGB (0–255) → HSL with h in [0,360) and s,l in [0,100]. */
export function rgbToHsl(r: number, g: number, b: number): Hsl {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hexToHsl(hex: string): Hsl {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

const round = (n: number, dp = 3) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** The CSS filter that recolors the red-hat overlay to `hex`. */
export function overlayFilterForHex(hex: string): OverlayFilter {
  const { h, s, l } = hexToHsl(hex);
  return {
    // hue-rotate is modular, so keep it in [0,360) for readability.
    hue: ((h - BASE_HAT_HSL.h) % 360 + 360) % 360,
    saturate: Math.max(0, round(s / BASE_HAT_HSL.s)),
    brightness: Math.max(0, round(l / BASE_HAT_HSL.l)),
  };
}

/** A deep fill + light label in `hue`/`sat`, so a name reads as its own color
 *  (deep fill, light label) and stays legible for every hue (incl. yellow). */
const chip = (h: number, s: number): ColorChip => ({
  bg: `hsl(${round(h, 1)} ${round(s, 1)}% 32%)`,
  fg: `hsl(${round(h, 1)} ${round(s, 1)}% 85%)`,
});

/** The inline chip for `hex`, in its own hue. */
export function chipForHex(hex: string): ColorChip {
  const { h, s } = hexToHsl(hex);
  return chip(h, s);
}

// Hue → base name. Ordered spans across the wheel; red wraps around 0°/360°.
const HUE_NAMES: readonly [max: number, name: string][] = [
  [15, "red"],
  [45, "orange"],
  [65, "yellow"],
  [80, "lime"],
  [160, "green"],
  [185, "teal"],
  [200, "cyan"],
  [250, "blue"],
  [270, "indigo"],
  [290, "violet"],
  [330, "purple"],
  [345, "pink"],
  [360, "red"],
];

const hueName = (h: number) =>
  HUE_NAMES.find(([max]) => h < max)?.[1] ?? "red";

/**
 * A friendly, human-readable name for `hex`, e.g. "#52a447" → "green".
 *
 * Achromatic colors resolve to black/white/gray; dark warm colors read as
 * "brown"; everything else is a hue name, optionally qualified "dark"/"light"
 * when its lightness sits near the extremes. The result flows naturally into
 * "the robot with the ___ hat".
 */
export function colorName(hex: string): string {
  const { h, s, l } = hexToHsl(hex);

  // At the lightness extremes the hue is imperceptible — call it black/white
  // regardless of any faint tint.
  if (l < 7) return "black";
  if (l > 93) return "white";

  // Otherwise-achromatic: hue is meaningless, so name by lightness alone.
  if (s < 10) {
    if (l < 20) return "black";
    if (l > 85) return "white";
    return "gray";
  }

  // Dark, warm-hued colors read as brown rather than "dark orange/red".
  if (h >= 15 && h < 50 && l < 38) return "brown";

  const base = hueName(h);
  if (l < 22) return `dark ${base}`;
  if (l > 82) return `light ${base}`;
  return base;
}

/** Colors named without a hue — rendered fully neutral (no tint). */
const ACHROMATIC = new Set(["black", "white", "gray"]);

/** Bundle the name, recolor filter, and inline chip for an assigned robot hex. */
export function describeRobotColor(hex: string): RobotColor {
  const name = colorName(hex);
  const { h } = hexToHsl(hex);

  // Keep the render true to the name: a color we *call* black/white/gray should
  // read neutral, not carry a faint tint. Left as-is, a near-white like #ecf0f1
  // (a 15%-saturation cyan) keeps that tint over the red hat's shaded regions
  // and looks bluish. Zero the saturation so the hat — and its chip — go clean
  // grey/white, matching the label. Lightness still comes from `brightness`.
  const neutral = ACHROMATIC.has(name);
  const filter = overlayFilterForHex(hex);
  if (neutral) filter.saturate = 0;

  return {
    name,
    filter,
    chip: neutral ? chip(h, 0) : chipForHex(hex),
  };
}
