import { BufferGeometry, ExtrudeGeometry, Shape } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { Point } from '@/lib/geometry'
import type { FloorPiece, WallPiece } from '@/lib/three/buildScene'

/**
 * Turning plan polygons into meshes.
 *
 * Axis mapping, which is the only genuinely confusing part: the plan is a
 * top-down drawing on X/Y with +y running south, and Three is a Y-up world. So
 * plan x → three x, plan y → three z, and height → three y.
 *
 * `ExtrudeGeometry` builds in the XY plane and pushes along +Z, so the shape is
 * authored with y negated and then rotated −90° about X. That composition lands
 * plan-south on three-+z, which keeps a top-down 3D view oriented the same way
 * as the 2D canvas — get the sign wrong and the model is a mirror image of the
 * drawing, which is the sort of thing nobody notices until they try to use it.
 */

function shapeFrom(polygon: Point[]): Shape {
  const shape = new Shape()
  const first = polygon[0]!
  shape.moveTo(first.x, -first.y)
  for (let i = 1; i < polygon.length; i += 1) {
    const point = polygon[i]!
    shape.lineTo(point.x, -point.y)
  }
  shape.closePath()
  return shape
}

/** A flat polygon lifted into a prism between two heights. */
export function extrudePolygon(polygon: Point[], bottom: number, top: number): BufferGeometry {
  const geometry = new ExtrudeGeometry(shapeFrom(polygon), {
    depth: top - bottom,
    bevelEnabled: false,
  })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, bottom, 0)
  return geometry
}

/**
 * Merge into one geometry per material. A room is only a few dozen pieces, but
 * the wall spans multiply fast once every door and window splits its wall, and
 * one draw call costs nothing to arrange here.
 */
function merge(parts: BufferGeometry[]): BufferGeometry | null {
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]!
  const merged = mergeGeometries(parts, false)
  // mergeGeometries copies, so the sources are now dead weight.
  for (const part of parts) part.dispose()
  return merged
}

export function buildWallGeometry(pieces: WallPiece[]): BufferGeometry | null {
  return merge(
    pieces
      .filter((piece) => piece.polygon.length >= 3 && piece.top > piece.bottom)
      .map((piece) => extrudePolygon(piece.polygon, piece.bottom, piece.top)),
  )
}

/** Floor slabs sit just below zero so they never z-fight the walls standing on them. */
export function buildFloorGeometry(pieces: FloorPiece[], thickness = 12): BufferGeometry | null {
  return merge(
    pieces
      .filter((piece) => piece.polygon.length >= 3)
      .map((piece) => extrudePolygon(piece.polygon, -thickness, 0)),
  )
}

export function disposeGeometry(geometry: BufferGeometry | null): void {
  geometry?.dispose()
}
