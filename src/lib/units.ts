import type { UnitSystem } from '@/types/plan'

/**
 * Millimetres in, human strings out — and back again. The store is metric-only
 * internally; this module is the entire imperial story.
 *
 * Parsing is deliberately forgiving because people type what they say:
 * `12' 6"`, `12'6`, `12.5'`, `150"`, `3.05m`, `305cm`, `3050`.
 */

export const MM_PER_INCH = 25.4
export const MM_PER_FOOT = 304.8

export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH
}

export function inchesToMm(inches: number): number {
  return inches * MM_PER_INCH
}

/** Round to the nearest 1/`denominator` inch, expressed in mm. */
function roundToFraction(inches: number, denominator: number): number {
  return Math.round(inches * denominator) / denominator
}

function reduceFraction(numerator: number, denominator: number): [number, number] {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(numerator, denominator) || 1
  return [numerator / d, denominator / d]
}

export interface FormatOptions {
  /** Denominator for imperial rounding. 8 → nearest 1/8". */
  precision?: number
  /** Omit the unit suffix (used inside dimension strings where context is obvious). */
  bare?: boolean
}

/**
 * The canonical display form. Imperial reads `12' 6 1/2"`, metric reads
 * `3.81 m` above a metre and `450 mm` below it.
 */
export function formatLength(mm: number, units: UnitSystem, options: FormatOptions = {}): string {
  const { precision = 8 } = options
  if (!Number.isFinite(mm)) return '—'

  if (units === 'metric') {
    if (Math.abs(mm) >= 1000) return `${(mm / 1000).toFixed(2)} m`
    // `|| 0` collapses -0 to 0, which stringifies without the sign.
    return `${Math.round(mm) || 0} mm`
  }

  const totalInches = roundToFraction(mmToInches(Math.abs(mm)), precision)
  // Only negative once rounding has had its say. A value a hair below zero
  // rounds to nothing, and "-0" is not a measurement anyone wants to read.
  const negative = mm < 0 && totalInches > 0
  const feet = Math.floor(totalInches / 12)
  let inches = totalInches - feet * 12

  // Rounding can push inches to exactly 12; roll it into the feet.
  let carriedFeet = feet
  if (inches >= 12 - 1e-9) {
    carriedFeet += 1
    inches = 0
  }

  const whole = Math.floor(inches + 1e-9)
  const fractional = inches - whole
  let fractionText = ''
  if (fractional > 1e-9) {
    const [num, den] = reduceFraction(Math.round(fractional * precision), precision)
    if (num > 0) fractionText = `${num}/${den}`
  }

  const parts: string[] = []
  if (carriedFeet > 0) parts.push(`${carriedFeet}'`)
  if (whole > 0 || fractionText) {
    const inchText = [whole > 0 ? String(whole) : '', fractionText].filter(Boolean).join(' ')
    parts.push(`${inchText}"`)
  }
  if (parts.length === 0) parts.push(`0"`)

  return (negative ? '-' : '') + parts.join(' ')
}

/** Compact form for tight labels — no fractions, no spaces: `12'6"` / `3.81m`. */
export function formatLengthCompact(mm: number, units: UnitSystem): string {
  if (units === 'metric') {
    return Math.abs(mm) >= 1000 ? `${(mm / 1000).toFixed(2)}m` : `${Math.round(mm)}mm`
  }
  const totalInches = Math.round(mmToInches(Math.abs(mm)) * 2) / 2
  const feet = Math.floor(totalInches / 12)
  const inches = Math.round((totalInches - feet * 12) * 2) / 2
  const sign = mm < 0 ? '-' : ''
  if (inches === 0) return `${sign}${feet}'`
  const inchText = Number.isInteger(inches) ? String(inches) : inches.toFixed(1)
  return feet === 0 ? `${sign}${inchText}"` : `${sign}${feet}'${inchText}"`
}

const NUMBER = String.raw`(\d+(?:\.\d+)?)`
const FRACTION = String.raw`(?:\s+(\d+)\s*\/\s*(\d+))?`

/**
 * Parse a typed length into mm. Returns null when the input is not a length at
 * all, so callers can distinguish "invalid" from "zero".
 *
 * `units` decides how a bare number is read: `12` means 12 inches in imperial
 * and 12 millimetres in metric.
 */
export function parseLength(input: string, units: UnitSystem): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!text) return null

  const sign = text.startsWith('-') ? -1 : 1
  const body = text.replace(/^[-+]/, '')

  // Explicit metric suffixes win regardless of the active unit system.
  const metric = body.match(new RegExp(`^${NUMBER}\\s*(mm|cm|m)$`))
  if (metric) {
    const value = Number(metric[1])
    const factor = metric[2] === 'm' ? 1000 : metric[2] === 'cm' ? 10 : 1
    return sign * value * factor
  }

  // feet + optional inches + optional fraction: 12' 6 1/2"  /  12'6  /  12'
  const feetInches = body.match(
    new RegExp(`^${NUMBER}\\s*(?:'|ft|feet)\\s*(?:${NUMBER}${FRACTION}\\s*(?:"|in|inch(?:es)?)?)?$`),
  )
  if (feetInches) {
    const feet = Number(feetInches[1])
    const inches = feetInches[2] ? Number(feetInches[2]) : 0
    const fraction =
      feetInches[3] && feetInches[4] ? Number(feetInches[3]) / Number(feetInches[4]) : 0
    return sign * (feet * MM_PER_FOOT + (inches + fraction) * MM_PER_INCH)
  }

  // A lone fraction, with or without the inch mark: 1/2"  /  1/2
  // Checked before the whole-number form because `1` would otherwise swallow
  // the numerator and leave `/2` unmatched.
  const bareFraction = body.match(/^(\d+)\s*\/\s*(\d+)\s*(?:"|in|inch(?:es)?)?$/)
  if (bareFraction) {
    const value = Number(bareFraction[1]) / Number(bareFraction[2])
    const isExplicitInches = /["a-z]/.test(body)
    return sign * (units === 'imperial' || isExplicitInches ? value * MM_PER_INCH : value)
  }

  // inches only, with or without a fraction: 30"  /  30 1/2"
  const inchesOnly = body.match(
    new RegExp(`^${NUMBER}${FRACTION}\\s*(?:"|in|inch(?:es)?)$`),
  )
  if (inchesOnly) {
    const whole = Number(inchesOnly[1])
    const fraction =
      inchesOnly[2] && inchesOnly[3] ? Number(inchesOnly[2]) / Number(inchesOnly[3]) : 0
    return sign * (whole + fraction) * MM_PER_INCH
  }

  const bare = body.match(new RegExp(`^${NUMBER}$`))
  if (bare) {
    const value = Number(bare[1])
    return sign * (units === 'imperial' ? value * MM_PER_INCH : value)
  }

  return null
}

/** Area in the active system: square feet or square metres. */
export function formatArea(mm2: number, units: UnitSystem): string {
  if (units === 'metric') return `${(mm2 / 1_000_000).toFixed(2)} m²`
  return `${(mm2 / (MM_PER_FOOT * MM_PER_FOOT)).toFixed(1)} sq ft`
}

/** The grid steps offered in settings, per system. */
export const GRID_PRESETS: Record<UnitSystem, { label: string; mm: number }[]> = {
  imperial: [
    { label: '1 in', mm: MM_PER_INCH },
    { label: '3 in', mm: MM_PER_INCH * 3 },
    { label: '6 in', mm: MM_PER_INCH * 6 },
    { label: '1 ft', mm: MM_PER_FOOT },
    { label: '2 ft', mm: MM_PER_FOOT * 2 },
  ],
  metric: [
    { label: '10 mm', mm: 10 },
    { label: '50 mm', mm: 50 },
    { label: '100 mm', mm: 100 },
    { label: '250 mm', mm: 250 },
    { label: '500 mm', mm: 500 },
  ],
}
