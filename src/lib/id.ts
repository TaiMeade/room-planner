/**
 * Short, readable, collision-safe-enough ids. They end up in exported JSON that
 * people occasionally open in a text editor, so `w_k3f9a2` beats a UUID.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomSuffix(length = 6): string {
  let result = ''
  for (let i = 0; i < length; i += 1) {
    result += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return result
}

export function createId(prefix: string): string {
  return `${prefix}_${randomSuffix()}`
}

export const nodeId = () => createId('n')
export const wallId = () => createId('w')
export const openingId = () => createId('o')
export const furnitureId = () => createId('f')
