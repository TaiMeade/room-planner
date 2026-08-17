import { describe, expect, it } from 'vitest'

import { PlanParseError, parsePlan, parsePlanJson, serializePlan } from '@/lib/schema'
import { createSamplePlan } from '@/lib/samplePlan'
import { computePlanGeometry } from '@/lib/wallGeometry'

/**
 * The JSON file is the save file, which makes it the compatibility surface.
 * Someone will import a plan they exported a year ago, possibly after opening
 * it in a text editor. The rule this file pins down: coerce what you can, drop
 * what you can't, say what you dropped, and never throw on a field you don't
 * recognise. A plan that opens with one missing chair beats an error dialog.
 */

describe('round trip', () => {
  it('survives serialize → parse unchanged', () => {
    const original = createSamplePlan()
    const { plan, warnings } = parsePlanJson(serializePlan(original))

    expect(warnings).toEqual([])
    expect(plan.walls).toEqual(original.walls)
    expect(plan.nodes).toEqual(original.nodes)
    expect(plan.openings).toEqual(original.openings)
    expect(plan.furnitureOrder).toEqual(original.furnitureOrder)
    expect(plan.settings).toEqual(original.settings)
  })

  it('produces identical geometry after a round trip', () => {
    const original = createSamplePlan()
    const { plan } = parsePlanJson(serializePlan(original))
    expect(computePlanGeometry(plan).rooms[0]!.area).toBeCloseTo(
      computePlanGeometry(original).rooms[0]!.area,
      6,
    )
  })
})

describe('damaged input', () => {
  it('rejects things that are not plans', () => {
    expect(() => parsePlanJson('not json at all')).toThrow(PlanParseError)
    expect(() => parsePlan('a string')).toThrow(PlanParseError)
    expect(() => parsePlan(null)).toThrow(PlanParseError)
  })

  it('drops a wall whose node is missing, and says so', () => {
    const { plan, warnings } = parsePlan({
      schemaVersion: 1,
      nodes: { a: { x: 0, y: 0 } },
      walls: { w1: { start: 'a', end: 'ghost', thickness: 100 } },
    })
    expect(plan.walls).toEqual({})
    expect(warnings.some((warning) => warning.includes('w1'))).toBe(true)
  })

  it('drops an opening whose wall is missing', () => {
    const { plan, warnings } = parsePlan({
      schemaVersion: 1,
      openings: { o1: { wall: 'ghost', distance: 100, width: 800 } },
    })
    expect(plan.openings).toEqual({})
    expect(warnings).toHaveLength(1)
  })

  it('substitutes sane values for nonsense numbers', () => {
    const { plan } = parsePlan({
      schemaVersion: 1,
      nodes: { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } },
      walls: { w1: { start: 'a', end: 'b', thickness: -50, height: 'tall' } },
      settings: { gridSize: 0, angleSnap: -10, units: 'furlongs' },
    })
    expect(plan.walls.w1!.thickness).toBeGreaterThan(0)
    expect(plan.walls.w1!.height).toBeGreaterThan(0)
    expect(plan.settings.gridSize).toBeGreaterThan(0)
    expect(plan.settings.angleSnap).toBe(0)
    expect(plan.settings.units).toBe('imperial')
  })

  it('sheds corners no wall is using', () => {
    const { plan } = parsePlan({
      schemaVersion: 1,
      nodes: { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, stray: { x: 9, y: 9 } },
      walls: { w1: { start: 'a', end: 'b', thickness: 100 } },
    })
    expect(Object.keys(plan.nodes).sort()).toEqual(['a', 'b'])
  })

  it('rebuilds a furniture order that has gone stale', () => {
    const { plan } = parsePlan({
      schemaVersion: 1,
      furniture: {
        f1: { catalogId: 'armchair', x: 0, y: 0, width: 800, depth: 800 },
        f2: { catalogId: 'armchair', x: 100, y: 0, width: 800, depth: 800 },
      },
      // Names a deleted item and forgets a present one.
      furnitureOrder: ['f2', 'deleted'],
    })
    expect(plan.furnitureOrder).toEqual(['f2', 'f1'])
  })

  it('warns when the file came from a newer version', () => {
    const { warnings } = parsePlan({ schemaVersion: 99 })
    expect(warnings.some((warning) => warning.includes('newer version'))).toBe(true)
  })

  it('opens an empty object as an empty plan rather than failing', () => {
    const { plan } = parsePlan({})
    expect(plan.walls).toEqual({})
    expect(plan.settings.units).toBe('imperial')
  })
})
