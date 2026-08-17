import { onBeforeUnmount, ref, shallowRef } from 'vue'
import type { PerspectiveCamera } from 'three'

import type { Point } from '@/lib/geometry'

/**
 * First-person walk mode: pointer-lock look, WASD movement, eye height fixed.
 *
 * No collision. Walking through a wall is a mild oddity; a camera that jams in
 * a doorway is a bug people report, and solving it properly means a collision
 * pass over geometry that exists to be looked at. The escape hatch is that you
 * can always fly back out.
 */

/** Eye height, mm — roughly a 5'9" person. */
const EYE_HEIGHT = 1650
/** Movement, mm per second. A relaxed indoor walking pace. */
const SPEED = 2600
const SPRINT_MULTIPLIER = 2.2
const LOOK_SENSITIVITY = 0.0022
/** Stop just short of straight up/down so the view can't flip over. */
const MAX_PITCH = Math.PI / 2 - 0.05

export interface WalkInput {
  /** +1 ahead, −1 back. */
  forward: number
  /** +1 right, −1 left. */
  strafe: number
  sprint?: boolean
}

/**
 * One step of movement, as arithmetic.
 *
 * Split out of the animation loop so the direction maths can be tested without
 * a browser — the loop itself is a `requestAnimationFrame` tick, which is
 * exactly the part a test can't drive.
 *
 * The camera looks down its local −Z, so after a yaw its forward vector is
 * (−sin, −cos) in plan coordinates and its right is (cos, −sin). Movement is
 * flattened onto the floor: looking at the ceiling should not launch you at it.
 */
export function walkStep(
  position: Point,
  yaw: number,
  input: WalkInput,
  seconds: number,
): Point {
  const { forward, strafe, sprint = false } = input
  if (forward === 0 && strafe === 0) return position

  const magnitude = Math.hypot(forward, strafe)
  // Divide by the magnitude so moving diagonally isn't faster than straight.
  const speed = (SPEED * (sprint ? SPRINT_MULTIPLIER : 1) * seconds) / magnitude
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)

  return {
    x: position.x + (-forward * sin + strafe * cos) * speed,
    y: position.y + (-forward * cos - strafe * sin) * speed,
  }
}

export function useWalkControls(camera: () => PerspectiveCamera | null) {
  const active = ref(false)
  const locked = ref(false)
  const position = shallowRef<Point>({ x: 0, y: 0 })

  const yaw = ref(0)
  const pitch = ref(0)
  const pressed = new Set<string>()

  let surface: HTMLElement | null = null
  let frame = 0
  let lastTime = 0

  function apply(): void {
    const view = camera()
    if (!view) return
    view.position.set(position.value.x, EYE_HEIGHT, position.value.y)
    view.rotation.set(0, 0, 0)
    view.rotateY(yaw.value)
    view.rotateX(pitch.value)
  }

  function onMouseMove(event: MouseEvent): void {
    if (!locked.value) return
    yaw.value -= event.movementX * LOOK_SENSITIVITY
    pitch.value = Math.max(
      -MAX_PITCH,
      Math.min(MAX_PITCH, pitch.value - event.movementY * LOOK_SENSITIVITY),
    )
    apply()
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!active.value) return
    pressed.add(event.code)
    // Swallow the keys we drive with, so WASD doesn't also reach the editor's
    // tool shortcuts and swap the tool out from under the 2D view.
    if (MOVEMENT_KEYS.has(event.code)) event.preventDefault()
  }

  function onKeyUp(event: KeyboardEvent): void {
    pressed.delete(event.code)
  }

  function onPointerLockChange(): void {
    locked.value = surface !== null && document.pointerLockElement === surface
  }

  function step(time: number): void {
    frame = requestAnimationFrame(step)
    const delta = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, 0.1)
    lastTime = time
    if (delta === 0) return

    let forward = 0
    let strafe = 0
    if (pressed.has('KeyW') || pressed.has('ArrowUp')) forward += 1
    if (pressed.has('KeyS') || pressed.has('ArrowDown')) forward -= 1
    if (pressed.has('KeyD') || pressed.has('ArrowRight')) strafe += 1
    if (pressed.has('KeyA') || pressed.has('ArrowLeft')) strafe -= 1
    if (forward === 0 && strafe === 0) return

    position.value = walkStep(
      position.value,
      yaw.value,
      {
        forward,
        strafe,
        sprint: pressed.has('ShiftLeft') || pressed.has('ShiftRight'),
      },
      delta,
    )
    apply()
  }

  function start(element: HTMLElement, at: Point, heading = 0, tilt = 0): void {
    surface = element
    position.value = { ...at }
    yaw.value = heading
    pitch.value = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, tilt))
    active.value = true
    lastTime = 0

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    frame = requestAnimationFrame(step)
    apply()
  }

  function requestLock(): void {
    surface?.requestPointerLock?.()
  }

  function stop(): void {
    active.value = false
    pressed.clear()
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    document.removeEventListener('pointerlockchange', onPointerLockChange)
    if (document.pointerLockElement === surface) document.exitPointerLock?.()
    surface = null
    locked.value = false
  }

  onBeforeUnmount(stop)

  return { active, locked, position, yaw, start, stop, requestLock, eyeHeight: EYE_HEIGHT }
}

const MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
])
