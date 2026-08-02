/**
 * Color math used to guard the heat-map palette (PRA-29). Lifted from the
 * ad-hoc calculations done during PRA-23 accessibility validation so the
 * contrast + color-vision-deficiency (CVD) invariants can be asserted from the
 * theme tokens in CI. Pure, dependency-free, and framework-agnostic.
 */

export type Rgb = readonly [number, number, number];

/** Parse a `#RRGGBB` (or `RRGGBB`) hex string into 0-255 channels. */
export function hexToRgb(hex: string): Rgb {
  const cleaned = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    throw new Error(`Expected a #RRGGBB hex color, got "${hex}"`);
  }
  return [
    parseInt(cleaned.slice(0, 2), 16),
    parseInt(cleaned.slice(2, 4), 16),
    parseInt(cleaned.slice(4, 6), 16),
  ] as const;
}

/**
 * Convert a single 0-255 sRGB channel to its 0-1 linear-light value, using the
 * WCAG 2.x transfer function (the 0.04045 knee, 2.4 gamma).
 */
export function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear-light RGB triple for a hex color (each component 0-1). */
export function toLinearRgb(hex: string): Rgb {
  const [r, g, b] = hexToRgb(hex);
  return [channelToLinear(r), channelToLinear(g), channelToLinear(b)] as const;
}

/** WCAG relative luminance (0 = black, 1 = white) of a hex color. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = toLinearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors, in the range [1, 21]. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Machado, Oliveira & Fernandes (2009) CVD simulation matrices at full
 * severity (1.0). Applied to *linear-light* RGB. These let us check that the
 * density ramp stays rankable by lightness for dichromats, i.e. that hue is
 * never load-bearing.
 * Source: https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
 */
export type CvdType = 'protanopia' | 'deuteranopia' | 'tritanopia';

const CVD_MATRICES: Record<CvdType, readonly number[]> = {
  protanopia: [
    0.152286, 1.052583, -0.204868,
    0.114503, 0.786281, 0.099216,
    -0.003882, -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968,
    0.280085, 0.672501, 0.047413,
    -0.011820, 0.042940, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779,
    -0.078411, 0.930809, 0.147602,
    0.004733, 0.691367, 0.303900,
  ],
};

export const CVD_TYPES: readonly CvdType[] = [
  'protanopia',
  'deuteranopia',
  'tritanopia',
];

/**
 * Perceived luminance of a hex color as seen with the given dichromacy. We
 * apply the Machado matrix in linear-light space and take the luminance of the
 * simulated color — that scalar is what a dichromat has left to rank cells by
 * when hue collapses.
 */
export function cvdLuminance(hex: string, type: CvdType): number {
  const [r, g, b] = toLinearRgb(hex);
  const m = CVD_MATRICES[type];
  const simulated: Rgb = [
    m[0] * r + m[1] * g + m[2] * b,
    m[3] * r + m[4] * g + m[5] * b,
    m[6] * r + m[7] * g + m[8] * b,
  ];
  return 0.2126 * simulated[0] + 0.7152 * simulated[1] + 0.0722 * simulated[2];
}

/** True iff each value is strictly greater than the one before it. */
export function isStrictlyDecreasing(values: readonly number[]): boolean {
  return values.every((v, i) => i === 0 || v < values[i - 1]);
}
