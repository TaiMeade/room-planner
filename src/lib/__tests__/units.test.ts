import { describe, expect, it } from 'vitest'

import { MM_PER_FOOT, MM_PER_INCH, formatArea, formatLength, parseLength } from '@/lib/units'

/**
 * Numeric entry is the thing mouse-only planners get wrong, so parsing has to
 * accept whatever a person actually types, and formatting has to round-trip.
 */

describe('parseLength — imperial', () => {
  const cases: [string, number][] = [
    [`12'`, 12 * MM_PER_FOOT],
    [`12' 6"`, 12 * MM_PER_FOOT + 6 * MM_PER_INCH],
    [`12'6`, 12 * MM_PER_FOOT + 6 * MM_PER_INCH],
    [`12'6"`, 12 * MM_PER_FOOT + 6 * MM_PER_INCH],
    [`12.5'`, 12.5 * MM_PER_FOOT],
    [`12 ft 6 in`, 12 * MM_PER_FOOT + 6 * MM_PER_INCH],
    [`8' 3 1/2"`, 8 * MM_PER_FOOT + 3.5 * MM_PER_INCH],
    [`30"`, 30 * MM_PER_INCH],
    [`30 1/2"`, 30.5 * MM_PER_INCH],
    [`1/2"`, 0.5 * MM_PER_INCH],
    [`1/2`, 0.5 * MM_PER_INCH],
    [`36`, 36 * MM_PER_INCH],
    [`-6"`, -6 * MM_PER_INCH],
  ]

  it.each(cases)('parses %s', (input, expected) => {
    expect(parseLength(input, 'imperial')).toBeCloseTo(expected, 6)
  })

  it('accepts explicit metric even in imperial mode', () => {
    expect(parseLength('2.4m', 'imperial')).toBeCloseTo(2400, 6)
    expect(parseLength('450 mm', 'imperial')).toBeCloseTo(450, 6)
  })

  it('rejects things that are not lengths', () => {
    for (const input of ['', '   ', 'wide', `12' banana`, '--3']) {
      expect(parseLength(input, 'imperial')).toBeNull()
    }
  })
})

describe('parseLength — metric', () => {
  it('reads a bare number as millimetres', () => {
    expect(parseLength('3050', 'metric')).toBe(3050)
  })

  it('handles unit suffixes', () => {
    expect(parseLength('3.05 m', 'metric')).toBeCloseTo(3050, 6)
    expect(parseLength('305cm', 'metric')).toBeCloseTo(3050, 6)
    expect(parseLength('3050mm', 'metric')).toBeCloseTo(3050, 6)
  })
})

describe('formatLength', () => {
  it('writes feet and inches', () => {
    expect(formatLength(12 * MM_PER_FOOT, 'imperial')).toBe(`12'`)
    expect(formatLength(12 * MM_PER_FOOT + 6 * MM_PER_INCH, 'imperial')).toBe(`12' 6"`)
    expect(formatLength(3.5 * MM_PER_INCH, 'imperial')).toBe(`3 1/2"`)
    expect(formatLength(0, 'imperial')).toBe(`0"`)
  })

  it('reduces fractions rather than printing 4/8', () => {
    expect(formatLength(4.5 * MM_PER_INCH, 'imperial')).toBe(`4 1/2"`)
    expect(formatLength(4.25 * MM_PER_INCH, 'imperial')).toBe(`4 1/4"`)
  })

  it('carries a rounded 12 inches into the feet instead of printing 11\' 12"', () => {
    expect(formatLength(12 * MM_PER_FOOT - 0.1, 'imperial')).toBe(`12'`)
  })

  it('switches metric between mm and m at a metre', () => {
    expect(formatLength(450, 'metric')).toBe('450 mm')
    expect(formatLength(3810, 'metric')).toBe('3.81 m')
  })

  it('round-trips through parseLength', () => {
    for (const mm of [304.8, 1219.2, 2438.4, 3810, 4267.2]) {
      const text = formatLength(mm, 'imperial')
      expect(parseLength(text, 'imperial')).toBeCloseTo(mm, 3)
    }
  })
})

describe('formatArea', () => {
  it('reports square feet and square metres', () => {
    const twelveByFourteen = 12 * MM_PER_FOOT * (14 * MM_PER_FOOT)
    expect(formatArea(twelveByFourteen, 'imperial')).toBe('168.0 sq ft')
    expect(formatArea(10_000_000, 'metric')).toBe('10.00 m²')
  })
})
