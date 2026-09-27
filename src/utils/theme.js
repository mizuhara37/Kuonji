/**
 * Colour helpers for the configurable theme (config.json → primaryColor).
 *
 * The shipped palette is a hand-tuned soft green; when the configured primary is
 * that same green we keep the original MD3 role values untouched (no visual
 * regression). For any other colour the roles are derived here: on-colours by
 * contrast, containers by tinting/shading, and the two accent hues by rotating
 * the primary's hue.
 */

const DEFAULT_PRIMARY = '#6BBF8A'

export function normalizeHex(value, fallback = DEFAULT_PRIMARY) {
  const text = String(value || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return `#${text.slice(1).toUpperCase()}`
  if (/^#[0-9a-fA-F]{3}$/.test(text)) {
    const [, r, g, b] = text
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  return fallback
}

export function hexToRgb(hex) {
  const value = normalizeHex(hex)
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  }
}

export function rgbToHex({ r, g, b }) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)))
  const part = (n) => clamp(n).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}

/** Mix two colours: weight 0 → a, 1 → b. */
export function mix(a, b, weight) {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  const w = Math.max(0, Math.min(1, weight))
  return rgbToHex({
    r: x.r + (y.r - x.r) * w,
    g: x.g + (y.g - x.g) * w,
    b: x.b + (y.b - x.b) * w,
  })
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex)
  const channel = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * Text colour to use on top of `hex`: either white or a very dark tint of the
 * colour itself (which keeps the palette coherent, like MD3's on-colours).
 */
export function readableOn(hex, { darkTint = 0.82 } = {}) {
  if (luminance(hex) > 0.45) return mix(hex, '#000000', darkTint)
  return '#FFFFFF'
}

export function rgbToHsl({ r, g, b }) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return { h, s, l }
}

export function hslToHex({ h, s, l }) {
  const hue = ((h % 1) + 1) % 1
  const sat = Math.max(0, Math.min(1, s))
  const light = Math.max(0, Math.min(1, l))
  if (sat === 0) {
    const v = light * 255
    return rgbToHex({ r: v, g: v, b: v })
  }
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat
  const p = 2 * light - q
  const channel = (t) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return rgbToHex({
    r: channel(hue + 1 / 3) * 255,
    g: channel(hue) * 255,
    b: channel(hue - 1 / 3) * 255,
  })
}

/** A harmonious accent: same family, different hue. */
export function rotateHue(hex, degrees, { saturation, lightness }) {
  const { h } = rgbToHsl(hexToRgb(hex))
  return hslToHex({ h: h + degrees / 360, s: saturation, l: lightness })
}

export const isDefaultPrimary = (hex) => normalizeHex(hex) === DEFAULT_PRIMARY

/**
 * MD3-ish primary roles for one theme variant.
 * @param {string} primary base colour as configured
 * @param {boolean} dark dark theme?
 */
export function primaryRoles(primary, dark) {
  const base = normalizeHex(primary)
  if (dark) {
    const lifted = mix(base, '#FFFFFF', 0.42)
    return {
      primary: lifted,
      'on-primary': readableOn(lifted, { darkTint: 0.86 }),
      'primary-container': mix(base, '#000000', 0.62),
      'on-primary-container': mix(base, '#FFFFFF', 0.78),
      'primary-darken-1': mix(lifted, '#000000', 0.14),
      'primary-lighten-1': mix(lifted, '#FFFFFF', 0.2),
    }
  }
  return {
    primary: base,
    'on-primary': readableOn(base, { darkTint: 0.84 }),
    'primary-container': mix(base, '#FFFFFF', 0.78),
    'on-primary-container': mix(base, '#000000', 0.82),
    'primary-darken-1': mix(base, '#000000', 0.3),
    'primary-lighten-1': mix(base, '#FFFFFF', 0.34),
  }
}

/** Accent hues derived from the primary (secondary + tertiary). */
export function accentRoles(primary, dark) {
  const base = normalizeHex(primary)
  const { s, l } = rgbToHsl(hexToRgb(base))
  const sat = Math.max(0.22, Math.min(0.6, s))
  const light = dark ? 0.72 : 0.42
  const secondary = rotateHue(base, 150, { saturation: sat * 0.75, lightness: light })
  const secondaryContainer = dark
    ? mix(secondary, '#000000', 0.66)
    : mix(secondary, '#FFFFFF', 0.74)
  const tertiary = rotateHue(base, 48, { saturation: sat * 0.9, lightness: dark ? 0.74 : 0.44 })
  const tertiaryContainer = dark
    ? mix(tertiary, '#000000', 0.66)
    : mix(tertiary, '#FFFFFF', 0.74)
  return {
    secondary,
    'on-secondary': readableOn(secondary, { darkTint: 0.86 }),
    'secondary-container': secondaryContainer,
    'on-secondary-container': dark ? mix(secondary, '#FFFFFF', 0.8) : mix(secondaryContainer, '#000000', 0.8),
    'secondary-lighten-1': mix(secondary, '#FFFFFF', dark ? 0.22 : 0.34),
    tertiary,
    'on-tertiary': readableOn(tertiary, { darkTint: 0.86 }),
    'tertiary-container': tertiaryContainer,
    'on-tertiary-container': dark ? mix(tertiary, '#FFFFFF', 0.8) : mix(tertiaryContainer, '#000000', 0.8),
  }
}
