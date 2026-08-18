import { reactive } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Command } from '@/lib/commands'
import {
  addFurniture,
  addWall,
  composite,
  moveFurniture,
  moveNodes,
  removeFurniture,
  removeOpening,
  removeWall,
  replacePlan,
  reorderFurniture,
  updateFurniture,
  updateOpening,
  updateWall,
} from '@/lib/commands'
import { createSamplePlan } from '@/lib/samplePlan'
import { emptyPlan } from '@/types/plan'
import type { Plan } from '@/types/plan'

/**
 * The command stack is the reason this app can be trusted with an hour of
 * someone's work, so it gets tested as such: every command must undo to a state
 * indistinguishable from before it ran.
 */

function fixture(): Plan {
  const plan = emptyPlan('Test')
  plan.nodes = {
    a: { id: 'a', x: 0, y: 0 },
    b: { id: 'b', x: 4000, y: 0 },
    c: { id: 'c', x: 4000, y: 3000 },
  }
  plan.walls = {
    w1: { id: 'w1', start: 'a', end: 'b', thickness: 100, height: 2400 },
    w2: { id: 'w2', start: 'b', end: 'c', thickness: 100, height: 2400 },
  }
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
  plan.furniture = {
    f1: {
      id: 'f1',
      catalogId: 'bed-queen',
      x: 1000,
      y: 1000,
      rotation: 0,
      width: 1524,
      depth: 2032,
      height: 610,
      label: 'Queen bed',
      color: '#B9C7C4',
    },
  }
  plan.furnitureOrder = ['f1']
  return plan
}

/**
 * Sort object keys so a restored entry compares equal wherever it was
 * reinserted. Arrays are left alone — `furnitureOrder` is the z-order, so its
 * sequence genuinely has to survive a round trip.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

/** Apply then revert, and assert the document came back to exactly where it was. */
function expectReversible(plan: Plan, command: Command | null): void {
  expect(command).not.toBeNull()
  const before = canonical(JSON.parse(JSON.stringify(plan)))
  command!.apply(plan)
  const applied = canonical(JSON.parse(JSON.stringify(plan)))
  expect(applied).not.toEqual(before)
  command!.revert(plan)
  expect(canonical(JSON.parse(JSON.stringify(plan)))).toEqual(before)
}

describe('reversibility', () => {
  let plan: Plan

  beforeEach(() => {
    plan = fixture()
  })

  it('moveNodes', () => {
    expectReversible(
      plan,
      moveNodes([{ id: 'a', from: { x: 0, y: 0 }, to: { x: 500, y: 250 } }]),
    )
  })

  it('addWall with a new node', () => {
    expectReversible(
      plan,
      addWall({ id: 'w3', start: 'c', end: 'd', thickness: 100, height: 2400 }, [
        { id: 'd', x: 0, y: 3000 },
      ]),
    )
  })

  it('removeWall, restoring its openings and its orphaned node', () => {
    expectReversible(plan, removeWall(plan, 'w1'))
  })

  it('updateWall', () => {
    expectReversible(plan, updateWall(plan, 'w1', { thickness: 200 }))
  })

  it('updateOpening', () => {
    expectReversible(plan, updateOpening(plan, 'o1', { width: 900, kind: 'window' }))
  })

  it('removeOpening', () => {
    expectReversible(plan, removeOpening(plan, 'o1'))
  })

  it('addFurniture', () => {
    expectReversible(
      plan,
      addFurniture({
        id: 'f2',
        catalogId: 'armchair',
        x: 0,
        y: 0,
        rotation: 0,
        width: 800,
        depth: 800,
        height: 800,
        label: 'Armchair',
      }),
    )
  })

  it('removeFurniture, restoring its place in the z-order', () => {
    plan.furniture.f2 = { ...plan.furniture.f1!, id: 'f2' }
    plan.furniture.f3 = { ...plan.furniture.f1!, id: 'f3' }
    plan.furnitureOrder = ['f1', 'f2', 'f3']
    expectReversible(plan, removeFurniture(plan, 'f2'))
  })

  it('updateFurniture, including a field that was undefined', () => {
    delete plan.furniture.f1!.color
    expectReversible(plan, updateFurniture(plan, 'f1', { color: '#FF0000' }))
  })

  it('reorderFurniture', () => {
    plan.furniture.f2 = { ...plan.furniture.f1!, id: 'f2' }
    plan.furnitureOrder = ['f1', 'f2']
    expectReversible(plan, reorderFurniture(plan, 'f1', 1))
  })

  it('replacePlan', () => {
    expectReversible(plan, replacePlan(plan, createSamplePlan()))
  })
})

describe('reactive documents', () => {
  /**
   * Regression: commands are handed values read out of a Vue reactive store,
   * which are Proxy objects. `structuredClone` throws DataCloneError on those,
   * so loading a plan failed at runtime while every plain-object test passed.
   */
  it('copies values out of a reactive plan without throwing', () => {
    const plan = reactive(fixture()) as Plan

    expect(() => replacePlan(plan, createSamplePlan()).apply(plan)).not.toThrow()
    expect(Object.keys(plan.walls).length).toBeGreaterThan(0)

    const reverted = reactive(fixture()) as Plan
    expectReversible(reverted, removeWall(reverted, 'w1'))
    expectReversible(reverted, updateFurniture(reverted, 'f1', { x: 99 }))
  })
})

describe('composite', () => {
  it('reverts its parts in reverse order', () => {
    const plan = fixture()
    const order: string[] = []
    const step = (name: string): Command => ({
      label: name,
      apply: () => order.push(`do:${name}`),
      revert: () => order.push(`undo:${name}`),
    })

    const grouped = composite('group', [step('a'), step('b'), step('c')])!
    grouped.apply(plan)
    grouped.revert(plan)

    expect(order).toEqual(['do:a', 'do:b', 'do:c', 'undo:c', 'undo:b', 'undo:a'])
  })

  it('collapses to null when nothing survives', () => {
    expect(composite('group', [null, null])).toBeNull()
  })

  it('never merges, even when wrapping a single mergeable command', () => {
    const plan = fixture()
    const grouped = composite('group', [updateWall(plan, 'w1', { thickness: 200 })])!
    expect(grouped.mergeKey).toBeUndefined()
  })
})

describe('merging', () => {
  it('gives matching edits the same merge key and different ones distinct keys', () => {
    const plan = fixture()
    const first = updateFurniture(plan, 'f1', { x: 10 })!
    const second = updateFurniture(plan, 'f1', { x: 20 })!
    const other = updateFurniture(plan, 'f1', { rotation: 1 })!

    expect(first.mergeKey).toBe(second.mergeKey)
    expect(first.mergeKey).not.toBe(other.mergeKey)
  })

  it('keeps the original value when a later edit is absorbed', () => {
    const plan = fixture()
    const first = updateFurniture(plan, 'f1', { x: 1500 })!
    first.apply(plan)

    const second = updateFurniture(plan, 'f1', { x: 2500 })!
    second.apply(plan)
    first.absorb!(second.after!)

    expect(plan.furniture.f1!.x).toBe(2500)
    // One undo must return to where the gesture started, not to its midpoint.
    first.revert(plan)
    expect(plan.furniture.f1!.x).toBe(1000)
  })

  it('absorbs a multi-node move without losing the starting positions', () => {
    const plan = fixture()
    const first = moveNodes([
      { id: 'a', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
      { id: 'b', from: { x: 4000, y: 0 }, to: { x: 4100, y: 0 } },
    ])
    first.apply(plan)

    const second = moveNodes([
      { id: 'a', from: { x: 0, y: 0 }, to: { x: 900, y: 0 } },
      { id: 'b', from: { x: 4000, y: 0 }, to: { x: 4900, y: 0 } },
    ])
    second.apply(plan)
    first.absorb!(second.after!)

    expect(plan.nodes.a!.x).toBe(900)
    first.revert(plan)
    expect(plan.nodes.a!.x).toBe(0)
    expect(plan.nodes.b!.x).toBe(4000)
  })
})

describe('cascades', () => {
  it('takes a wall’s openings with it and brings them back on undo', () => {
    const plan = fixture()
    const command = removeWall(plan, 'w1')!
    command.apply(plan)

    expect(plan.walls.w1).toBeUndefined()
    expect(plan.openings.o1).toBeUndefined()
    // Node `a` belonged only to w1; `b` is shared with w2 and must survive.
    expect(plan.nodes.a).toBeUndefined()
    expect(plan.nodes.b).toBeDefined()

    command.revert(plan)
    expect(plan.openings.o1?.wall).toBe('w1')
    expect(plan.nodes.a).toEqual({ id: 'a', x: 0, y: 0 })
  })
})

describe('moveFurniture', () => {
  function twoItemPlan(): Plan {
    const plan = fixture()
    plan.furniture.f2 = { ...plan.furniture.f1!, id: 'f2', x: 3000, y: 1000 }
    plan.furnitureOrder = ['f1', 'f2']
    return plan
  }

  it('moves every item in one command and undoes them together', () => {
    const plan = twoItemPlan()
    const command = moveFurniture([
      { id: 'f1', from: { x: 1000, y: 1000 }, to: { x: 1500, y: 1200 } },
      { id: 'f2', from: { x: 3000, y: 1000 }, to: { x: 3500, y: 1200 } },
    ])
    command.apply(plan)

    expect(plan.furniture.f1).toMatchObject({ x: 1500, y: 1200 })
    expect(plan.furniture.f2).toMatchObject({ x: 3500, y: 1200 })

    command.revert(plan)
    expect(plan.furniture.f1).toMatchObject({ x: 1000, y: 1000 })
    expect(plan.furniture.f2).toMatchObject({ x: 3000, y: 1000 })
  })

  /**
   * A drag of several items used to emit one `updateFurniture` per item per
   * frame. Those alternate between merge keys, so consecutive commands never
   * matched and a short drag of two chairs buried the undo stack.
   */
  it('keeps one merge key for the whole selection so a drag folds to one step', () => {
    const plan = twoItemPlan()
    const ids = [
      { id: 'f1', from: { x: 1000, y: 1000 }, to: { x: 1100, y: 1000 } },
      { id: 'f2', from: { x: 3000, y: 1000 }, to: { x: 3100, y: 1000 } },
    ]
    const first = moveFurniture(ids)
    // The same selection in a different order is still the same gesture.
    const second = moveFurniture([
      { id: 'f2', from: { x: 3000, y: 1000 }, to: { x: 3200, y: 1000 } },
      { id: 'f1', from: { x: 1000, y: 1000 }, to: { x: 1200, y: 1000 } },
    ])
    expect(first.mergeKey).toBe(second.mergeKey)

    first.apply(plan)
    second.apply(plan)
    first.absorb!(second.after!)

    expect(plan.furniture.f1).toMatchObject({ x: 1200 })
    // Undoing the folded command returns to where the drag began, not midway.
    first.revert(plan)
    expect(plan.furniture.f1).toMatchObject({ x: 1000, y: 1000 })
    expect(plan.furniture.f2).toMatchObject({ x: 3000, y: 1000 })
  })

  it('does not share a merge key with a different selection', () => {
    const both = moveFurniture([
      { id: 'f1', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
      { id: 'f2', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
    ])
    const one = moveFurniture([{ id: 'f1', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }])
    expect(both.mergeKey).not.toBe(one.mergeKey)
  })
})
