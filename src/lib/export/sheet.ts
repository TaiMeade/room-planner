import type { UnitSystem } from '@/types/plan'

/**
 * Paper sizes and drawing scales.
 *
 * Scale is expressed as a denominator — world millimetres per paper millimetre.
 * 1/4" = 1'-0" means one paper inch is four world feet, so 48 world mm per
 * paper mm. Keeping it as a single number is what lets the PDF path stay
 * trivially correct: paper size = world size / denominator, and nothing else
 * has to know about feet.
 */

export interface PaperSize {
  id: string
  label: string
  /** Portrait dimensions in mm; landscape swaps them. */
  widthMm: number
  heightMm: number
}

export const PAPER_SIZES: PaperSize[] = [
  { id: 'letter', label: 'Letter · 8.5 × 11 in', widthMm: 215.9, heightMm: 279.4 },
  { id: 'legal', label: 'Legal · 8.5 × 14 in', widthMm: 215.9, heightMm: 355.6 },
  { id: 'tabloid', label: 'Tabloid · 11 × 17 in', widthMm: 279.4, heightMm: 431.8 },
  { id: 'a4', label: 'A4 · 210 × 297 mm', widthMm: 210, heightMm: 297 },
  { id: 'a3', label: 'A3 · 297 × 420 mm', widthMm: 297, heightMm: 420 },
]

export interface DrawingScale {
  id: string
  label: string
  /** World mm per paper mm. */
  denominator: number
  units: UnitSystem
}

export const DRAWING_SCALES: DrawingScale[] = [
  { id: 'in-1-2', label: '1/2" = 1\'-0"', denominator: 24, units: 'imperial' },
  { id: 'in-1-4', label: '1/4" = 1\'-0"', denominator: 48, units: 'imperial' },
  { id: 'in-3-16', label: '3/16" = 1\'-0"', denominator: 64, units: 'imperial' },
  { id: 'in-1-8', label: '1/8" = 1\'-0"', denominator: 96, units: 'imperial' },
  { id: 'm-20', label: '1:20', denominator: 20, units: 'metric' },
  { id: 'm-50', label: '1:50', denominator: 50, units: 'metric' },
  { id: 'm-100', label: '1:100', denominator: 100, units: 'metric' },
]

export function scalesFor(units: UnitSystem): DrawingScale[] {
  return DRAWING_SCALES.filter((scale) => scale.units === units)
}

export function paperSize(id: string): PaperSize {
  return PAPER_SIZES.find((size) => size.id === id) ?? PAPER_SIZES[0]!
}

export function drawingScale(id: string): DrawingScale {
  return DRAWING_SCALES.find((scale) => scale.id === id) ?? DRAWING_SCALES[1]!
}

export interface Sheet {
  widthMm: number
  heightMm: number
  /** World mm per paper mm. */
  denominator: number
  marginMm: number
  landscape: boolean
}

export function makeSheet(
  sizeId: string,
  scaleId: string,
  landscape: boolean,
  marginMm = 12,
): Sheet {
  const size = paperSize(sizeId)
  const scale = drawingScale(scaleId)
  return {
    widthMm: landscape ? size.heightMm : size.widthMm,
    heightMm: landscape ? size.widthMm : size.heightMm,
    denominator: scale.denominator,
    marginMm,
    landscape,
  }
}

/** Does the drawing fit the sheet at this scale? Answered before export, not after printing. */
export function fitsOnSheet(
  sheet: Sheet,
  worldWidth: number,
  worldHeight: number,
  titleBlockHeightMm: number,
): boolean {
  const available = {
    width: sheet.widthMm - sheet.marginMm * 2,
    height: sheet.heightMm - sheet.marginMm * 2 - titleBlockHeightMm,
  }
  return (
    worldWidth / sheet.denominator <= available.width &&
    worldHeight / sheet.denominator <= available.height
  )
}

/** The largest standard scale at which the drawing still fits. */
export function bestScaleFor(
  units: UnitSystem,
  sheet: Omit<Sheet, 'denominator'>,
  worldWidth: number,
  worldHeight: number,
  titleBlockHeightMm: number,
): DrawingScale | null {
  const candidates = scalesFor(units).slice().sort((a, b) => a.denominator - b.denominator)
  for (const candidate of candidates) {
    if (
      fitsOnSheet(
        { ...sheet, denominator: candidate.denominator },
        worldWidth,
        worldHeight,
        titleBlockHeightMm,
      )
    ) {
      return candidate
    }
  }
  return null
}
