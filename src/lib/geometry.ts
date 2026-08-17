import type { Point } from '@/types/plan'

/** Small vector helpers. Screen orientation: +x right, +y down. */

// Re-exported so the geometry-facing modules can take their vector type from
// the same place they take the maths.
export type { Point }

export const EPSILON = 1e-6

export function vec(x: number, y: number): Point {
  return { x, y }
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(a: Point, k: number): Point {
  return { x: a.x * k, y: a.y * k }
}

export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y
}

export function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x
}

export function length(a: Point): number {
  return Math.hypot(a.x, a.y)
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function normalize(a: Point): Point {
  const len = length(a)
  if (len < EPSILON) return { x: 0, y: 0 }
  return { x: a.x / len, y: a.y / len }
}

/** Rotate 90° counter-clockwise in maths orientation — which is the visual left of a heading. */
export function perpendicular(a: Point): Point {
  return { x: -a.y, y: a.x }
}

export function rotate(a: Point, radians: number): Point {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}

export function rotateAround(p: Point, origin: Point, radians: number): Point {
  return add(origin, rotate(sub(p, origin), radians))
}

export function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function angleOf(a: Point): number {
  return Math.atan2(a.y, a.x)
}

export function nearlyEqual(a: Point, b: Point, tolerance = 1e-4): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance
}

/**
 * Intersect two infinite lines given as point + direction. Returns null when
 * they are parallel — callers must have a fallback, because collinear walls
 * are completely normal in a floor plan.
 */
export function intersectLines(
  originA: Point,
  directionA: Point,
  originB: Point,
  directionB: Point,
): Point | null {
  const denominator = cross(directionA, directionB)
  if (Math.abs(denominator) < 1e-9) return null
  const t = cross(sub(originB, originA), directionB) / denominator
  return add(originA, scale(directionA, t))
}

/** Closest point on segment ab to p, plus the normalised position along it. */
export function projectOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const ab = sub(b, a)
  const lengthSquared = dot(ab, ab)
  if (lengthSquared < EPSILON) return { point: { ...a }, t: 0 }
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / lengthSquared))
  return { point: add(a, scale(ab, t)), t }
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  return distance(p, projectOnSegment(p, a, b).point)
}

/** Signed area, doubled. Positive means counter-clockwise in maths orientation. */
export function signedArea(polygon: Point[]): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i]!
    const next = polygon[(i + 1) % polygon.length]!
    sum += cross(current, next)
  }
  return sum / 2
}

export function polygonArea(polygon: Point[]): number {
  return Math.abs(signedArea(polygon))
}

export function polygonCentroid(polygon: Point[]): Point {
  const area = signedArea(polygon)
  if (Math.abs(area) < EPSILON) {
    // Degenerate ring — fall back to the average of the vertices.
    const sum = polygon.reduce((acc, p) => add(acc, p), vec(0, 0))
    return scale(sum, 1 / Math.max(1, polygon.length))
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i]!
    const next = polygon[(i + 1) % polygon.length]!
    const w = cross(current, next)
    cx += (current.x + next.x) * w
    cy += (current.y + next.y) * w
  }
  return { x: cx / (6 * area), y: cy / (6 * area) }
}

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!
    const b = polygon[j]!
    const intersects =
      a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function emptyBounds(): Bounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
}

export function extendBounds(bounds: Bounds, p: Point): Bounds {
  bounds.minX = Math.min(bounds.minX, p.x)
  bounds.minY = Math.min(bounds.minY, p.y)
  bounds.maxX = Math.max(bounds.maxX, p.x)
  bounds.maxY = Math.max(bounds.maxY, p.y)
  return bounds
}

export function boundsAreValid(bounds: Bounds): boolean {
  return Number.isFinite(bounds.minX) && bounds.maxX >= bounds.minX
}

export function padBounds(bounds: Bounds, padding: number): Bounds {
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  }
}

export function boundsSize(bounds: Bounds): { width: number; height: number } {
  return { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY }
}

/** Corner points of an oriented rectangle, clockwise from top-left in local space. */
export function rectCorners(
  centre: Point,
  width: number,
  depth: number,
  rotation: number,
): Point[] {
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const local: Point[] = [
    { x: -halfWidth, y: -halfDepth },
    { x: halfWidth, y: -halfDepth },
    { x: halfWidth, y: halfDepth },
    { x: -halfWidth, y: halfDepth },
  ]
  return local.map((p) => add(centre, rotate(p, rotation)))
}

export function snapToStep(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

export function snapPointToGrid(p: Point, step: number): Point {
  return { x: snapToStep(p.x, step), y: snapToStep(p.y, step) }
}

/**
 * Snap a heading to a multiple of `degrees`, preserving the distance travelled.
 * This is what makes drawn walls actually orthogonal without pixel fiddling.
 */
export function snapAngle(from: Point, to: Point, degrees: number): Point {
  if (degrees <= 0) return to
  const delta = sub(to, from)
  const dist = length(delta)
  if (dist < EPSILON) return to
  const step = (degrees * Math.PI) / 180
  const snapped = Math.round(angleOf(delta) / step) * step
  return add(from, { x: Math.cos(snapped) * dist, y: Math.sin(snapped) * dist })
}

export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI
}

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** Normalise to (-180, 180] for display. */
export function normalizeDegrees(degrees: number): number {
  let value = degrees % 360
  if (value > 180) value -= 360
  if (value <= -180) value += 360
  return value
}
