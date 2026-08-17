import { describe, expect, it } from 'vitest'

import { catalogEntry, CATALOG, glyphFor, GLYPHS } from '@/lib/catalog'
import { snapAngle, snapToStep } from '@/lib/geometry'
import { parsePlan } from '@/lib/schema'
import { clampOpening, computePlanGeometry } from '@/lib/wallGeometry'
import { formatArea, formatLength, formatLengthCompact, parseLength } from '@/lib/units'
import { emptyPlan } from '@/types/plan'

/**
 * A sweep for the awkward inputs — zero, negative, absurd, and malicious.
 * Nothing here is a feature; it is all the stuff that turns into a blank screen
 * or a bad number in front of a user.
 */

describe('degenerate geometry', () => {
  it('ignores a wall whose ends are the same point', () => {
    const plan = emptyPlan()
    plan.nodes = { a: { id: 'a', x: 100, y: 100 }, b: { id: 'b', x: 100, y: 100 } }
    plan.walls = { w: { id: 'w', start: 'a', end: 'b', thickness: 100, height: 2400 } }

    const geometry = computePlanGeometry(plan)
    expect(geometry.walls).toHaveLength(0)
    expect(geometry.rooms).toHaveLength(0)
  })

  it('survives a wall pointing at a node that is not there', () => {
    const plan = emptyPlan()
    plan.nodes = { a: { id: 'a', x: 0, y: 0 } }
    plan.walls = { w: { id: 'w', start: 'a', end: 'ghost', thickness: 100, height: 2400 } }
    expect(() => computePlanGeometry(plan)).not.toThrow()
    expect(computePlanGeometry(plan).walls).toHaveLength(0)
  })

  it('does not hang on a long chain of walls', () => {
    const plan = emptyPlan()
    for (let i = 0; i < 300; i += 1) {
      plan.nodes[`n${i}`] = { id: `n${i}`, x: i * 500, y: (i % 2) * 500 }
      if (i > 0) {
        plan.walls[`w${i}`] = {
          id: `w${i}`,
          start: `n${i - 1}`,
          end: `n${i}`,
          thickness: 100,
          height: 2400,
        }
      }
    }
    const started = Date.now()
    const geometry = computePlanGeometry(plan)
    expect(geometry.walls).toHaveLength(299)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('clamps an opening wider than its wall to the centre', () => {
    const plan = emptyPlan()
    plan.nodes = { a: { id: 'a', x: 0, y: 0 }, b: { id: 'b', x: 1000, y: 0 } }
    plan.walls = { w: { id: 'w', start: 'a', end: 'b', thickness: 100, height: 2400 } }
    const outline = computePlanGeometry(plan).wallsById.get('w')!

    expect(clampOpening(outline, 0, 5000)).toBe(500)
    expect(clampOpening(outline, -900, 200)).toBe(100)
    expect(clampOpening(outline, 99_999, 200)).toBe(900)
  })
})

describe('numbers people can actually produce', () => {
  it('does not print a negative zero', () => {
    for (const value of [-0, -0.0001, -0.4]) {
      expect(formatLength(value, 'imperial')).not.toContain('-0"')
      expect(formatLength(value, 'metric')).not.toBe('-0 mm')
    }
  })

  it('formats and parses zero', () => {
    expect(formatLength(0, 'imperial')).toBe('0"')
    expect(formatLength(0, 'metric')).toBe('0 mm')
    expect(parseLength('0', 'imperial')).toBe(0)
    expect(parseLength('0', 'metric')).toBe(0)
  })

  it('refuses nonsense rather than returning NaN', () => {
    for (const input of ['abc', '', '   ', '--5', "12'' 6", 'NaN', 'Infinity']) {
      const parsed = parseLength(input, 'imperial')
      expect(parsed === null || Number.isFinite(parsed)).toBe(true)
    }
  })

  it('never renders NaN in a length', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(formatLength(value, 'imperial')).toBe('—')
      expect(formatLength(value, 'metric')).toBe('—')
    }
  })

  it('handles very large and very small plans', () => {
    expect(formatLength(1e7, 'metric')).toBe('10000.00 m')
    expect(formatArea(0, 'imperial')).toBe('0.0 sq ft')
    expect(formatLengthCompact(0, 'imperial')).toBe("0'")
  })
})

describe('snapping', () => {
  it('leaves values alone when the step is zero or negative', () => {
    expect(snapToStep(123.456, 0)).toBe(123.456)
    expect(snapToStep(123.456, -10)).toBe(123.456)
  })

  it('does not move a point when the drag has no length', () => {
    const from = { x: 100, y: 100 }
    expect(snapAngle(from, { x: 100, y: 100 }, 45)).toEqual({ x: 100, y: 100 })
  })

  it('preserves distance while snapping the angle', () => {
    const from = { x: 0, y: 0 }
    const to = { x: 300, y: 40 }
    const snapped = snapAngle(from, to, 45)
    expect(Math.hypot(snapped.x, snapped.y)).toBeCloseTo(Math.hypot(300, 40), 6)
  })
})

describe('the catalog', () => {
  it('draws every entry without throwing, at its own size and at a silly one', () => {
    for (const entry of CATALOG) {
      for (const [width, depth] of [
        [entry.width, entry.depth],
        [10, 10],
        [50_000, 20],
      ] as const) {
        const glyph = glyphFor(entry, width, depth)
        expect(glyph.body.length).toBeGreaterThan(0)
        expect(glyph.body).not.toContain('NaN')
        for (const detail of glyph.details) expect(detail).not.toContain('NaN')
      }
    }
  })

  it('has no duplicate ids and sane dimensions throughout', () => {
    const ids = CATALOG.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of CATALOG) {
      expect(entry.width).toBeGreaterThan(0)
      expect(entry.depth).toBeGreaterThan(0)
      expect(entry.height).toBeGreaterThan(0)
      expect(GLYPHS[entry.glyph]).toBeDefined()
      expect(entry.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('falls back to a box for a catalog id from a future version', () => {
    expect(catalogEntry('nonexistent')).toBeUndefined()
    expect(() => glyphFor(undefined, 600, 600)).not.toThrow()
    expect(glyphFor(undefined, 600, 600).body.length).toBeGreaterThan(0)
  })
})

describe('untrusted plan files', () => {
  /**
   * The underlay is the only field that becomes a URL the browser fetches, and
   * plan files get shared. A remote one would have a tool that promises to
   * never touch the network doing exactly that on open.
   */
  it('refuses an underlay that points somewhere else', () => {
    for (const dataUrl of [
      'https://example.com/tracker.png',
      '//example.com/tracker.png',
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/svg+xml;base64,PHN2Zz4=',
    ]) {
      const { plan, warnings } = parsePlan({ schemaVersion: 1, underlay: { dataUrl } })
      expect(plan.underlay).toBeNull()
      expect(warnings.length).toBeGreaterThan(0)
    }
  })

  it('keeps a genuinely embedded image', () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const { plan, warnings } = parsePlan({ schemaVersion: 1, underlay: { dataUrl: png } })
    expect(plan.underlay?.dataUrl).toBe(png)
    expect(warnings).toEqual([])
  })

  it('does not choke on deeply wrong shapes', () => {
    for (const input of [
      { schemaVersion: 1, nodes: [], walls: 'nope', furniture: 42 },
      { schemaVersion: 1, walls: { w: null }, openings: { o: [] } },
      { schemaVersion: 1, furnitureOrder: 'not-an-array' },
      { schemaVersion: 1, settings: 'no' },
      { schemaVersion: 1, meta: 7 },
    ]) {
      expect(() => parsePlan(input)).not.toThrow()
    }
  })
})
