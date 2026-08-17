import { catalogEntry } from '@/lib/catalog'
import { MM_PER_INCH } from '@/lib/units'
import { DEFAULT_SETTINGS, PLAN_SCHEMA_VERSION } from '@/types/plan'
import type { FurnitureItem, Opening, Plan, Wall } from '@/types/plan'

/**
 * A furnished bedroom, 180" wide by 108" deep, opened instead of a blank grid.
 *
 * Every competitor does this and they are right to: an empty canvas asks you
 * to decide what to do, a drawn room asks you to drag something. It costs
 * almost nothing and it is most of the difference between someone staying past
 * thirty seconds and closing the tab.
 *
 * The whole room is specified in inches here, because that is how it was
 * measured. The document is still millimetres — `inches()` is the only place
 * the conversion happens, and nothing downstream sees an inch.
 */

const THICKNESS = DEFAULT_SETTINGS.defaultWallThickness
const HEIGHT = DEFAULT_SETTINGS.defaultWallHeight

const inches = (value: number) => value * MM_PER_INCH

/**
 * Floor dimensions. Centrelines are set so the *interior* measures exactly this.
 *
 * The 180" run is the width — you come in through the long wall, and the room
 * is only 108" deep. That shape is what makes the layout below work: the back
 * wall is long enough to take the bed and both carts side by side, with open
 * floor in front of every drawer.
 */
const INTERIOR_WIDTH = inches(180)
const INTERIOR_DEPTH = inches(108)

const WIDTH = INTERIOR_WIDTH + THICKNESS
const DEPTH = INTERIOR_DEPTH + THICKNESS
const HALF = THICKNESS / 2

/**
 * Interior inch coordinates → world millimetres, measured from the inside face
 * of the back-left corner. Everything below is positioned in the numbers you'd
 * read off a tape measure standing in the room.
 */
const fromLeft = (value: number) => HALF + inches(value)
const fromBack = (value: number) => HALF + inches(value)

interface Placement {
  id: string
  catalogId: string
  label?: string
  /** Footprint in inches. Omit to take the catalog default. */
  width?: number
  depth?: number
  height?: number
  /** Interior inch coordinates of the item's centre. */
  x: number
  y: number
  /**
   * Degrees, clockwise on screen. At 0 an item's back faces the top of the
   * plan, so −90 puts its back against the left wall and 90 against the right.
   * Note this swaps which axis the footprint's width and depth run along.
   */
  rotation?: number
}

function place(spec: Placement): FurnitureItem {
  const entry = catalogEntry(spec.catalogId)
  return {
    id: spec.id,
    catalogId: spec.catalogId,
    x: fromLeft(spec.x),
    y: fromBack(spec.y),
    rotation: ((spec.rotation ?? 0) * Math.PI) / 180,
    width: spec.width === undefined ? (entry?.width ?? 600) : inches(spec.width),
    depth: spec.depth === undefined ? (entry?.depth ?? 600) : inches(spec.depth),
    height: spec.height === undefined ? (entry?.height ?? 750) : inches(spec.height),
    label: spec.label ?? entry?.name ?? 'Item',
    color: entry?.color,
  }
}

export function createSamplePlan(): Plan {
  const now = new Date().toISOString()

  const corners = {
    nw: { id: 'n_nw', x: 0, y: 0 },
    ne: { id: 'n_ne', x: WIDTH, y: 0 },
    se: { id: 'n_se', x: WIDTH, y: DEPTH },
    sw: { id: 'n_sw', x: 0, y: DEPTH },
  }

  const wall = (id: string, start: string, end: string): Wall => ({
    id,
    start,
    end,
    thickness: THICKNESS,
    height: HEIGHT,
  })

  const walls: Wall[] = [
    wall('w_north', corners.nw.id, corners.ne.id),
    wall('w_east', corners.ne.id, corners.se.id),
    wall('w_south', corners.se.id, corners.sw.id),
    wall('w_west', corners.sw.id, corners.nw.id),
  ]

  /**
   * Openings are measured from their wall's start corner, in inches along the
   * centreline. Watch the direction: the south wall runs right-to-left and the
   * west wall runs bottom-to-top, so those distances count from the bottom-right
   * and bottom-left corners respectively.
   */
  const opening = (
    id: string,
    wallId: string,
    distance: number,
    width: number,
    kind: Opening['kind'],
    extra: Partial<Opening> = {},
  ): Opening => ({
    id,
    wall: wallId,
    distance: inches(distance),
    width: inches(width),
    kind,
    sillHeight: kind === 'window' ? inches(36) : 0,
    height: kind === 'window' ? inches(48) : inches(80),
    flipFace: false,
    flipHinge: false,
    ...extra,
  })

  const openings: Opening[] = [
    // Entry door in the bottom-right corner, hinged on the right so the leaf
    // swings away from the corner rather than across it. Its right jamb sits
    // 1 3/4" off the inside corner — about as tight as a real frame goes.
    opening('o_door', 'w_south', 20.5, 33, 'door'),
    // French closet doors, a 17" run of wall clear of the door frame, opening
    // into the room. `double-door` splits the 45" opening into two 22 1/2"
    // leaves, which is the pair asked for.
    opening('o_closet', 'w_south', 76.5, 45, 'double-door'),
    // Centred on the back wall, above the head of the bed.
    opening('o_win_back', 'w_north', 92.25, 36, 'window'),
    // Low on the left wall, over the desk.
    opening('o_win_side', 'w_west', 30, 36, 'window'),
  ]

  /**
   * Anything with a drawer or a door needs the floor in front of it, not just
   * the floor under it. A cart shoved into a 24" alcove has nowhere to pull its
   * drawers, so each piece below faces open room — the carts south off the back
   * wall, the fridge and bookshelf west off the right wall, the desk east.
   */
  const furniture: FurnitureItem[] = [
    // Bed head to the back wall, centred under the window. Given as 80 x 60,
    // set here as 60 wide by 80 deep so the head is the edge against the wall —
    // same footprint, right way round.
    place({ id: 'f_bed', catalogId: 'bed-queen', label: 'Bed', width: 60, depth: 80, x: 90, y: 40 }),

    // A rolling cart at each side of the bed, backs to the wall and drawers
    // facing into the room, with the full depth of the room to open into.
    place({
      id: 'f_cart_left',
      catalogId: 'dresser',
      label: 'Rolling cart',
      width: 25,
      depth: 17,
      height: 30,
      x: 45.5,
      y: 8.5,
    }),
    place({
      id: 'f_cart_right',
      catalogId: 'dresser',
      label: 'Rolling cart',
      width: 25,
      depth: 17,
      height: 30,
      x: 134.5,
      y: 8.5,
    }),

    // Desk down the left wall under the window, facing the room so a chair can
    // pull back, and clear of the closet doors at the other end.
    place({
      id: 'f_desk',
      catalogId: 'desk',
      label: 'Desk',
      width: 71,
      depth: 29.5,
      x: 14.75,
      y: 60,
      rotation: -90,
    }),

    // Mini fridge and bookshelf along the right wall, opening west into open
    // floor and both stopping short of the door swing. The catalog fridge is a
    // full-height one, so the height is overridden too — a 17 1/2" wide unit
    // standing 70" tall would be wrong in the 3D view and in the inspector.
    place({
      id: 'f_fridge',
      catalogId: 'fridge',
      label: 'Mini fridge',
      width: 17.5,
      depth: 18.5,
      height: 33,
      x: 170.75,
      y: 30,
      rotation: 90,
    }),
    place({
      id: 'f_bookshelf',
      catalogId: 'bookshelf',
      label: 'Bookshelf',
      width: 24,
      depth: 11,
      height: 48,
      x: 174.5,
      y: 57,
      rotation: 90,
    }),
  ]

  const plan: Plan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    meta: {
      name: 'Sample bedroom',
      createdAt: now,
      updatedAt: now,
      notes:
        'A 180 wide × 108 deep inch bedroom to start from. Draw over it, or clear it and start blank.',
    },
    settings: { ...DEFAULT_SETTINGS },
    nodes: {},
    walls: {},
    openings: {},
    furniture: {},
    underlay: null,
    furnitureOrder: furniture.map((item) => item.id),
  }

  for (const node of Object.values(corners)) plan.nodes[node.id] = node
  for (const item of walls) plan.walls[item.id] = item
  for (const item of openings) plan.openings[item.id] = item
  for (const item of furniture) plan.furniture[item.id] = item

  return plan
}
