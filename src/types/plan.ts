/**
 * The plan document. This is the whole product: everything else — the SVG
 * renderer, the 3D view, every export format — is a pure function of this.
 *
 * All lengths are millimetres. Always. Imperial exists only as a
 * display/parse layer at the UI edge (see `lib/units.ts`); nothing below the
 * component boundary ever sees feet or inches.
 */

export const PLAN_SCHEMA_VERSION = 1

export type Id = string

export interface Point {
  x: number
  y: number
}

/** Screen/world orientation: +x is right, +y is DOWN (SVG convention). */
export interface PlanNode extends Point {
  id: Id
}

export interface Wall {
  id: Id
  /** Node ids. Walls never store coordinates — nodes are shared, so joins are correct by construction. */
  start: Id
  end: Id
  /** Full thickness, mm. Centreline runs between the nodes. */
  thickness: number
  /** Used by the phase-2 3D extrusion; irrelevant in 2D but part of the document. */
  height: number
}

export type OpeningKind = 'door' | 'double-door' | 'sliding-door' | 'opening' | 'window'

export interface Opening {
  id: Id
  /** The wall this opening is cut into. Openings are parametric children — move the wall and they follow. */
  wall: Id
  /** Distance of the opening's centre from the wall's start node, along the centreline, mm. */
  distance: number
  width: number
  kind: OpeningKind
  /** Sill height for windows / head height for doors, mm. 3D + elevation use these. */
  sillHeight: number
  height: number
  /** Which side the door swings toward, and which end it hinges on. */
  flipFace: boolean
  flipHinge: boolean
}

export interface FurnitureItem {
  id: Id
  /** Key into the parametric catalog (`lib/catalog.ts`). */
  catalogId: string
  /** Centre of the footprint, world mm. */
  x: number
  y: number
  /** Radians, clockwise on screen. */
  rotation: number
  /** Footprint, mm. Seeded from the catalog default but freely editable. */
  width: number
  depth: number
  height: number
  label: string
  /** Fill colour; falls back to the catalog default when absent. */
  color?: string
  locked?: boolean
}

export type UnitSystem = 'imperial' | 'metric'

export interface PlanMeta {
  name: string
  /** ISO strings. */
  createdAt: string
  updatedAt: string
  /** Shown in the PDF title block. */
  author?: string
  notes?: string
}

export interface PlanSettings {
  units: UnitSystem
  /** Grid spacing in mm. Snapping quantises to this. */
  gridSize: number
  snapToGrid: boolean
  /** Angle snap increment in degrees; 0 disables. */
  angleSnap: number
  /** Default thickness for newly drawn walls, mm. */
  defaultWallThickness: number
  defaultWallHeight: number
  showDimensions: boolean
  showGrid: boolean
  showAreas: boolean
}

/** An optional traced-from-photo underlay, stored as a data URL so the document stays self-contained. */
export interface Underlay {
  dataUrl: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  locked: boolean
  visible: boolean
}

export interface Plan {
  schemaVersion: number
  meta: PlanMeta
  settings: PlanSettings
  nodes: Record<Id, PlanNode>
  walls: Record<Id, Wall>
  openings: Record<Id, Opening>
  furniture: Record<Id, FurnitureItem>
  underlay: Underlay | null
  /** Insertion order for stable rendering and z-order of furniture. */
  furnitureOrder: Id[]
}

export type EntityKind = 'node' | 'wall' | 'opening' | 'furniture'

export interface Selection {
  kind: EntityKind
  id: Id
}

export const DEFAULT_SETTINGS: PlanSettings = {
  units: 'imperial',
  gridSize: 152.4, // 6 inches — the useful granularity for furnishing a room
  snapToGrid: true,
  angleSnap: 15,
  defaultWallThickness: 114.3, // 4.5" — a 2x4 stud wall with drywall
  defaultWallHeight: 2438.4, // 8'
  showDimensions: true,
  showGrid: true,
  showAreas: true,
}

export function emptyPlan(name = 'Untitled plan'): Plan {
  const now = new Date().toISOString()
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    meta: { name, createdAt: now, updatedAt: now },
    settings: { ...DEFAULT_SETTINGS },
    nodes: {},
    walls: {},
    openings: {},
    furniture: {},
    underlay: null,
    furnitureOrder: [],
  }
}
