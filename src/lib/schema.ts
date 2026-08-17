import { DEFAULT_SETTINGS, PLAN_SCHEMA_VERSION, emptyPlan } from '@/types/plan'
import type {
  FurnitureItem,
  Id,
  Opening,
  OpeningKind,
  Plan,
  PlanNode,
  Underlay,
  UnitSystem,
  Wall,
} from '@/types/plan'

/**
 * Reading a plan back in.
 *
 * The JSON file *is* the save format, which means it is also the compatibility
 * surface — someone will import a file they exported a year ago, possibly
 * hand-edited. So this is deliberately defensive: coerce what it can, drop what
 * it can't, and never throw on a field it doesn't recognise. A plan that loads
 * with one broken chair beats an error dialog.
 */

export class PlanParseError extends Error {}

const OPENING_KINDS: OpeningKind[] = ['door', 'double-door', 'sliding-door', 'opening', 'window']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function positive(value: unknown, fallback: number): number {
  const parsed = num(value, fallback)
  return parsed > 0 ? parsed : fallback
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** An image embedded in the file itself, rather than a reference to somewhere else. */
function isEmbeddedImage(value: string): boolean {
  return /^data:image\/(png|jpeg|jpg|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=\s]+$/i.test(value)
}

/** Warnings are surfaced to the user rather than swallowed — a silently thinned plan is worse than a noisy one. */
export interface ParseResult {
  plan: Plan
  warnings: string[]
}

export function parsePlan(input: unknown): ParseResult {
  if (!isRecord(input)) throw new PlanParseError('That file does not contain a plan.')

  const warnings: string[] = []
  const version = num(input.schemaVersion, 0)
  if (version > PLAN_SCHEMA_VERSION) {
    warnings.push(
      `This file was written by a newer version of Room Planner (v${version}). Anything unrecognised has been dropped.`,
    )
  }

  const plan = emptyPlan()

  // --- meta -----------------------------------------------------------------
  const meta = isRecord(input.meta) ? input.meta : {}
  const now = new Date().toISOString()
  plan.meta = {
    name: str(meta.name, 'Imported plan'),
    createdAt: str(meta.createdAt, now),
    updatedAt: str(meta.updatedAt, now),
    author: typeof meta.author === 'string' ? meta.author : undefined,
    notes: typeof meta.notes === 'string' ? meta.notes : undefined,
  }

  // --- settings -------------------------------------------------------------
  const settings = isRecord(input.settings) ? input.settings : {}
  const units: UnitSystem = settings.units === 'metric' ? 'metric' : 'imperial'
  plan.settings = {
    units,
    gridSize: positive(settings.gridSize, DEFAULT_SETTINGS.gridSize),
    snapToGrid: bool(settings.snapToGrid, DEFAULT_SETTINGS.snapToGrid),
    angleSnap: Math.max(0, num(settings.angleSnap, DEFAULT_SETTINGS.angleSnap)),
    defaultWallThickness: positive(
      settings.defaultWallThickness,
      DEFAULT_SETTINGS.defaultWallThickness,
    ),
    defaultWallHeight: positive(settings.defaultWallHeight, DEFAULT_SETTINGS.defaultWallHeight),
    showDimensions: bool(settings.showDimensions, DEFAULT_SETTINGS.showDimensions),
    showGrid: bool(settings.showGrid, DEFAULT_SETTINGS.showGrid),
    showAreas: bool(settings.showAreas, DEFAULT_SETTINGS.showAreas),
  }

  // --- nodes ----------------------------------------------------------------
  const nodes = isRecord(input.nodes) ? input.nodes : {}
  for (const [id, raw] of Object.entries(nodes)) {
    if (!isRecord(raw)) continue
    const x = num(raw.x, NaN)
    const y = num(raw.y, NaN)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      warnings.push(`Node ${id} had no usable position and was skipped.`)
      continue
    }
    const node: PlanNode = { id, x, y }
    plan.nodes[id] = node
  }

  // --- walls ----------------------------------------------------------------
  const walls = isRecord(input.walls) ? input.walls : {}
  for (const [id, raw] of Object.entries(walls)) {
    if (!isRecord(raw)) continue
    const start = str(raw.start, '')
    const end = str(raw.end, '')
    if (!plan.nodes[start] || !plan.nodes[end] || start === end) {
      warnings.push(`Wall ${id} referenced a missing node and was skipped.`)
      continue
    }
    const wall: Wall = {
      id,
      start,
      end,
      thickness: positive(raw.thickness, plan.settings.defaultWallThickness),
      height: positive(raw.height, plan.settings.defaultWallHeight),
    }
    plan.walls[id] = wall
  }

  // --- openings -------------------------------------------------------------
  const openings = isRecord(input.openings) ? input.openings : {}
  for (const [id, raw] of Object.entries(openings)) {
    if (!isRecord(raw)) continue
    const wallId = str(raw.wall, '')
    if (!plan.walls[wallId]) {
      warnings.push(`Opening ${id} had no host wall and was skipped.`)
      continue
    }
    const kind = OPENING_KINDS.includes(raw.kind as OpeningKind)
      ? (raw.kind as OpeningKind)
      : 'door'
    const opening: Opening = {
      id,
      wall: wallId,
      distance: num(raw.distance, 0),
      width: positive(raw.width, 813),
      kind,
      sillHeight: Math.max(0, num(raw.sillHeight, kind === 'window' ? 914 : 0)),
      height: positive(raw.height, kind === 'window' ? 1219 : 2032),
      flipFace: bool(raw.flipFace, false),
      flipHinge: bool(raw.flipHinge, false),
    }
    plan.openings[id] = opening
  }

  // --- furniture ------------------------------------------------------------
  const furniture = isRecord(input.furniture) ? input.furniture : {}
  for (const [id, raw] of Object.entries(furniture)) {
    if (!isRecord(raw)) continue
    const x = num(raw.x, NaN)
    const y = num(raw.y, NaN)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      warnings.push(`Furniture ${id} had no usable position and was skipped.`)
      continue
    }
    const item: FurnitureItem = {
      id,
      catalogId: str(raw.catalogId, 'generic-box'),
      x,
      y,
      rotation: num(raw.rotation, 0),
      width: positive(raw.width, 600),
      depth: positive(raw.depth, 600),
      height: positive(raw.height, 750),
      label: str(raw.label, 'Item'),
      color: typeof raw.color === 'string' ? raw.color : undefined,
      locked: bool(raw.locked, false),
    }
    plan.furniture[id] = item
  }

  // Preserve saved z-order, then append anything the order array forgot.
  const savedOrder = Array.isArray(input.furnitureOrder) ? input.furnitureOrder : []
  const seen = new Set<Id>()
  const order: Id[] = []
  for (const value of savedOrder) {
    if (typeof value === 'string' && plan.furniture[value] && !seen.has(value)) {
      seen.add(value)
      order.push(value)
    }
  }
  for (const id of Object.keys(plan.furniture)) {
    if (!seen.has(id)) order.push(id)
  }
  plan.furnitureOrder = order

  // --- underlay -------------------------------------------------------------
  //
  // The underlay is the one field that becomes a URL the browser will fetch,
  // and a plan file is something people pass around. Anything but an embedded
  // image is refused: a remote `https://` underlay would have this app quietly
  // making a network request the moment a shared file was opened, which is
  // exactly the promise it makes to never do.
  if (isRecord(input.underlay) && typeof input.underlay.dataUrl === 'string') {
    const raw = input.underlay
    const dataUrl = String(raw.dataUrl)
    if (isEmbeddedImage(dataUrl)) {
      const underlay: Underlay = {
        dataUrl,
        x: num(raw.x, 0),
        y: num(raw.y, 0),
        width: positive(raw.width, 5000),
        height: positive(raw.height, 4000),
        rotation: num(raw.rotation, 0),
        opacity: Math.min(1, Math.max(0, num(raw.opacity, 0.5))),
        locked: bool(raw.locked, true),
        visible: bool(raw.visible, true),
      }
      plan.underlay = underlay
    } else {
      warnings.push(
        'The traced background image was not embedded in the file, so it was left out.',
      )
    }
  }

  // Orphaned nodes are harmless but they clutter hit-testing; drop them.
  const referenced = new Set<Id>()
  for (const wall of Object.values(plan.walls)) {
    referenced.add(wall.start)
    referenced.add(wall.end)
  }
  for (const id of Object.keys(plan.nodes)) {
    if (!referenced.has(id)) delete plan.nodes[id]
  }

  return { plan, warnings }
}

export function parsePlanJson(text: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new PlanParseError('That file is not valid JSON.')
  }
  return parsePlan(data)
}

export function serializePlan(plan: Plan): string {
  return JSON.stringify({ ...plan, schemaVersion: PLAN_SCHEMA_VERSION }, null, 2)
}
