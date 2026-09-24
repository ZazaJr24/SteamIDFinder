import type { RGBA } from './image';

export function hex(s: string, alpha = 255): RGBA {
  const v = s.replace('#', '');
  const n = parseInt(v.length === 3 ? v.replace(/./g, (c) => c + c) : v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

export function withAlpha(c: RGBA, alpha: number): RGBA {
  return [c[0], c[1], c[2], alpha];
}

export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

/** Multiplies brightness (f > 1 brightens). */
export function shade(c: RGBA, f: number): RGBA {
  return [c[0] * f, c[1] * f, c[2] * f, c[3]];
}

function rgbToHsl([r, g, b]: RGBA): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number, a: number): RGBA {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255, a];
}

/** Shifts hue (degrees), saturation and lightness (absolute deltas). */
export function adjust(c: RGBA, dh: number, ds: number, dl: number): RGBA {
  const [h, s, l] = rgbToHsl(c);
  return hslToRgb(h + dh, Math.min(1, Math.max(0, s + ds)), Math.min(1, Math.max(0, l + dl)), c[3]);
}

/**
 * Pixel-art color ramp from dark to light around `base`. Shadows drift toward
 * a cooler hue and highlights toward a warmer one, which reads much richer
 * than plain darkening.
 */
export function ramp(base: string | RGBA, steps = 5, spread = 0.3, hueShift = 12): RGBA[] {
  const c = typeof base === 'string' ? hex(base) : base;
  const out: RGBA[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1) - 0.5; // -0.5 … 0.5
    out.push(adjust(c, -t * hueShift * 2, -Math.abs(t) * 0.1, t * spread));
  }
  return out;
}

/** Picks a palette entry for a value in [0, 1]. */
export function pick(palette: readonly RGBA[], v: number): RGBA {
  const i = Math.min(palette.length - 1, Math.max(0, Math.floor(v * palette.length)));
  return palette[i]!;
}
