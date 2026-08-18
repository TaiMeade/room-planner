import { describe, expect, it } from 'vitest'

import {
  createRoom,
  createWall,
  deleteSelection,
  duplicateFurniture,
  nudgeSelection,
  placeOpening,
  splitWall,
} from '@/lib/edits'
import { composite } from '@/lib/commands'
import { computePlanGeometry } from '@/lib/wallGeometry'
import { emptyPlan } from '@/types/plan'
import type { Plan, Selection } from '@/types/plan'

/**
 * The editing layer — what a user action *means*, above what a command does.
 *
 * The behaviour worth pinning here is the stuff a hobby floor planner usually
 * gets wrong: drawing onto an existing corner should weld rather than stack two
 * nodes, drawing into the middle of a wall should split it into a real
 * T-junction, and deleting should take the dependants with it.
 */

const WELD = { nodeTolerance: 150, wallTolerance: 150 }
const WALL = { thickness: 100, height: 2400 }

function twoWallPlan(): Plan {
  const plan = emptyPlan()
  plan.nodes = {
    a: { id: 'a', x: 0, y: 0 },
    b: { id: 'b', x: 4000, y: 0 },
    c: { id: 'c', x: 4000, y: 3000 },
  }
  plan.walls = {
    w1: { id: 'w1', start: 'a', end: 'b', thickness: 100, height: 2400 },
    w2: { id: 'w2', start: 'b', end: 'c', thickness: 100, height: 2400 },
  }
  return plan
}

const geometryOf = (plan: Plan) => computePlanGeometry(plan)

describe('createWall', () => {
  it('welds onto an existing corner instead of stacking a second node there', () => {
    const plan = twoWallPlan()
    // End 20mm from node `c` — inside the weld tolerance.
    const result = createWall(plan, geometryOf(plan), { x: 0, y: 3000 }, { x: 4020, y: 3000 }, {
      ...WELD,
      ...WALL,
    })!
    result.command.apply(plan)

    expect(Object.keys(plan.walls)).toHaveLength(3)
    // One node added (the new start), not two.
    expect(Object.keys(plan.nodes)).toHaveLength(4)
    const added = Object.values(plan.walls).find((wall) => !['w1', 'w2'].includes(wall.id))!
    expect([added.start, added.end]).toContain('c')
  })

  it('splits a wall when drawn into its middle, making a real T-junction', () => {
    const plan = twoWallPlan()
    const result = createWall(plan, geometryOf(plan), { x: 2000, y: 0 }, { x: 2000, y: 2000 }, {
      ...WELD,
      ...WALL,
    })!
    result.command.apply(plan)

    // w1 became two halves, plus the new stem: 2 + 1 + w2 = 4.
    expect(Object.keys(plan.walls)).toHaveLength(4)
    expect(plan.walls.w1).toBeUndefined()

    // Three walls now meet at the split point, which is what a T-junction is.
    const junction = Object.values(plan.nodes).find(
      (node) => Math.abs(node.x - 2000) < 1 && Math.abs(node.y) < 1,
    )!
    const meeting = Object.values(plan.walls).filter(
      (wall) => wall.start === junction.id || wall.end === junction.id,
    )
    expect(meeting).toHaveLength(3)

    // And the geometry solver resolves it without tearing.
    const geometry = computePlanGeometry(plan)
    expect(geometry.walls).toHaveLength(4)
    for (const outline of geometry.walls) expect(outline.polygon).toHaveLength(4)
  })

  it('refuses a wall that goes nowhere', () => {
    const plan = twoWallPlan()
    expect(
      createWall(plan, geometryOf(plan), { x: 500, y: 500 }, { x: 510, y: 500 }, {
        ...WELD,
        ...WALL,
      }),
    ).toBeNull()
  })

  it('refuses a wall whose ends weld to the same node', () => {
    const plan = twoWallPlan()
    expect(
      createWall(plan, geometryOf(plan), { x: 10, y: 10 }, { x: 40, y: 40 }, {
        ...WELD,
        ...WALL,
      }),
    ).toBeNull()
  })

  it('splits one wall once when both ends land on it, rather than doubling it', () => {
    // Both endpoints sit on the body of w1. Resolved against the pre-split
    // geometry, the far end splits the wall the near end had already replaced,
    // and the plan ends up with two overlapping copies of it.
    const plan = twoWallPlan()
    const result = createWall(plan, geometryOf(plan), { x: 1000, y: 0 }, { x: 3000, y: 0 }, {
      ...WELD,
      ...WALL,
    })!
    result.command.apply(plan)

    // w1 becomes three segments (0–1000, 1000–3000, 3000–4000), plus the drawn
    // wall and w2: five walls, with nothing stacked on anything.
    expect(plan.walls.w1).toBeUndefined()
    expect(Object.keys(plan.walls)).toHaveLength(5)

    // No two walls may share a pair of endpoints except the drawn one, which
    // deliberately runs alongside the segment between the split nodes.
    const spans = Object.values(plan.walls).map((wall) =>
      [wall.start, wall.end].sort().join('|'),
    )
    const duplicated = spans.filter((span, index) => spans.indexOf(span) !== index)
    expect(duplicated).toHaveLength(1)

    // Every remaining segment is backed by a real node pair.
    for (const wall of Object.values(plan.walls)) {
      expect(plan.nodes[wall.start]).toBeDefined()
      expect(plan.nodes[wall.end]).toBeDefined()
    }
  })

  it('undoes a double-ended split back to the original wall', () => {
    const plan = twoWallPlan()
    const before = JSON.stringify(plan)
    const result = createWall(plan, geometryOf(plan), { x: 1000, y: 0 }, { x: 3000, y: 0 }, {
      ...WELD,
      ...WALL,
    })!
    result.command.apply(plan)
    result.command.revert(plan)
    expect(JSON.parse(JSON.stringify(plan))).toEqual(JSON.parse(before))
  })

  it('undoes a split back to the original single wall', () => {
    const plan = twoWallPlan()
    const before = JSON.stringify(plan)
    const result = createWall(plan, geometryOf(plan), { x: 2000, y: 0 }, { x: 2000, y: 2000 }, {
      ...WELD,
      ...WALL,
    })!
    result.command.apply(plan)
    result.command.revert(plan)
    expect(JSON.parse(JSON.stringify(plan))).toEqual(JSON.parse(before))
  })
})

describe('splitWall', () => {
  it('hands each opening to the half that now contains it', () => {
    const plan = twoWallPlan()
    plan.openings = {
      near: {
        id: 'near',
        wall: 'w1',
        distance: 500,
        width: 800,
        kind: 'door',
        sillHeight: 0,
        height: 2032,
        flipFace: false,
        flipHinge: false,
      },
      far: {
        id: 'far',
        wall: 'w1',
        distance: 3400,
        width: 800,
        kind: 'window',
        sillHeight: 900,
        height: 1200,
        flipFace: false,
        flipHinge: false,
      },
    }

    const split = splitWall(plan, 'w1', { x: 2000, y: 0 })!
    composite('split', split.commands)!.apply(plan)

    const near = plan.openings.near!
    const far = plan.openings.far!
    expect(near.wall).not.toBe(far.wall)
    expect(near.distance).toBeCloseTo(500, 6)
    // The far opening is re-measured from the new wall's own start.
    expect(far.distance).toBeCloseTo(1400, 6)
    expect(plan.openings.near!.wall).not.toBe('w1')
  })

  it('returns the existing node rather than splitting at a wall end', () => {
    const plan = twoWallPlan()
    const split = splitWall(plan, 'w1', { x: 4000, y: 0 })!
    expect(split.nodeId).toBe('b')
    expect(split.commands).toHaveLength(0)
  })
})

describe('createRoom', () => {
  it('lays four walls that enclose one room', () => {
    const plan = emptyPlan()
    createRoom({ x: 0, y: 0 }, { x: 4000, y: 3000 }, WALL)!.apply(plan)

    expect(Object.keys(plan.walls)).toHaveLength(4)
    expect(Object.keys(plan.nodes)).toHaveLength(4)

    const geometry = computePlanGeometry(plan)
    expect(geometry.rooms).toHaveLength(1)
    expect(geometry.rooms[0]!.area).toBeCloseTo((4000 - 100) * (3000 - 100), 4)
  })

  it('ignores a drag too small to be a room', () => {
    expect(createRoom({ x: 0, y: 0 }, { x: 100, y: 100 }, WALL)).toBeNull()
  })

  it('undoes cleanly, leaving no orphaned corners', () => {
    const plan = emptyPlan()
    const command = createRoom({ x: 0, y: 0 }, { x: 4000, y: 3000 }, WALL)!
    command.apply(plan)
    command.revert(plan)
    expect(Object.keys(plan.walls)).toHaveLength(0)
    expect(Object.keys(plan.nodes)).toHaveLength(0)
  })
})

describe('placeOpening', () => {
  it('narrows an opening rather than refusing a wall that is too short', () => {
    const plan = emptyPlan()
    plan.nodes = { a: { id: 'a', x: 0, y: 0 }, b: { id: 'b', x: 900, y: 0 } }
    plan.walls = { w: { id: 'w', start: 'a', end: 'b', thickness: 100, height: 2400 } }

    const placed = placeOpening(geometryOf(plan), 'w', { x: 450, y: 0 }, 'double-door')!
    placed.command.apply(plan)

    const opening = plan.openings[placed.id]!
    expect(opening.width).toBeLessThan(900)
    expect(opening.distance - opening.width / 2).toBeGreaterThanOrEqual(0)
    expect(opening.distance + opening.width / 2).toBeLessThanOrEqual(900)
  })
})

describe('deleteSelection', () => {
  it('does not delete an opening twice when its wall is going too', () => {
    const plan = twoWallPlan()
    plan.openings = {
      o1: {
        id: 'o1',
        wall: 'w1',
        distance: 1000,
        width: 800,
        kind: 'door',
        sillHeight: 0,
        height: 2032,
        flipFace: false,
        flipHinge: false,
      },
    }
    const before = JSON.stringify(plan)

    const selection: Selection[] = [
      { kind: 'wall', id: 'w1' },
      { kind: 'opening', id: 'o1' },
    ]
    const command = deleteSelection(plan, selection)!
    command.apply(plan)
    expect(plan.walls.w1).toBeUndefined()
    expect(plan.openings.o1).toBeUndefined()

    // Undoing a double-delete would restore the opening in the wrong order and
    // leave it hosted on a wall that no longer exists.
    command.revert(plan)
    expect(JSON.parse(JSON.stringify(plan))).toEqual(JSON.parse(before))
  })

  it('deleting a corner removes the walls that depend on it', () => {
    const plan = twoWallPlan()
    deleteSelection(plan, [{ kind: 'node', id: 'b' }])!.apply(plan)
    expect(Object.keys(plan.walls)).toHaveLength(0)
  })
})

describe('nudgeSelection', () => {
  it('moves a wall by moving both of its corners', () => {
    const plan = twoWallPlan()
    nudgeSelection(plan, [{ kind: 'wall', id: 'w1' }], { x: 100, y: 0 })!.apply(plan)
    expect(plan.nodes.a!.x).toBe(100)
    expect(plan.nodes.b!.x).toBe(4100)
    // `c` belongs only to w2 and must not move.
    expect(plan.nodes.c!.x).toBe(4000)
  })

  it('leaves locked furniture alone', () => {
    const plan = twoWallPlan()
    plan.furniture = {
      f1: {
        id: 'f1',
        catalogId: 'generic-box',
        x: 500,
        y: 500,
        rotation: 0,
        width: 600,
        depth: 600,
        height: 600,
        label: 'Box',
        locked: true,
      },
    }
    plan.furnitureOrder = ['f1']
    expect(nudgeSelection(plan, [{ kind: 'furniture', id: 'f1' }], { x: 100, y: 0 })).toBeNull()
    expect(plan.furniture.f1!.x).toBe(500)
  })
})

describe('duplicateFurniture', () => {
  it('copies with an offset and gives the copies fresh ids', () => {
    const plan = emptyPlan()
    plan.furniture = {
      f1: {
        id: 'f1',
        catalogId: 'armchair',
        x: 500,
        y: 500,
        rotation: 1.2,
        width: 800,
        depth: 800,
        height: 800,
        label: 'Armchair',
        locked: true,
      },
    }
    plan.furnitureOrder = ['f1']

    const result = duplicateFurniture(plan, [{ kind: 'furniture', id: 'f1' }], { x: 300, y: 300 })!
    result.command.apply(plan)

    const copy = plan.furniture[result.ids[0]!]!
    expect(copy.id).not.toBe('f1')
    expect(copy.x).toBe(800)
    expect(copy.rotation).toBe(1.2)
    // A copy you cannot move is not useful.
    expect(copy.locked).toBe(false)
  })
})
