import { describe, expect, it } from 'vitest'

import { buildSheetSvg, escapeXml, planBounds } from '@/lib/export/buildSvg'
import type { SheetExportOptions } from '@/lib/export/buildSvg'
import { bestScaleFor, fitsOnSheet, makeSheet } from '@/lib/export/sheet'
import { createSamplePlan } from '@/lib/samplePlan'
import { MM_PER_FOOT } from '@/lib/units'
import { computePlanGeometry } from '@/lib/wallGeometry'
import { emptyPlan } from '@/types/plan'
import type { Plan } from '@/types/plan'

/**
 * Print scale is fiddly and unforgiving, and people hold rulers to it. So the
 * claim "1/4 inch on paper is one foot in the room" is tested as arithmetic
 * rather than trusted as a comment.
 */

function options(overrides: Partial<SheetExportOptions> = {}): SheetExportOptions {
  return {
    sheet: makeSheet('letter', 'in-1-4', true),
    titleBlock: true,
    legend: false,
    dimensions: true,
    areas: true,
    furnitureLabels: true,
    background: true,
    scaleBar: false,
    ...overrides,
  }
}

/** A room whose centrelines make the outer footprint exactly 10ft x 8ft. */
function roomPlan(widthMm: number, heightMm: number, thickness = 100): Plan {
  const plan = emptyPlan('Ruler test')
  const corners = [
    { x: 0, y: 0 },
    { x: widthMm, y: 0 },
    { x: widthMm, y: heightMm },
    { x: 0, y: heightMm },
  ]
  corners.forEach((point, index) => {
    plan.nodes[`n${index}`] = { id: `n${index}`, ...point }
  })
  corners.forEach((_, index) => {
    plan.walls[`w${index}`] = {
      id: `w${index}`,
      start: `n${index}`,
      end: `n${(index + 1) % corners.length}`,
      thickness,
      height: 2400,
    }
  })
  return plan
}

/** Pull the drawing group's transform back out of the emitted markup. */
function readDrawingTransform(svg: string) {
  const match = svg.match(
    /<g transform="translate\((-?[\d.]+) (-?[\d.]+)\) scale\((-?[\d.]+)\) translate\((-?[\d.]+) (-?[\d.]+)\)">/,
  )
  if (!match) throw new Error('The drawing group transform was not found in the SVG.')
  return {
    originX: Number(match[1]),
    originY: Number(match[2]),
    scale: Number(match[3]),
    shiftX: Number(match[4]),
    shiftY: Number(match[5]),
  }
}

/** Where a world point lands on the sheet, in paper millimetres. */
function toPaper(svg: string, x: number, y: number) {
  const t = readDrawingTransform(svg)
  return { x: t.originX + (x + t.shiftX) * t.scale, y: t.originY + (y + t.shiftY) * t.scale }
}

describe('print scale', () => {
  it('puts a 10 ft wall at exactly 2.5 paper inches at 1/4" = 1\'-0"', () => {
    const tenFeet = 10 * MM_PER_FOOT
    const plan = roomPlan(tenFeet, 8 * MM_PER_FOOT)
    const { svg } = buildSheetSvg(plan, options())

    const start = toPaper(svg, 0, 0)
    const end = toPaper(svg, tenFeet, 0)
    const paperMm = end.x - start.x

    // 1:48 → 3048 mm of room becomes 63.5 mm of paper, which is 2.5 inches.
    expect(paperMm).toBeCloseTo(tenFeet / 48, 6)
    expect(paperMm / 25.4).toBeCloseTo(2.5, 6)
  })

  it('holds the same ratio at every offered scale', () => {
    const span = 4000
    for (const [scaleId, denominator] of [
      ['in-1-2', 24],
      ['in-1-4', 48],
      ['in-1-8', 96],
      ['m-50', 50],
      ['m-100', 100],
    ] as const) {
      const { svg } = buildSheetSvg(
        roomPlan(span, span),
        options({ sheet: makeSheet('a3', scaleId, true) }),
      )
      const measured = toPaper(svg, span, 0).x - toPaper(svg, 0, 0).x
      expect(measured).toBeCloseTo(span / denominator, 6)
    }
  })

  it('emits the sheet at its real paper size in millimetres', () => {
    const { svg, widthMm, heightMm } = buildSheetSvg(roomPlan(4000, 3000), options())
    // Letter landscape.
    expect(widthMm).toBeCloseTo(279.4, 6)
    expect(heightMm).toBeCloseTo(215.9, 6)
    expect(svg).toContain('width="279.4mm"')
    expect(svg).toContain('height="215.9mm"')
    expect(svg).toContain('viewBox="0 0 279.4 215.9"')
  })

  it('keeps the drawing inside the printable area', () => {
    const plan = roomPlan(4000, 3000)
    const sheet = makeSheet('letter', 'in-1-4', true)
    const { svg, overflows } = buildSheetSvg(plan, options({ sheet }))
    expect(overflows).toBe(false)

    const bounds = planBounds(plan, computePlanGeometry(plan))
    for (const corner of [
      [bounds.minX, bounds.minY],
      [bounds.maxX, bounds.maxY],
    ] as const) {
      const point = toPaper(svg, corner[0], corner[1])
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(sheet.widthMm)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(sheet.heightMm)
    }
  })

  it('reports an overflow rather than silently cropping', () => {
    const huge = roomPlan(40_000, 30_000)
    expect(buildSheetSvg(huge, options()).overflows).toBe(true)
  })
})

/**
 * The scale bar is what makes a printed sheet self-checking. Its claim has to
 * be arithmetically true, because someone is going to lay a ruler on it — that
 * is the entire point of drawing it.
 */
describe('the printed scale bar', () => {
  it('states a paper length that matches the drawing scale', () => {
    const { svg } = buildSheetSvg(
      roomPlan(4000, 3000),
      options({ sheet: makeSheet('letter', 'in-1-4', true), scaleBar: true }),
    )

    // At 1:48, 10 real feet is 3048/48 = 63.5 mm of paper — exactly 2.5 inches.
    expect(svg).toContain('10 ft')
    expect(svg).toContain('2 1/2&quot; on paper')
  })

  it('measures the drawn bar itself, not just the caption', () => {
    const sheet = makeSheet('letter', 'in-1-4', true)
    const { svg } = buildSheetSvg(roomPlan(4000, 3000), options({ sheet, scaleBar: true }))

    // The bar is drawn as a row of alternating cells; their combined width is
    // what a ruler would actually span.
    const cells = [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="2\.2"/g)]
    expect(cells.length).toBeGreaterThan(1)

    const left = Math.min(...cells.map((cell) => Number(cell[1])))
    const right = Math.max(...cells.map((cell) => Number(cell[1]) + Number(cell[2])))
    const drawn = right - left

    expect(drawn).toBeCloseTo((10 * 304.8) / sheet.denominator, 3)
    expect(drawn / 25.4).toBeCloseTo(2.5, 4)
  })

  it('states metres on a metric plan', () => {
    const plan = roomPlan(4000, 3000)
    plan.settings.units = 'metric'
    const { svg } = buildSheetSvg(
      plan,
      options({ sheet: makeSheet('a4', 'm-50', true), scaleBar: true }),
    )
    // At 1:50 a 2 m run is 40 mm of paper.
    expect(svg).toMatch(/\d+ m</)
    expect(svg).toContain('mm on paper')
  })

  it('shrinks the run rather than overflowing the margin at a large scale', () => {
    const sheet = makeSheet('letter', 'in-1-2', true)
    const { svg } = buildSheetSvg(roomPlan(2000, 1500), options({ sheet, scaleBar: true }))
    const cells = [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="2\.2"/g)]
    const left = Math.min(...cells.map((cell) => Number(cell[1])))
    const right = Math.max(...cells.map((cell) => Number(cell[1]) + Number(cell[2])))
    expect(right - left).toBeLessThanOrEqual(70)
    expect(right).toBeLessThanOrEqual(sheet.widthMm - sheet.marginMm)
  })

  it('is left out when switched off', () => {
    const { svg } = buildSheetSvg(roomPlan(4000, 3000), options({ scaleBar: false }))
    expect(svg).not.toContain('on paper')
  })
})

describe('scale selection', () => {
  const sheet = makeSheet('letter', 'in-1-4', true)

  it('knows what fits', () => {
    expect(fitsOnSheet(sheet, 4000, 3000, 26)).toBe(true)
    expect(fitsOnSheet(sheet, 40_000, 30_000, 26)).toBe(false)
  })

  it('picks the largest scale the drawing still fits at', () => {
    const frame = {
      widthMm: sheet.widthMm,
      heightMm: sheet.heightMm,
      marginMm: sheet.marginMm,
      landscape: true,
    }
    // A small room fits at 1/2" = 1'-0"; a whole floor has to drop to 1/8".
    expect(bestScaleFor('imperial', frame, 2000, 1500, 26)?.denominator).toBe(24)
    expect(bestScaleFor('imperial', frame, 12_000, 7000, 26)?.denominator).toBe(48)
    expect(bestScaleFor('imperial', frame, 20_000, 7000, 26)?.denominator).toBe(96)
    expect(bestScaleFor('imperial', frame, 400_000, 300_000, 26)).toBeNull()
  })

  it('offers only the scales belonging to the active unit system', () => {
    const frame = { widthMm: 297, heightMm: 420, marginMm: 12, landscape: false }
    expect(bestScaleFor('metric', frame, 3000, 3000, 26)?.units).toBe('metric')
    expect(bestScaleFor('imperial', frame, 3000, 3000, 26)?.units).toBe('imperial')
  })
})

describe('sheet contents', () => {
  it('draws the whole plan and its annotations', () => {
    const { svg } = buildSheetSvg(createSamplePlan(), options({ legend: true }))
    expect(svg).toContain('Sample bedroom')
    expect(svg).toContain('1:48')
    expect(svg).toContain('135.0 sq ft')
    expect(svg).toContain('CONTENTS')
    expect(svg).toContain('Mini fridge')
    expect(svg).toContain('Drawn in Room Planner')
  })

  it('leaves out what was switched off', () => {
    const { svg } = buildSheetSvg(
      createSamplePlan(),
      options({ titleBlock: false, legend: false, dimensions: false, areas: false }),
    )
    expect(svg).not.toContain('Drawn in Room Planner')
    expect(svg).not.toContain('CONTENTS')
    expect(svg).not.toContain('135.0 sq ft')
  })

  it('survives an empty plan instead of producing a broken viewBox', () => {
    const { svg } = buildSheetSvg(emptyPlan('Nothing yet'), options())
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).not.toContain('NaN')
    expect(svg).not.toContain('Infinity')
  })

  it('escapes a plan name that would otherwise break the document', () => {
    const plan = roomPlan(4000, 3000)
    plan.meta.name = 'Ben & Ann\'s "loft" <draft>'
    const { svg } = buildSheetSvg(plan, options())

    expect(svg).toContain('Ben &amp; Ann&apos;s &quot;loft&quot; &lt;draft&gt;')
    expect(svg).not.toContain('<draft>')
  })

  it('escapes the five XML characters and nothing else', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;')
    expect(escapeXml('12 × 14 — plain')).toBe('12 × 14 — plain')
  })
})
