import { MM_PER_INCH as IN } from '@/lib/units'

/**
 * The furniture catalog: parametric primitives with correct real-world default
 * dimensions.
 *
 * Deliberately no downloaded meshes or scraped manufacturer models — that is a
 * licensing problem, not a technical one. A bed is a rounded box at 60x80
 * inches, and for the job this app does ("does the couch fit") a correctly
 * sized box beats a beautiful box of the wrong size.
 *
 * Glyphs are drawn in local millimetres centred on the origin: x spans the
 * item's width, y its depth, and +y is the direction the item faces.
 */

export type Category =
  | 'Bedroom'
  | 'Living'
  | 'Dining'
  | 'Office'
  | 'Kitchen'
  | 'Bath'
  | 'Utility'
  | 'Structure'

export interface Glyph {
  /** Filled footprint outline. */
  body: string
  /** Stroked detail paths drawn over the body. */
  details: string[]
}

export type GlyphFn = (width: number, depth: number) => Glyph

export interface CatalogEntry {
  id: string
  name: string
  category: Category
  /** Defaults in mm; every instance may override them. */
  width: number
  depth: number
  height: number
  glyph: string
  color: string
  /** Items that belong against a wall get auto-oriented when dropped near one. */
  wallHugging?: boolean
}

const round = (value: number) => Math.round(value * 10) / 10

/** Inches → mm, so the table below reads in the units the dimensions are published in. */
const inches = (value: number) => round(value * IN)

function rectAt(cx: number, cy: number, width: number, depth: number, radius = 0): string {
  const x = round(cx - width / 2)
  const y = round(cy - depth / 2)
  if (radius <= 0) {
    return `M ${x} ${y} h ${round(width)} v ${round(depth)} h ${round(-width)} Z`
  }
  const r = round(Math.min(radius, width / 2, depth / 2))
  return [
    `M ${round(x + r)} ${y}`,
    `h ${round(width - 2 * r)}`,
    `a ${r} ${r} 0 0 1 ${r} ${r}`,
    `v ${round(depth - 2 * r)}`,
    `a ${r} ${r} 0 0 1 ${-r} ${r}`,
    `h ${round(-(width - 2 * r))}`,
    `a ${r} ${r} 0 0 1 ${-r} ${-r}`,
    `v ${round(-(depth - 2 * r))}`,
    `a ${r} ${r} 0 0 1 ${r} ${-r}`,
    'Z',
  ].join(' ')
}

function rect(width: number, depth: number, radius = 0): string {
  const x = -width / 2
  const y = -depth / 2
  if (radius <= 0) {
    return `M ${x} ${y} h ${width} v ${depth} h ${-width} Z`
  }
  const r = Math.min(radius, width / 2, depth / 2)
  return [
    `M ${x + r} ${y}`,
    `h ${width - 2 * r}`,
    `a ${r} ${r} 0 0 1 ${r} ${r}`,
    `v ${depth - 2 * r}`,
    `a ${r} ${r} 0 0 1 ${-r} ${r}`,
    `h ${-(width - 2 * r)}`,
    `a ${r} ${r} 0 0 1 ${-r} ${-r}`,
    `v ${-(depth - 2 * r)}`,
    `a ${r} ${r} 0 0 1 ${r} ${-r}`,
    'Z',
  ].join(' ')
}

function ellipse(width: number, depth: number): string {
  const rx = width / 2
  const ry = depth / 2
  return `M ${-rx} 0 a ${rx} ${ry} 0 1 0 ${width} 0 a ${rx} ${ry} 0 1 0 ${-width} 0 Z`
}

function line(x1: number, y1: number, x2: number, y2: number): string {
  return `M ${round(x1)} ${round(y1)} L ${round(x2)} ${round(y2)}`
}

export const GLYPHS: Record<string, GlyphFn> = {
  box: (w, d) => ({ body: rect(w, d), details: [] }),

  rounded: (w, d) => ({ body: rect(w, d, Math.min(w, d) * 0.12), details: [] }),

  circle: (w, d) => ({ body: ellipse(w, d), details: [] }),

  /** Mattress with pillows at the head (−y) and a turned-down duvet at the foot. */
  bed: (w, d) => {
    const pillowBand = Math.min(d * 0.18, inches(20))
    const pillowY = -d / 2 + pillowBand / 2
    const pillowW = w > inches(45) ? (w - w * 0.12) / 2 : w * 0.7
    const pillows =
      w > inches(45)
        ? [
            rectAt(-w * 0.25, pillowY, pillowW, pillowBand * 0.62, pillowBand * 0.2),
            rectAt(w * 0.25, pillowY, pillowW, pillowBand * 0.62, pillowBand * 0.2),
          ]
        : [rectAt(0, pillowY, pillowW, pillowBand * 0.62, pillowBand * 0.2)]
    return {
      body: rect(w, d, Math.min(w, d) * 0.05),
      details: [
        line(-w / 2, -d / 2 + pillowBand, w / 2, -d / 2 + pillowBand),
        ...pillows,
        line(-w / 2, d / 2 - d * 0.22, w / 2, d / 2 - d * 0.22),
      ],
    }
  },

  /** Seat back along the rear edge, arms down each side. */
  sofa: (w, d) => {
    const back = Math.min(d * 0.28, inches(9))
    const arm = Math.min(w * 0.12, inches(9))
    return {
      body: rect(w, d, Math.min(w, d) * 0.1),
      details: [
        line(-w / 2, -d / 2 + back, w / 2, -d / 2 + back),
        line(-w / 2 + arm, -d / 2 + back, -w / 2 + arm, d / 2),
        line(w / 2 - arm, -d / 2 + back, w / 2 - arm, d / 2),
      ],
    }
  },

  /** Rectangular table with place settings implied by an inset border. */
  table: (w, d) => ({
    body: rect(w, d, Math.min(w, d) * 0.06),
    details: [rect(w * 0.72, d * 0.62, Math.min(w, d) * 0.04)],
  }),

  roundTable: (w, d) => ({
    body: ellipse(w, d),
    details: [ellipse(w * 0.66, d * 0.66)],
  }),

  /** Desk with a modesty panel along the back. */
  desk: (w, d) => ({
    body: rect(w, d),
    details: [line(-w / 2, -d / 2 + d * 0.12, w / 2, -d / 2 + d * 0.12)],
  }),

  /** Base cabinet / counter run: a toe-kick line along the wall side. */
  counter: (w, d) => ({
    body: rect(w, d),
    details: [line(-w / 2, -d / 2 + Math.min(d * 0.15, inches(3)), w / 2, -d / 2 + Math.min(d * 0.15, inches(3)))],
  }),

  /** Appliance box with a door swing hint. */
  appliance: (w, d) => ({
    body: rect(w, d),
    details: [
      line(-w / 2 + w * 0.08, d / 2 - d * 0.1, w / 2 - w * 0.08, d / 2 - d * 0.1),
      ellipse(Math.min(w, d) * 0.14, Math.min(w, d) * 0.14),
    ],
  }),

  /** Front-loading drum. */
  drum: (w, d) => ({
    body: rect(w, d),
    details: [ellipse(Math.min(w, d) * 0.62, Math.min(w, d) * 0.62)],
  }),

  /** Four burners. */
  range: (w, d) => {
    const burner = Math.min(w, d) * 0.2
    const ox = w * 0.22
    const oy = d * 0.2
    return {
      body: rect(w, d),
      details: [
        `M ${-ox - burner} ${-oy} a ${burner} ${burner} 0 1 0 ${burner * 2} 0 a ${burner} ${burner} 0 1 0 ${-burner * 2} 0`,
        `M ${ox - burner} ${-oy} a ${burner} ${burner} 0 1 0 ${burner * 2} 0 a ${burner} ${burner} 0 1 0 ${-burner * 2} 0`,
        `M ${-ox - burner} ${oy} a ${burner} ${burner} 0 1 0 ${burner * 2} 0 a ${burner} ${burner} 0 1 0 ${-burner * 2} 0`,
        `M ${ox - burner} ${oy} a ${burner} ${burner} 0 1 0 ${burner * 2} 0 a ${burner} ${burner} 0 1 0 ${-burner * 2} 0`,
      ],
    }
  },

  /** Bowl inset in a counter run. */
  sink: (w, d) => ({
    body: rect(w, d, Math.min(w, d) * 0.06),
    details: [
      rect(w * 0.74, d * 0.66, Math.min(w, d) * 0.08),
      line(0, -d / 2, 0, -d / 2 + d * 0.14),
    ],
  }),

  /** Tank against the wall (−y), bowl projecting into the room. */
  toilet: (w, d) => {
    const tank = d * 0.28
    const bowlDepth = (d - tank) * 0.78
    return {
      body: rect(w, d, Math.min(w, d) * 0.16),
      details: [
        line(-w / 2, -d / 2 + tank, w / 2, -d / 2 + tank),
        `M ${round(-w * 0.36)} ${round(-d / 2 + tank + bowlDepth / 2)} a ${round(w * 0.36)} ${round(bowlDepth / 2)} 0 1 0 ${round(w * 0.72)} 0 a ${round(w * 0.36)} ${round(bowlDepth / 2)} 0 1 0 ${round(-w * 0.72)} 0 Z`,
      ],
    }
  },

  /** Tub with the drain end marked. */
  bathtub: (w, d) => ({
    body: rect(w, d, Math.min(w, d) * 0.1),
    details: [
      rect(w * 0.88, d * 0.76, Math.min(w, d) * 0.14),
      `M ${-w * 0.34} 0 a ${Math.min(w, d) * 0.05} ${Math.min(w, d) * 0.05} 0 1 0 ${Math.min(w, d) * 0.1} 0 a ${Math.min(w, d) * 0.05} ${Math.min(w, d) * 0.05} 0 1 0 ${-Math.min(w, d) * 0.1} 0`,
    ],
  }),

  /** Shower pan with the classic diagonal. */
  shower: (w, d) => ({
    body: rect(w, d),
    details: [line(-w / 2, -d / 2, w / 2, d / 2), line(w / 2, -d / 2, -w / 2, d / 2)],
  }),

  /** Run of treads with a direction arrow. */
  stairs: (w, d) => {
    const treads = Math.max(3, Math.round(d / inches(10)))
    const step = d / treads
    const details: string[] = []
    for (let i = 1; i < treads; i += 1) {
      details.push(line(-w / 2, -d / 2 + i * step, w / 2, -d / 2 + i * step))
    }
    details.push(line(0, d / 2 - step * 0.5, 0, -d / 2 + step * 0.5))
    details.push(line(0, -d / 2 + step * 0.5, -w * 0.12, -d / 2 + step * 1.4))
    details.push(line(0, -d / 2 + step * 0.5, w * 0.12, -d / 2 + step * 1.4))
    return { body: rect(w, d), details }
  },

  /** Screen: very shallow, drawn as a bar with a stand. */
  screen: (w, d) => ({
    body: rect(w, d),
    details: [line(-w * 0.16, d / 2, w * 0.16, d / 2)],
  }),

  /** Rug: dashed border, no fill weight. */
  rug: (w, d) => ({
    body: rect(w, d),
    details: [rect(w * 0.92, d * 0.92)],
  }),

  plant: (w, d) => ({
    body: ellipse(w, d),
    details: [ellipse(w * 0.45, d * 0.45)],
  }),
}

/** Colour roles kept few and muted — the plan should read as a drawing, not a paint chart. */
const SOFT = '#D8CFC0'
const WOOD = '#C9A27E'
const TEXTILE = '#B9C7C4'
const APPLIANCE = '#CFD5D8'
const FIXTURE = '#DCE4E6'
const STRUCTURE = '#C4BBAD'

export const CATALOG: CatalogEntry[] = [
  // Bedroom
  { id: 'bed-twin', name: 'Twin bed', category: 'Bedroom', width: inches(38), depth: inches(75), height: inches(24), glyph: 'bed', color: TEXTILE, wallHugging: true },
  { id: 'bed-full', name: 'Full bed', category: 'Bedroom', width: inches(54), depth: inches(75), height: inches(24), glyph: 'bed', color: TEXTILE, wallHugging: true },
  { id: 'bed-queen', name: 'Queen bed', category: 'Bedroom', width: inches(60), depth: inches(80), height: inches(24), glyph: 'bed', color: TEXTILE, wallHugging: true },
  { id: 'bed-king', name: 'King bed', category: 'Bedroom', width: inches(76), depth: inches(80), height: inches(24), glyph: 'bed', color: TEXTILE, wallHugging: true },
  { id: 'crib', name: 'Crib', category: 'Bedroom', width: inches(52), depth: inches(28), height: inches(36), glyph: 'bed', color: TEXTILE, wallHugging: true },
  { id: 'nightstand', name: 'Nightstand', category: 'Bedroom', width: inches(20), depth: inches(16), height: inches(24), glyph: 'rounded', color: WOOD, wallHugging: true },
  { id: 'dresser', name: 'Dresser', category: 'Bedroom', width: inches(60), depth: inches(18), height: inches(32), glyph: 'counter', color: WOOD, wallHugging: true },
  { id: 'wardrobe', name: 'Wardrobe', category: 'Bedroom', width: inches(48), depth: inches(24), height: inches(72), glyph: 'counter', color: WOOD, wallHugging: true },

  // Living
  { id: 'sofa-3', name: 'Sofa (3-seat)', category: 'Living', width: inches(84), depth: inches(36), height: inches(33), glyph: 'sofa', color: TEXTILE, wallHugging: true },
  { id: 'loveseat', name: 'Loveseat', category: 'Living', width: inches(60), depth: inches(36), height: inches(33), glyph: 'sofa', color: TEXTILE, wallHugging: true },
  { id: 'armchair', name: 'Armchair', category: 'Living', width: inches(34), depth: inches(34), height: inches(32), glyph: 'sofa', color: TEXTILE },
  { id: 'recliner', name: 'Recliner', category: 'Living', width: inches(38), depth: inches(40), height: inches(40), glyph: 'sofa', color: TEXTILE },
  { id: 'coffee-table', name: 'Coffee table', category: 'Living', width: inches(48), depth: inches(24), height: inches(18), glyph: 'table', color: WOOD },
  { id: 'side-table', name: 'Side table', category: 'Living', width: inches(22), depth: inches(22), height: inches(24), glyph: 'roundTable', color: WOOD },
  { id: 'tv-stand', name: 'TV stand', category: 'Living', width: inches(60), depth: inches(16), height: inches(24), glyph: 'counter', color: WOOD, wallHugging: true },
  { id: 'tv', name: 'TV (55")', category: 'Living', width: inches(48), depth: inches(3), height: inches(28), glyph: 'screen', color: '#5A6067', wallHugging: true },
  { id: 'bookshelf', name: 'Bookshelf', category: 'Living', width: inches(36), depth: inches(12), height: inches(72), glyph: 'counter', color: WOOD, wallHugging: true },
  { id: 'rug-8x10', name: 'Rug 8×10', category: 'Living', width: inches(96), depth: inches(120), height: 10, glyph: 'rug', color: '#E3DACB' },
  { id: 'floor-lamp', name: 'Floor lamp', category: 'Living', width: inches(16), depth: inches(16), height: inches(60), glyph: 'circle', color: SOFT },
  { id: 'plant', name: 'Plant', category: 'Living', width: inches(24), depth: inches(24), height: inches(48), glyph: 'plant', color: '#A8BFA0' },
  { id: 'piano-upright', name: 'Upright piano', category: 'Living', width: inches(58), depth: inches(24), height: inches(48), glyph: 'counter', color: '#4E4A47', wallHugging: true },

  // Dining
  { id: 'dining-table', name: 'Dining table', category: 'Dining', width: inches(72), depth: inches(36), height: inches(30), glyph: 'table', color: WOOD },
  { id: 'dining-table-round', name: 'Round table', category: 'Dining', width: inches(48), depth: inches(48), height: inches(30), glyph: 'roundTable', color: WOOD },
  { id: 'dining-chair', name: 'Dining chair', category: 'Dining', width: inches(18), depth: inches(18), height: inches(34), glyph: 'rounded', color: WOOD },
  { id: 'bar-stool', name: 'Bar stool', category: 'Dining', width: inches(15), depth: inches(15), height: inches(30), glyph: 'circle', color: WOOD },
  { id: 'sideboard', name: 'Sideboard', category: 'Dining', width: inches(60), depth: inches(18), height: inches(34), glyph: 'counter', color: WOOD, wallHugging: true },

  // Office
  { id: 'desk', name: 'Desk', category: 'Office', width: inches(60), depth: inches(30), height: inches(30), glyph: 'desk', color: WOOD, wallHugging: true },
  { id: 'desk-small', name: 'Small desk', category: 'Office', width: inches(42), depth: inches(24), height: inches(30), glyph: 'desk', color: WOOD, wallHugging: true },
  { id: 'office-chair', name: 'Office chair', category: 'Office', width: inches(26), depth: inches(26), height: inches(40), glyph: 'circle', color: '#8E9598' },
  { id: 'filing-cabinet', name: 'Filing cabinet', category: 'Office', width: inches(15), depth: inches(24), height: inches(28), glyph: 'counter', color: APPLIANCE },

  // Kitchen
  { id: 'fridge', name: 'Refrigerator', category: 'Kitchen', width: inches(36), depth: inches(30), height: inches(70), glyph: 'appliance', color: APPLIANCE, wallHugging: true },
  { id: 'range', name: 'Range', category: 'Kitchen', width: inches(30), depth: inches(25), height: inches(36), glyph: 'range', color: APPLIANCE, wallHugging: true },
  { id: 'dishwasher', name: 'Dishwasher', category: 'Kitchen', width: inches(24), depth: inches(24), height: inches(34), glyph: 'appliance', color: APPLIANCE, wallHugging: true },
  { id: 'kitchen-sink', name: 'Kitchen sink', category: 'Kitchen', width: inches(33), depth: inches(22), height: inches(36), glyph: 'sink', color: FIXTURE, wallHugging: true },
  { id: 'base-cabinet', name: 'Base cabinet', category: 'Kitchen', width: inches(36), depth: inches(24), height: inches(36), glyph: 'counter', color: SOFT, wallHugging: true },
  { id: 'kitchen-island', name: 'Island', category: 'Kitchen', width: inches(72), depth: inches(36), height: inches(36), glyph: 'counter', color: SOFT },

  // Bath
  { id: 'toilet', name: 'Toilet', category: 'Bath', width: inches(20), depth: inches(28), height: inches(30), glyph: 'toilet', color: FIXTURE, wallHugging: true },
  { id: 'bathtub', name: 'Bathtub', category: 'Bath', width: inches(60), depth: inches(30), height: inches(20), glyph: 'bathtub', color: FIXTURE, wallHugging: true },
  { id: 'shower', name: 'Shower', category: 'Bath', width: inches(36), depth: inches(36), height: inches(80), glyph: 'shower', color: FIXTURE, wallHugging: true },
  { id: 'vanity', name: 'Vanity', category: 'Bath', width: inches(36), depth: inches(21), height: inches(32), glyph: 'sink', color: SOFT, wallHugging: true },

  // Utility
  { id: 'washer', name: 'Washer', category: 'Utility', width: inches(27), depth: inches(27), height: inches(38), glyph: 'drum', color: APPLIANCE, wallHugging: true },
  { id: 'dryer', name: 'Dryer', category: 'Utility', width: inches(27), depth: inches(27), height: inches(38), glyph: 'drum', color: APPLIANCE, wallHugging: true },
  { id: 'water-heater', name: 'Water heater', category: 'Utility', width: inches(22), depth: inches(22), height: inches(60), glyph: 'circle', color: APPLIANCE },

  // Structure
  { id: 'stairs', name: 'Stairs', category: 'Structure', width: inches(36), depth: inches(120), height: inches(96), glyph: 'stairs', color: STRUCTURE },
  { id: 'column', name: 'Column', category: 'Structure', width: inches(12), depth: inches(12), height: inches(96), glyph: 'box', color: STRUCTURE },
  { id: 'generic-box', name: 'Box', category: 'Structure', width: inches(24), depth: inches(24), height: inches(24), glyph: 'box', color: SOFT },
]

export const CATALOG_BY_ID = new Map(CATALOG.map((entry) => [entry.id, entry]))

export const CATEGORIES: Category[] = [
  'Bedroom',
  'Living',
  'Dining',
  'Office',
  'Kitchen',
  'Bath',
  'Utility',
  'Structure',
]

export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG_BY_ID.get(id)
}

/** Falls back to a plain box so an unknown catalog id from an old file still draws. */
export function glyphFor(entry: CatalogEntry | undefined, width: number, depth: number): Glyph {
  const fn = GLYPHS[entry?.glyph ?? 'box'] ?? GLYPHS.box!
  return fn(width, depth)
}
