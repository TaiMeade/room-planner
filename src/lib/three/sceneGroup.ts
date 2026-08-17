import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
  type Material,
} from 'three'

import type { SceneModel } from '@/lib/three/buildScene'
import { buildFloorGeometry, buildWallGeometry } from '@/lib/three/meshes'

/**
 * Assembles the scene as a plain Three group.
 *
 * Building the object graph here rather than declaratively keeps every mesh,
 * geometry and material on one owner that can be disposed in one call. A 3D
 * view that rebuilds on every edit leaks the GPU dry otherwise, and that leak
 * is invisible until the tab falls over twenty minutes in.
 */

const WALL_COLOR = '#E4E0D7'
const FLOOR_COLOR = '#C2B39B'

export interface BuiltScene {
  group: Group
  dispose: () => void
}

/**
 * Walls are double-sided on purpose. A walkthrough is mostly spent inside the
 * rooms looking at the *back* of every wall, which single-sided rendering
 * leaves invisible.
 */
function wallMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(WALL_COLOR),
    roughness: 0.94,
    metalness: 0,
    side: DoubleSide,
  })
}

function floorMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(FLOOR_COLOR),
    roughness: 0.88,
    metalness: 0,
    side: DoubleSide,
  })
}

export function buildSceneGroup(model: SceneModel): BuiltScene {
  const group = new Group()
  const geometries: BufferGeometry[] = []
  const materials: Material[] = []

  const floors = buildFloorGeometry(model.floors)
  if (floors) {
    const material = floorMaterial()
    const mesh = new Mesh(floors, material)
    mesh.receiveShadow = true
    group.add(mesh)
    geometries.push(floors)
    materials.push(material)
  }

  const walls = buildWallGeometry(model.walls)
  if (walls) {
    const material = wallMaterial()
    const mesh = new Mesh(walls, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    geometries.push(walls)
    materials.push(material)
  }

  // Furniture as low-poly proxies at true size — the plan's own scoping, and
  // the honest one: a correctly sized box answers "does it fit", which is the
  // question, and it carries no asset-licensing baggage.
  const boxGeometry = new BoxGeometry(1, 1, 1)
  geometries.push(boxGeometry)

  for (const item of model.furniture) {
    const material = new MeshStandardMaterial({
      color: new Color(item.color),
      roughness: 0.72,
      metalness: 0,
    })
    materials.push(material)

    const mesh = new Mesh(boxGeometry, material)
    mesh.scale.set(item.width, Math.max(item.height, 10), item.depth)
    // Plan y maps to three z, and a clockwise turn on the drawing is a
    // negative rotation about three's up axis.
    mesh.position.set(item.x, Math.max(item.height, 10) / 2, item.y)
    mesh.rotation.y = -item.rotation
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.name = item.label
    group.add(mesh)
  }

  return {
    group,
    dispose() {
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
      group.clear()
    },
  }
}
