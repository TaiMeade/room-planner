import { describe, expect, it } from 'vitest'

import { walkStep } from '@/composables/useWalkControls'

/**
 * The movement maths behind walk mode.
 *
 * Tested here rather than in a browser because the part a browser could show —
 * the animation loop — is the one part a test can't drive, while the part that
 * actually goes wrong is a sign error in the yaw. Getting that wrong gives a
 * camera that strafes when you press forward, which looks like a broken
 * feature and reads as a one-character bug.
 */

const ORIGIN = { x: 0, y: 0 }
const SECOND = 1

/** Distance travelled in one second at a walking pace. */
const STRIDE = 2600

describe('walkStep', () => {
  it('stands still with no input', () => {
    expect(walkStep(ORIGIN, 0, { forward: 0, strafe: 0 }, SECOND)).toEqual(ORIGIN)
  })

  it('walks toward the top of the plan at zero yaw', () => {
    // Camera forward is −Z, which is plan north — up the drawing.
    const moved = walkStep(ORIGIN, 0, { forward: 1, strafe: 0 }, SECOND)
    expect(moved.x).toBeCloseTo(0, 6)
    expect(moved.y).toBeCloseTo(-STRIDE, 6)
  })

  it('backs away from where it is looking', () => {
    const moved = walkStep(ORIGIN, 0, { forward: -1, strafe: 0 }, SECOND)
    expect(moved.y).toBeCloseTo(STRIDE, 6)
  })

  it('strafes to the camera’s right, not the plan’s', () => {
    const moved = walkStep(ORIGIN, 0, { forward: 0, strafe: 1 }, SECOND)
    expect(moved.x).toBeCloseTo(STRIDE, 6)
    expect(moved.y).toBeCloseTo(0, 6)
  })

  it('turns the whole frame with the yaw', () => {
    // A quarter turn: forward now points along plan −x.
    const moved = walkStep(ORIGIN, Math.PI / 2, { forward: 1, strafe: 0 }, SECOND)
    expect(moved.x).toBeCloseTo(-STRIDE, 6)
    expect(moved.y).toBeCloseTo(0, 6)

    // And another quarter turn puts forward at plan +y.
    const back = walkStep(ORIGIN, Math.PI, { forward: 1, strafe: 0 }, SECOND)
    expect(back.y).toBeCloseTo(STRIDE, 6)
  })

  it('keeps forward and strafe perpendicular at any heading', () => {
    for (const yaw of [0, 0.7, Math.PI / 3, 2.4, -1.1]) {
      const ahead = walkStep(ORIGIN, yaw, { forward: 1, strafe: 0 }, SECOND)
      const right = walkStep(ORIGIN, yaw, { forward: 0, strafe: 1 }, SECOND)
      expect(ahead.x * right.x + ahead.y * right.y).toBeCloseTo(0, 4)
    }
  })

  it('does not let diagonal movement outrun a straight line', () => {
    const straight = walkStep(ORIGIN, 0, { forward: 1, strafe: 0 }, SECOND)
    const diagonal = walkStep(ORIGIN, 0, { forward: 1, strafe: 1 }, SECOND)
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(
      Math.hypot(straight.x, straight.y),
      6,
    )
  })

  it('scales with elapsed time, so speed does not depend on frame rate', () => {
    const oneStep = walkStep(ORIGIN, 0.5, { forward: 1, strafe: 0 }, 0.2)
    let stepped = ORIGIN
    for (let i = 0; i < 4; i += 1) {
      stepped = walkStep(stepped, 0.5, { forward: 1, strafe: 0 }, 0.05)
    }
    expect(stepped.x).toBeCloseTo(oneStep.x, 6)
    expect(stepped.y).toBeCloseTo(oneStep.y, 6)
  })

  it('sprints faster than it walks, in the same direction', () => {
    const walked = walkStep(ORIGIN, 0.9, { forward: 1, strafe: 0 }, SECOND)
    const ran = walkStep(ORIGIN, 0.9, { forward: 1, strafe: 0, sprint: true }, SECOND)
    expect(Math.hypot(ran.x, ran.y)).toBeGreaterThan(Math.hypot(walked.x, walked.y))
    // Same heading, longer stride.
    expect(ran.x / ran.y).toBeCloseTo(walked.x / walked.y, 6)
  })
})
