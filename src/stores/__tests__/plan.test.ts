import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { updateFurniture } from '@/lib/commands'
import { usePlanStore } from '@/stores/plan'
import { emptyPlan } from '@/types/plan'

/**
 * The store is the only thing allowed to change the document, and `revision` is
 * how the rest of the app finds out that it did. Autosave watches nothing else,
 * so anything that edits the plan without bumping it is work that never reaches
 * the browser copy.
 */

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('setName', () => {
  it('bumps the revision so autosave hears about a rename', () => {
    const store = usePlanStore()
    const before = store.revision

    store.setName('Attic conversion')

    expect(store.plan.meta.name).toBe('Attic conversion')
    expect(store.revision).toBeGreaterThan(before)
  })

  it('touches updatedAt, which is what the title block prints', () => {
    const store = usePlanStore()
    store.resetTo({
      ...emptyPlan('Old'),
      meta: {
        name: 'Old',
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z',
      },
    })

    store.setName('New')

    expect(store.plan.meta.updatedAt).not.toBe('2020-01-01T00:00:00.000Z')
  })

  it('ignores a rename to the name it already has', () => {
    const store = usePlanStore()
    store.setName('Same')
    const revision = store.revision

    store.setName('Same')

    expect(store.revision).toBe(revision)
  })

  it('stays off the undo stack — a label is not part of the drawing', () => {
    const store = usePlanStore()
    store.setName('Renamed')
    expect(store.canUndo).toBe(false)
  })
})

describe('gesture merging', () => {
  it('folds a whole drag of one item into a single undo step', () => {
    const store = usePlanStore()
    const plan = emptyPlan()
    plan.furniture.f1 = {
      id: 'f1',
      catalogId: 'generic-box',
      x: 0,
      y: 0,
      rotation: 0,
      width: 600,
      depth: 600,
      height: 750,
      label: 'Box',
    }
    plan.furnitureOrder = ['f1']
    store.resetTo(plan)

    store.beginGesture()
    for (let frame = 1; frame <= 12; frame += 1) {
      store.execute(updateFurniture(store.plan, 'f1', { x: frame * 10, y: 0 }, 'move item'))
    }
    store.endGesture()

    expect(store.plan.furniture.f1).toMatchObject({ x: 120 })

    store.undo()
    expect(store.plan.furniture.f1).toMatchObject({ x: 0, y: 0 })
    expect(store.canUndo).toBe(false)
  })
})
