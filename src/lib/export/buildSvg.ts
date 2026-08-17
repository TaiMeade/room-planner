import { catalogEntry, glyphFor } from '@/lib/catalog'
import {
  add,
  boundsAreValid,
  emptyBounds,
  extendBounds,
  padBounds,
  pointInPolygon,
  scale,
  toDegrees,
} from '@/lib/geometry'
import type { Bounds } from '@/lib/geometry'
import {
  dimensionPaths,
  FONT_MONO,
  FONT_UI,
  openingPaths,
  PALETTE,
  polygonPath,
} from '@/lib/render'
import type { Sheet } from '@/lib/export/sheet'
import { MM_PER_FOOT, formatArea, formatLength } from '@/lib/units'
import { computePlanGeometry, wallMidpoint } from '@/lib/wallGeometry'
import type { PlanGeometry, WallOutline } from '@/lib/wallGeometry'
import type { FurnitureItem, Plan } from '@/types/plan'

/**
 * Builds the exported drawing as an SVG string.
 *
 * This is the single source for all three visual exports: SVG is this verbatim,
 * PNG is this rasterised, PDF is this handed to svg2pdf. Writing three
 * emitters would guarantee they drift; writing one means a fix to the door
 * swings shows up everywhere at once.
 *
 * The sheet is laid out in *paper millimetres*, with the drawing nested in a
 * group scaled by 1/denominator. That is what makes "hold a ruler to the print
 * and it measures right" true rather than aspirational — the PDF is emitted in
 * mm units, so a 1:48 drawing is placed at exactly worldSize/48 mm and no
 * conversion happens anywhere else.
 */

export interface SheetExportOptions {
  sheet: Sheet
  titleBlock: boolean
  legend: boolean
  dimensions: boolean
  areas: boolean
  furnitureLabels: boolean
  background: boolean
  /** A graduated bar that lets the printed sheet be checked with a real ruler. */
  scaleBar: boolean
}

export interface BuiltSheet {
  svg: string
  widthMm: number
  heightMm: number
  /** True when the drawing overran the printable area at the chosen scale. */
  overflows: boolean
}

/** Annotation sizes, authored in paper millimetres the way a drawing standard would state them. */
const PAPER = {
  dimensionText: 2.3,
  areaText: 2.9,
  furnitureText: 1.9,
  hairline: 0.18,
  wallOutline: 0.25,
  leafLine: 0.35,
  dimensionOffset: 7,
  witnessGap: 1.6,
  tick: 1.6,
  titleBlockHeight: 22,
  legendWidth: 46,
} as const

const round = (value: number) => Math.round(value * 1000) / 1000

/** Widest the scale bar may run on paper, mm. Comfortable on the narrowest sheet offered. */
const MAX_BAR_MM = 70

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function planBounds(plan: Plan, geometry: PlanGeometry): Bounds {
  const bounds = emptyBounds()
  for (const wall of geometry.walls) {
    for (const point of wall.polygon) extendBounds(bounds, point)
  }
  for (const item of Object.values(plan.furniture)) {
    const reach = Math.max(item.width, item.depth) / 2
    extendBounds(bounds, { x: item.x - reach, y: item.y - reach })
    extendBounds(bounds, { x: item.x + reach, y: item.y + reach })
  }
  return bounds
}

/** Which side of a wall faces out of the building — dimensions belong there. */
function outwardSign(wall: WallOutline, geometry: PlanGeometry): number {
  const probe = add(wallMidpoint(wall), scale(wall.normal, wall.thickness / 2 + 60))
  return geometry.rooms.some((room) => pointInPolygon(probe, room.polygon)) ? -1 : 1
}

function drawRooms(geometry: PlanGeometry, plan: Plan, options: SheetExportOptions, w: number): string {
  const fills = geometry.rooms
    .map((room) => `<path d="${polygonPath(room.polygon)}" fill="${PALETTE.roomFill}"/>`)
    .join('')

  if (!options.areas) return fills

  const labels = geometry.rooms
    .map(
      (room) =>
        `<text x="${round(room.centroid.x)}" y="${round(room.centroid.y)}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_MONO}" font-size="${round(PAPER.areaText * w)}" fill="${PALETTE.label}">${escapeXml(formatArea(room.area, plan.settings.units))}</text>`,
    )
    .join('')

  return `${fills}${labels}`
}

function drawWalls(geometry: PlanGeometry, w: number): string {
  return geometry.walls
    .map(
      (wall) =>
        `<path d="${polygonPath(wall.polygon)}" fill="${PALETTE.graphite}" stroke="${PALETTE.graphiteLine}" stroke-width="${round(PAPER.wallOutline * w)}" stroke-linejoin="round"/>`,
    )
    .join('')
}

function drawOpenings(geometry: PlanGeometry, w: number): string {
  const hairline = round(PAPER.hairline * w)
  const leaf = round(PAPER.leafLine * w)

  return geometry.openings
    .map((entry) => {
      const paths = openingPaths(entry)
      const stroke = PALETTE.graphiteLine
      return [
        `<path d="${paths.cut}" fill="${PALETTE.roomFill}"/>`,
        ...paths.jambs.map(
          (d) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${hairline}"/>`,
        ),
        ...paths.leaves.map(
          (d) =>
            `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${leaf}" stroke-linecap="round"/>`,
        ),
        ...paths.arcs.map(
          (d) =>
            `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${hairline}" opacity="0.5"/>`,
        ),
        ...paths.panes.map(
          (d) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${hairline}"/>`,
        ),
      ].join('')
    })
    .join('')
}

function drawFurniture(plan: Plan, options: SheetExportOptions, w: number): string {
  const outline = round(PAPER.wallOutline * w)
  const detail = round(PAPER.hairline * w)
  const fontSize = round(PAPER.furnitureText * w)

  return plan.furnitureOrder
    .map((id) => plan.furniture[id])
    .filter((item): item is FurnitureItem => Boolean(item))
    .map((item) => {
      const entry = catalogEntry(item.catalogId)
      const glyph = glyphFor(entry, item.width, item.depth)
      const fill = item.color ?? entry?.color ?? '#D8CFC0'
      const degrees = ((toDegrees(item.rotation) % 360) + 360) % 360
      const flip = degrees > 90 && degrees < 270 ? ' transform="rotate(180)"' : ''

      const label =
        options.furnitureLabels &&
        Math.min(item.width, item.depth) > fontSize * 3 &&
        item.width > item.label.length * fontSize * 0.62
          ? `<text x="0" y="0"${flip} text-anchor="middle" dominant-baseline="central" font-family="${FONT_UI}" font-size="${fontSize}" fill="${PALETTE.label}" opacity="0.8">${escapeXml(item.label)}</text>`
          : ''

      return [
        `<g transform="translate(${round(item.x)} ${round(item.y)}) rotate(${round(toDegrees(item.rotation))})">`,
        `<path d="${glyph.body}" fill="${fill}" stroke="#6E767B" stroke-width="${outline}" stroke-linejoin="round"/>`,
        ...glyph.details.map(
          (d) =>
            `<path d="${d}" fill="none" stroke="#6E767B" stroke-width="${detail}" stroke-linejoin="round" opacity="0.55"/>`,
        ),
        label,
        '</g>',
      ].join('')
    })
    .join('')
}

function drawDimensions(geometry: PlanGeometry, plan: Plan, w: number): string {
  const hairline = round(PAPER.hairline * w)
  const fontSize = round(PAPER.dimensionText * w)
  const minimumLength = PAPER.dimensionText * w * 2.5

  return geometry.walls
    .filter((wall) => wall.centrelineLength > minimumLength)
    .map((wall) => {
      const sign = outwardSign(wall, geometry)
      const paths = dimensionPaths(wall.start, wall.end, sign * PAPER.dimensionOffset * w, {
        tickLength: PAPER.tick * w,
        witnessGap: PAPER.witnessGap * w,
      })
      const text = formatLength(wall.centrelineLength, plan.settings.units)
      const gap = (text.length * 0.62 + 0.8) * fontSize

      return [
        `<g stroke="${PALETTE.dimension}" fill="none" opacity="0.86">`,
        ...paths.witnesses.map((d) => `<path d="${d}" stroke-width="${hairline}"/>`),
        `<path d="${paths.run}" stroke-width="${hairline}"/>`,
        ...paths.ticks.map(
          (d) => `<path d="${d}" stroke-width="${round(hairline * 1.5)}" stroke-linecap="round"/>`,
        ),
        '</g>',
        `<g transform="translate(${round(paths.label.x)} ${round(paths.label.y)}) rotate(${round(paths.label.angle)})">`,
        `<rect x="${round(-gap / 2)}" y="${round(-fontSize * 0.62)}" width="${round(gap)}" height="${round(fontSize * 1.24)}" fill="${PALETTE.paper}"/>`,
        `<text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-family="${FONT_MONO}" font-size="${fontSize}" fill="${PALETTE.dimension}">${escapeXml(text)}</text>`,
        '</g>',
      ].join('')
    })
    .join('')
}

/**
 * The title block. Drawn in paper millimetres, because a title block is a
 * property of the sheet, not of the room — it must stay the same size whether
 * the plan is a closet or a floor.
 */
function drawTitleBlock(
  plan: Plan,
  geometry: PlanGeometry,
  options: SheetExportOptions,
  scaleLabel: string,
): string {
  const { sheet } = options
  const height = PAPER.titleBlockHeight
  const x = sheet.marginMm
  const y = sheet.heightMm - sheet.marginMm - height
  const width = sheet.widthMm - sheet.marginMm * 2
  const totalArea = geometry.rooms.reduce((sum, room) => sum + room.area, 0)

  const date = new Date(plan.meta.updatedAt)
  const dateText = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

  const fields: { label: string; value: string }[] = [
    { label: 'Scale', value: scaleLabel },
    { label: 'Area', value: totalArea > 0 ? formatArea(totalArea, plan.settings.units) : '—' },
    { label: 'Rooms', value: String(geometry.rooms.length) },
    { label: 'Date', value: dateText },
  ]

  const columnWidth = 30
  const fieldsStartX = x + width - columnWidth * fields.length - 2

  const fieldMarkup = fields
    .map((field, index) => {
      const fx = fieldsStartX + index * columnWidth
      return [
        `<text x="${round(fx)}" y="${round(y + 8)}" font-family="${FONT_UI}" font-size="2.2" letter-spacing="0.35" fill="${PALETTE.labelFaint}">${escapeXml(field.label.toUpperCase())}</text>`,
        `<text x="${round(fx)}" y="${round(y + 14)}" font-family="${FONT_MONO}" font-size="3.4" fill="${PALETTE.graphite}">${escapeXml(field.value)}</text>`,
      ].join('')
    })
    .join('')

  return [
    `<g>`,
    `<line x1="${round(x)}" y1="${round(y)}" x2="${round(x + width)}" y2="${round(y)}" stroke="${PALETTE.graphite}" stroke-width="0.4"/>`,
    `<text x="${round(x)}" y="${round(y + 8)}" font-family="${FONT_UI}" font-size="2.2" letter-spacing="0.35" fill="${PALETTE.labelFaint}">PLAN</text>`,
    `<text x="${round(x)}" y="${round(y + 15)}" font-family="${FONT_UI}" font-size="5" font-weight="600" fill="${PALETTE.graphite}">${escapeXml(plan.meta.name || 'Untitled plan')}</text>`,
    plan.meta.author
      ? `<text x="${round(x)}" y="${round(y + 20)}" font-family="${FONT_UI}" font-size="2.8" fill="${PALETTE.label}">${escapeXml(plan.meta.author)}</text>`
      : '',
    fieldMarkup,
    `<text x="${round(x + width)}" y="${round(y + 20)}" text-anchor="end" font-family="${FONT_UI}" font-size="2.4" fill="${PALETTE.labelFaint}">Drawn in Room Planner</text>`,
    `</g>`,
  ].join('')
}

/**
 * A graduated scale bar, drawn at true scale in paper millimetres.
 *
 * This is the step that closes the loop on print accuracy. The maths is
 * verified in tests, but the last link — printer margins, "fit to page",
 * whatever a driver decides to do — can only be checked against the physical
 * sheet. So the sheet carries its own reference: lay a ruler across the bar,
 * and if the stated length doesn't measure, the print was scaled and nothing
 * else on the page can be trusted either.
 *
 * The checkable claim is spelled out in words underneath, because "1:48" tells
 * you nothing while holding a ruler.
 */
function drawScaleBar(plan: Plan, options: SheetExportOptions): string {
  const { sheet } = options
  const imperial = plan.settings.units === 'imperial'

  // Choose the longest round run of real-world length that still fits the bar's
  // allowance. Longer is better: a ruler laid across 10 feet catches a scaling
  // error that 1 foot would hide inside the width of the pencil line.
  const unit = imperial ? MM_PER_FOOT : 1000
  const unitsShown = [20, 10, 5, 4, 2, 1].find(
    (count) => (count * unit) / sheet.denominator <= MAX_BAR_MM,
  )
  if (!unitsShown) return ''

  const barLength = (unitsShown * unit) / sheet.denominator
  const barHeight = 2.2
  const reservedBottom = options.titleBlock ? PAPER.titleBlockHeight + 4 : 0
  const x = sheet.marginMm
  const y = sheet.heightMm - sheet.marginMm - reservedBottom - 12

  // Alternating filled and open cells, the way a map scale reads.
  const cells: string[] = []
  const step = barLength / unitsShown
  for (let i = 0; i < unitsShown; i += 1) {
    cells.push(
      `<rect x="${round(x + i * step)}" y="${round(y)}" width="${round(step)}" height="${barHeight}" fill="${i % 2 === 0 ? PALETTE.graphite : PALETTE.paper}" stroke="${PALETTE.graphite}" stroke-width="0.2"/>`,
    )
  }

  const endLabel = imperial
    ? `${unitsShown} ft`
    : unitsShown === 1
      ? '1 m'
      : `${unitsShown} m`

  // The paper length, stated in the units someone's ruler actually has on it.
  const paperClaim = imperial
    ? `${formatPaperInches(barLength)} on paper`
    : `${round(barLength)} mm on paper`

  return [
    '<g>',
    ...cells,
    `<text x="${round(x)}" y="${round(y - 1.4)}" font-family="${FONT_MONO}" font-size="2.2" fill="${PALETTE.label}">0</text>`,
    `<text x="${round(x + barLength)}" y="${round(y - 1.4)}" text-anchor="end" font-family="${FONT_MONO}" font-size="2.2" fill="${PALETTE.label}">${escapeXml(endLabel)}</text>`,
    `<text x="${round(x)}" y="${round(y + barHeight + 3.4)}" font-family="${FONT_UI}" font-size="2.3" fill="${PALETTE.labelFaint}">${escapeXml(`Printed at 1:${sheet.denominator} this bar is ${paperClaim}. If it isn't, the print was rescaled.`)}</text>`,
    '</g>',
  ].join('')
}

/** Paper lengths in inches and eighths — the marks on a ruler someone owns. */
function formatPaperInches(millimetres: number): string {
  const total = millimetres / 25.4
  const whole = Math.floor(total)
  const eighths = Math.round((total - whole) * 8)
  if (eighths === 0) return `${whole}"`
  if (eighths === 8) return `${whole + 1}"`
  const [numerator, denominator] = reduceEighths(eighths)
  return whole === 0
    ? `${numerator}/${denominator}"`
    : `${whole} ${numerator}/${denominator}"`
}

function reduceEighths(eighths: number): [number, number] {
  let numerator = eighths
  let denominator = 8
  while (numerator % 2 === 0 && denominator % 2 === 0) {
    numerator /= 2
    denominator /= 2
  }
  return [numerator, denominator]
}

/** A legend of what's in the plan, with counts and footprint sizes. */
function drawLegend(plan: Plan, options: SheetExportOptions): string {
  const counts = new Map<string, { label: string; count: number; width: number; depth: number }>()
  for (const item of Object.values(plan.furniture)) {
    const key = `${item.catalogId}:${Math.round(item.width)}x${Math.round(item.depth)}`
    const existing = counts.get(key)
    if (existing) existing.count += 1
    else
      counts.set(key, { label: item.label, count: 1, width: item.width, depth: item.depth })
  }
  if (counts.size === 0) return ''

  const entries = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 14)
  const { sheet } = options
  const lineHeight = 4
  const x = sheet.widthMm - sheet.marginMm - PAPER.legendWidth
  const y = sheet.marginMm + 6

  const rows = entries
    .map((entry, index) => {
      const ry = y + 5 + index * lineHeight
      const size = `${formatLength(entry.width, plan.settings.units)} × ${formatLength(entry.depth, plan.settings.units)}`
      return [
        `<text x="${round(x)}" y="${round(ry)}" font-family="${FONT_MONO}" font-size="2.4" fill="${PALETTE.graphite}">${entry.count}×</text>`,
        `<text x="${round(x + 6)}" y="${round(ry)}" font-family="${FONT_UI}" font-size="2.4" fill="${PALETTE.graphite}">${escapeXml(entry.label)}</text>`,
        `<text x="${round(x + PAPER.legendWidth)}" y="${round(ry)}" text-anchor="end" font-family="${FONT_MONO}" font-size="2.1" fill="${PALETTE.labelFaint}">${escapeXml(size)}</text>`,
      ].join('')
    })
    .join('')

  return [
    `<g>`,
    `<text x="${round(x)}" y="${round(y)}" font-family="${FONT_UI}" font-size="2.2" letter-spacing="0.35" fill="${PALETTE.labelFaint}">CONTENTS</text>`,
    `<line x1="${round(x)}" y1="${round(y + 1.5)}" x2="${round(x + PAPER.legendWidth)}" y2="${round(y + 1.5)}" stroke="${PALETTE.paperEdge}" stroke-width="0.3"/>`,
    rows,
    `</g>`,
  ].join('')
}

export function buildSheetSvg(plan: Plan, options: SheetExportOptions): BuiltSheet {
  const geometry = computePlanGeometry(plan)
  const { sheet } = options
  const w = sheet.denominator // paper mm → world mm

  const rawBounds = planBounds(plan, geometry)
  const bounds = boundsAreValid(rawBounds)
    ? padBounds(rawBounds, PAPER.dimensionOffset * w * 1.6)
    : { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }

  const worldWidth = bounds.maxX - bounds.minX
  const worldHeight = bounds.maxY - bounds.minY

  const reservedBottom = options.titleBlock ? PAPER.titleBlockHeight + 4 : 0
  const available = {
    width: sheet.widthMm - sheet.marginMm * 2,
    height: sheet.heightMm - sheet.marginMm * 2 - reservedBottom,
  }
  const drawnWidth = worldWidth / w
  const drawnHeight = worldHeight / w
  const overflows = drawnWidth > available.width || drawnHeight > available.height

  // Centre the drawing in the printable area. The transform is a pure
  // translate-then-scale, so the printed size is exactly world/denominator.
  const originX = sheet.marginMm + (available.width - drawnWidth) / 2
  const originY = sheet.marginMm + (available.height - drawnHeight) / 2

  const scaleLabel = `1:${sheet.denominator}`

  const body = [
    options.background
      ? `<rect x="0" y="0" width="${round(sheet.widthMm)}" height="${round(sheet.heightMm)}" fill="${PALETTE.paper}"/>`
      : '',
    // The scale factor is the one number in this file that must not be
    // rounded. 1/48 rounded to three places is 0.021, a 0.8% error — about an
    // inch and a half across a fourteen-foot room, and precisely the kind of
    // thing someone finds by holding a ruler to the print. Coordinates round
    // safely because they are in world millimetres, where three decimal places
    // is a micron on paper.
    `<g transform="translate(${round(originX)} ${round(originY)}) scale(${1 / w}) translate(${round(-bounds.minX)} ${round(-bounds.minY)})">`,
    drawRooms(geometry, plan, options, w),
    drawWalls(geometry, w),
    drawOpenings(geometry, w),
    drawFurniture(plan, options, w),
    options.dimensions ? drawDimensions(geometry, plan, w) : '',
    `</g>`,
    options.legend ? drawLegend(plan, options) : '',
    options.scaleBar ? drawScaleBar(plan, options) : '',
    options.titleBlock ? drawTitleBlock(plan, geometry, options, scaleLabel) : '',
  ].join('')

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    ` width="${round(sheet.widthMm)}mm" height="${round(sheet.heightMm)}mm"`,
    ` viewBox="0 0 ${round(sheet.widthMm)} ${round(sheet.heightMm)}">`,
    `<title>${escapeXml(plan.meta.name || 'Floor plan')}</title>`,
    body,
    `</svg>`,
  ].join('')

  return { svg, widthMm: sheet.widthMm, heightMm: sheet.heightMm, overflows }
}
